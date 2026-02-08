package app

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

var (
	errStackNotFound = errors.New("compose stack not found")
)

type DockerClient struct {
	settings Settings
	regctl   *RegctlClient
	cache    *TTLCache
}

func NewDockerClient(settings Settings, regctl *RegctlClient, cache *TTLCache) *DockerClient {
	return &DockerClient{settings: settings, regctl: regctl, cache: cache}
}

func (c *DockerClient) ListComposeStacks(noCache bool, includeStopped bool, includeRemote bool) ([]DockerStack, error) {
	cacheKey := fmt.Sprintf("stacks:%t", includeStopped)
	if !noCache {
		if cached, ok := c.cache.Get(cacheKey); ok {
			if stacks, ok := cached.([]DockerStack); ok {
				return stacks, nil
			}
		}
	}

	args := []string{"compose", "ls", "--format", "json"}
	if includeStopped {
		args = append(args, "--all")
	}
	out, err := runCommand("docker", args...)
	if err != nil {
		return nil, err
	}

	var rawStacks []map[string]any
	if err := json.Unmarshal(out, &rawStacks); err != nil {
		return nil, err
	}

	ignorePattern := c.ignoreStackPattern()
	stacks := make([]DockerStack, 0, len(rawStacks))
	for _, item := range rawStacks {
		name, _ := item["Name"].(string)
		if name == "" {
			continue
		}
		if ignorePattern != nil && ignorePattern.MatchString(name) {
			continue
		}
		configFiles := extractConfigFiles(item["ConfigFiles"])
		stack := DockerStack{
			Name:       name,
			ConfigFiles: configFiles,
		}
		services, err := c.listContainersByStack(name, includeStopped, noCache, includeRemote)
		if err != nil {
			return nil, err
		}
		if len(services) == 0 {
			continue
		}
		stack.Services = services
		stack.HasUpdates = stackHasUpdates(services)
		stacks = append(stacks, stack)
	}

	sort.Slice(stacks, func(i, j int) bool { return stacks[i].Name < stacks[j].Name })
	if !noCache {
		c.cache.Set(cacheKey, stacks, time.Duration(c.settings.Server.CacheControlMaxAgeSeconds)*time.Second)
	}
	return stacks, nil
}

func (c *DockerClient) ListStacksMerged(noCache bool, includeStopped bool, includeRemote bool) ([]DockerStack, error) {
	_, imageMap, _, err := c.ListLocalImages(noCache, includeRemote)
	if err != nil {
		return nil, err
	}

	containers, err := c.listAllContainers(includeStopped)
	if err != nil {
		return nil, err
	}

	containersByService := map[string]containerInspect{}
	for _, item := range containers {
		stack := item.Config.Labels["com.docker.compose.project"]
		service := item.Config.Labels["com.docker.compose.service"]
		if stack != "" && service != "" {
			containersByService[stack+"/"+service] = item
		}
	}

	composeStacks, err := c.scanComposeStacks()
	if err != nil {
		return nil, err
	}

	stackMap := make(map[string]DockerStack, len(composeStacks))
	for _, stack := range composeStacks {
		for i, svc := range stack.Services {
			if svc.Image != nil && svc.Image.RepoTag != "" {
				if img := matchImageForRef(imageMap, svc.Image.RepoTag); img != nil {
					stack.Services[i].Image = img
					stack.Services[i].HasUpdates = img.LatestUpdate.After(img.CreatedAt)
					stack.Services[i].Status = "stopped"
				} else {
					stack.Services[i].Status = "not-loaded"
				}
			}
		}
		stackMap[stack.Name] = stack
	}

	for _, item := range containers {
		stack := item.Config.Labels["com.docker.compose.project"]
		service := item.Config.Labels["com.docker.compose.service"]
		if stack == "" || service == "" {
			continue
		}
		if _, ok := stackMap[stack]; !ok {
			stackMap[stack] = DockerStack{
				Name:       stack,
				ConfigFiles: nil,
				Services:   nil,
			}
		}
	}

	merged := make([]DockerStack, 0, len(stackMap))
	for _, stack := range stackMap {
		services := map[string]DockerContainer{}
		if stack.Services != nil {
			for _, svc := range stack.Services {
				services[svc.ServiceName] = svc
			}
		}
		for key, container := range containersByService {
			parts := strings.SplitN(key, "/", 2)
			if len(parts) != 2 || parts[0] != stack.Name {
				continue
			}
			built, err := c.buildContainerFromInspect(container, imageMap, noCache)
			if err != nil {
				return nil, err
			}
			if existing, ok := services[built.ServiceName]; ok && existing.ContainerName != "" {
				built.ContainerName = existing.ContainerName
			}
			if existing, ok := services[built.ServiceName]; ok && existing.Image != nil && built.Image != nil {
				if existing.Image.RepoTag != "" {
					built.Image.RepoTag = existing.Image.RepoTag
				}
			}
			services[built.ServiceName] = built
		}

		stack.Services = nil
		for _, svc := range services {
			stack.Services = append(stack.Services, svc)
		}
		sort.Slice(stack.Services, func(i, j int) bool { return stack.Services[i].ServiceName < stack.Services[j].ServiceName })
		stack.HasUpdates = stackHasUpdates(stack.Services)
		merged = append(merged, stack)
	}

	sort.Slice(merged, func(i, j int) bool { return merged[i].Name < merged[j].Name })
	return merged, nil
}

func (c *DockerClient) GetComposeStack(name string, noCache bool) (DockerStack, error) {
	stacks, err := c.ListStacksMerged(noCache, false, true)
	if err != nil {
		return DockerStack{}, err
	}
	for _, stack := range stacks {
		if stack.Name == name {
			return stack, nil
		}
	}
	return DockerStack{}, errStackNotFound
}

func (c *DockerClient) GetComposeService(stackName, serviceName string, noCache bool) (DockerContainer, error) {
	stack, err := c.GetComposeStack(stackName, noCache)
	if err != nil {
		return DockerContainer{}, err
	}
	for _, svc := range stack.Services {
		if svc.ServiceName == serviceName {
			return svc, nil
		}
	}
	return DockerContainer{}, fmt.Errorf("service not found")
}

func (c *DockerClient) listContainersByStack(stackName string, includeStopped bool, noCache bool, includeRemote bool) ([]DockerContainer, error) {
	args := []string{"ps", "--format", "{{.ID}}", "--filter", fmt.Sprintf("label=com.docker.compose.project=%s", stackName)}
	if includeStopped {
		args = append([]string{"ps", "-a", "--format", "{{.ID}}", "--filter", fmt.Sprintf("label=com.docker.compose.project=%s", stackName)})
	}
	out, err := runCommand("docker", args...)
	if err != nil {
		return nil, err
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return nil, nil
	}

	inspectOut, err := runCommand("docker", append([]string{"inspect"}, ids...)...)
	if err != nil {
		return nil, err
	}

	var inspectData []containerInspect
	if err := json.Unmarshal(inspectOut, &inspectData); err != nil {
		return nil, err
	}

	containers := make([]DockerContainer, 0, len(inspectData))
	for _, item := range inspectData {
		labels := item.Config.Labels
		if !c.isContainerEnabled(labels) {
			continue
		}
		image, err := c.GetImageWithRemote(item.Config.Image, noCache, includeRemote)
		if err != nil {
			return nil, err
		}
		stackName := labels["com.docker.compose.project"]
		serviceName := labels["com.docker.compose.service"]
		container := DockerContainer{
			ID:          item.ID,
			CreatedAt:   item.Created,
			Uptime:      formatUptime(item.State.StartedAt),
			Image:       image,
			Labels:      labels,
			Name:        strings.TrimPrefix(item.Name, "/"),
			Ports:       mapPorts(item.NetworkSettings.Ports),
			Status:      normalizeStatus(item.State.Status),
			StackName:   stackName,
			ServiceName: serviceName,
		}
		container.HomepageURL = c.homepageURL(container)
		container.HasUpdates = image != nil && image.LatestUpdate.After(image.CreatedAt)
		containers = append(containers, container)
	}

	sort.Slice(containers, func(i, j int) bool { return containers[i].CreatedAt.After(containers[j].CreatedAt) })
	return containers, nil
}

func (c *DockerClient) scanComposeStacks() ([]DockerStack, error) {
	if len(c.settings.Server.StacksPaths) == 0 {
		return nil, nil
	}

	stacksByName := make(map[string]DockerStack)
	for _, root := range c.settings.Server.StacksPaths {
		if root == "" {
			continue
		}
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			if !isComposeFile(d.Name()) {
				return nil
			}
			stackName, folderName, services, err := c.parseComposeFile(path)
			if err != nil {
				return err
			}
			if stackName == "" {
				stackName = folderName
			}
			stack := stacksByName[stackName]
			stack.Name = stackName
			stack.FolderName = folderName
			stack.ConfigFiles = appendUnique(stack.ConfigFiles, path)
			stack.Services = mergeComposeServices(stack.Services, services)
			stacksByName[stackName] = stack
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	stacks := make([]DockerStack, 0, len(stacksByName))
	for _, stack := range stacksByName {
		if len(stack.Services) == 0 {
			stack.Services = []DockerContainer{placeholderService(stack.Name)}
		}
		stack.HasUpdates = stackHasUpdates(stack.Services)
		stacks = append(stacks, stack)
	}
	sort.Slice(stacks, func(i, j int) bool { return stacks[i].Name < stacks[j].Name })
	return stacks, nil
}

func isComposeFile(name string) bool {
	lower := strings.ToLower(name)
	switch lower {
	case "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml":
		return true
	default:
		return false
	}
}

func appendUnique(items []string, value string) []string {
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}

func placeholderService(stackName string) DockerContainer {
	return DockerContainer{
		ID:          "not-loaded",
		CreatedAt:   time.Time{},
		Uptime:      "Not loaded",
		Image:       nil,
		Labels:      map[string]string{},
		Name:        stackName + " (not loaded)",
		ContainerName: "",
		Ports:       map[string][]DockerContainerPort{},
		Status:      "not-loaded",
		StackName:   stackName,
		ServiceName: "not-loaded",
		HomepageURL: "",
		HasUpdates:  false,
	}
}

type ImageStatus struct {
	Running int
	Stopped int
}

func (c *DockerClient) ListLocalImages(noCache bool, includeRemote bool) ([]DockerImage, map[string]*DockerImage, map[string]*DockerImage, error) {
	out, err := runCommand("docker", "image", "ls", "--digests", "--format", "{{.Repository}}|{{.Tag}}|{{.Digest}}|{{.ID}}")
	if err != nil {
		return nil, nil, nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	images := make([]DockerImage, 0, len(lines))
	byTag := make(map[string]*DockerImage)
	byID := make(map[string]*DockerImage)
	for _, line := range lines {
		parts := strings.Split(line, "|")
		if len(parts) < 4 {
			continue
		}
		repo := parts[0]
		tag := parts[1]
		digest := parts[2]
		imageID := parts[3]
		if repo == "<none>" || repo == "" {
			continue
		}
		repoTag := ""
		if digest != "" && digest != "<none>" {
			if tag != "" && tag != "<none>" {
				repoTag = fmt.Sprintf("%s:%s@%s", repo, tag, digest)
			} else {
				repoTag = fmt.Sprintf("%s@%s", repo, digest)
			}
		} else if tag != "" && tag != "<none>" {
			repoTag = fmt.Sprintf("%s:%s", repo, tag)
		}
		if repoTag == "" {
			continue
		}
		img, err := c.GetImageWithRemote(repoTag, noCache, includeRemote)
		if err != nil || img == nil {
			continue
		}
		if img.ID == "" && imageID != "" {
			img.ID = imageID
		}
		images = append(images, *img)
		byTag[repoTag] = img
		if img.ID != "" {
			byID[img.ID] = img
		}
	}
	return images, byTag, byID, nil
}

func (c *DockerClient) ListImageEntries(noCache bool, includeRemote bool) ([]ImageEntry, error) {
	images, byTag, _, err := c.ListLocalImages(noCache, includeRemote)
	if err != nil {
		return nil, err
	}
	containers, err := c.listAllContainers(true)
	if err != nil {
		return nil, err
	}
	statusMap := make(map[string]*ImageStatus)
	for _, item := range containers {
		imageKey := item.Config.Image
		if imageKey == "" {
			imageKey = item.Image
		}
		if imageKey == "" {
			continue
		}
		addStatus(statusMap, imageKey, normalizeStatus(item.State.Status))
	}

	entries := make([]ImageEntry, 0, len(images))
	for _, img := range images {
		status := statusMap[img.RepoTag]
		if status == nil {
			status = statusForRepoTag(statusMap, img.RepoTag)
		}
		entry := ImageEntry{
			Image:      img,
			RepoTag:    img.RepoTag,
			Status:     "stopped",
			HasUpdates: img.LatestUpdate.After(img.CreatedAt),
			HomepageURL: img.HomepageURL,
		}
		if entry.HomepageURL == "" {
			entry.HomepageURL = c.homepageURLFromImage(img.RepoTag, nil)
		}
		if status != nil {
			entry.ContainersRunning = status.Running
			entry.ContainersStopped = status.Stopped
			if status.Running > 0 {
				entry.Status = "running"
			}
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].RepoTag < entries[j].RepoTag })
	_ = byTag
	return entries, nil
}

func (c *DockerClient) listAllContainers(includeStopped bool) ([]containerInspect, error) {
	args := []string{"ps", "--format", "{{.ID}}"}
	if includeStopped {
		args = []string{"ps", "-a", "--format", "{{.ID}}"}
	}
	out, err := runCommand("docker", args...)
	if err != nil {
		return nil, err
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return nil, nil
	}
	inspectOut, err := runCommand("docker", append([]string{"inspect"}, ids...)...)
	if err != nil {
		return nil, err
	}
	var inspectData []containerInspect
	if err := json.Unmarshal(inspectOut, &inspectData); err != nil {
		return nil, err
	}
	return inspectData, nil
}

func (c *DockerClient) buildContainerFromInspect(item containerInspect, imageMap map[string]*DockerImage, noCache bool) (DockerContainer, error) {
	labels := item.Config.Labels
	imageRef := item.Config.Image
	image := matchImageForRef(imageMap, imageRef)
	if image == nil && imageRef != "" {
		img, err := c.GetImageWithRemote(imageRef, noCache, true)
		if err != nil {
			return DockerContainer{}, err
		}
		image = img
	}
	stackName := labels["com.docker.compose.project"]
	serviceName := labels["com.docker.compose.service"]
	containerName := strings.TrimPrefix(item.Name, "/")
	container := DockerContainer{
		ID:            item.ID,
		CreatedAt:     item.Created,
		Uptime:        formatUptime(item.State.StartedAt),
		Image:         image,
		Labels:        labels,
		Name:          containerName,
		ContainerName: containerName,
		Ports:         mapPorts(item.NetworkSettings.Ports),
		Status:        normalizeStatus(item.State.Status),
		StackName:     stackName,
		ServiceName:   serviceName,
	}
	container.HomepageURL = c.homepageURLFromImage(imageRef, labels)
	if image != nil {
		container.HasUpdates = image.LatestUpdate.After(image.CreatedAt)
	}
	return container, nil
}

func (c *DockerClient) PullImage(repoTag string) ([]string, error) {
	output := []string{}
	cmd := exec.Command("docker", "pull", repoTag)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return output, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return output, err
	}
	reader := bufio.NewReader(stdout)
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			line = strings.TrimSpace(line)
			if line != "" {
				output = append(output, line)
			}
		}
		if err != nil {
			break
		}
	}
	return output, cmd.Wait()
}

func (c *DockerClient) parseComposeFile(path string) (string, string, []DockerContainer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", nil, err
	}
	var compose composeFile
	if err := yaml.Unmarshal(data, &compose); err != nil {
		return "", "", nil, err
	}
	folderName := filepath.Base(filepath.Dir(path))
	stackName := compose.Name
	if stackName == "" {
		stackName = folderName
	}
	env := loadEnvFile(filepath.Dir(path))

	services := make([]DockerContainer, 0, len(compose.Services))
	for name, svc := range compose.Services {
		imageRef := resolveEnvVars(svc.Image, env)
		if imageRef != "" && !strings.Contains(imageRef, ":") && !strings.Contains(imageRef, "@") {
			imageRef = imageRef + ":latest"
		}
		containerName := resolveEnvVars(svc.ContainerName, env)
		container := DockerContainer{
			ID:            "not-loaded",
			CreatedAt:     time.Time{},
			Uptime:        "Not loaded",
			Image:         nil,
			Labels:        map[string]string{},
			Name:          containerName,
			ContainerName: containerName,
			Ports:         map[string][]DockerContainerPort{},
			Status:        "not-loaded",
			StackName:     stackName,
			ServiceName:   name,
			HomepageURL:   "",
			HasUpdates:    false,
		}
		if container.Name == "" {
			container.Name = name
		}
		if imageRef != "" {
			container.Image = &DockerImage{
				RepoTag:      imageRef,
				CreatedAt:    time.Time{},
				LatestUpdate: time.Time{},
			}
		}
		services = append(services, container)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].ServiceName < services[j].ServiceName })
	return stackName, folderName, services, nil
}

func mergeComposeServices(existing []DockerContainer, incoming []DockerContainer) []DockerContainer {
	if len(existing) == 0 {
		return incoming
	}
	index := make(map[string]DockerContainer, len(existing))
	for _, svc := range existing {
		index[svc.ServiceName] = svc
	}
	for _, svc := range incoming {
		index[svc.ServiceName] = svc
	}
	merged := make([]DockerContainer, 0, len(index))
	for _, svc := range index {
		merged = append(merged, svc)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].ServiceName < merged[j].ServiceName })
	return merged
}

type composeFile struct {
	Name     string                    `yaml:"name"`
	Services map[string]composeService `yaml:"services"`
}

type composeService struct {
	Image         string `yaml:"image"`
	ContainerName string `yaml:"container_name"`
}

func loadEnvFile(dir string) map[string]string {
	env := map[string]string{}
	path := filepath.Join(dir, ".env")
	data, err := os.ReadFile(path)
	if err != nil {
		return env
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.Trim(strings.TrimSpace(parts[1]), "\"")
		env[key] = val
	}
	return env
}

var envPattern = regexp.MustCompile(`\$\{([^}:]+)(:-([^}]*))?\}`)

func resolveEnvVars(value string, env map[string]string) string {
	if value == "" {
		return value
	}
	return envPattern.ReplaceAllStringFunc(value, func(match string) string {
		sub := envPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := sub[1]
		def := ""
		if len(sub) > 3 {
			def = sub[3]
		}
		if v, ok := env[key]; ok {
			return v
		}
		if v := os.Getenv(key); v != "" {
			return v
		}
		return def
	})
}

func (c *DockerClient) GetImage(repositoryOrTag string, noCache bool) (*DockerImage, error) {
	return c.GetImageWithRemote(repositoryOrTag, noCache, true)
}

func (c *DockerClient) GetImageWithRemote(repositoryOrTag string, noCache bool, includeRemote bool) (*DockerImage, error) {
	if !includeRemote {
		img, err := c.getLocalImage(repositoryOrTag)
		if err != nil || img == nil {
			return img, err
		}
		if cached, ok := c.regctl.GetCached(img.RepoTag); ok {
			if !cached.LatestUpdate.IsZero() {
				img.LatestUpdate = cached.LatestUpdate
			}
			if cached.LatestVersion != "" {
				img.LatestVersion = cached.LatestVersion
			}
		}
		return img, nil
	}
	ref := normalizeImageRef(repositoryOrTag, c.settings.Server.IgnoredImagePrefixes)
	inspectOut, err := runCommand("docker", "image", "inspect", ref.Lookup)
	if err != nil {
		return nil, err
	}
	var images []imageInspect
	if err := json.Unmarshal(inspectOut, &images); err != nil {
		return nil, err
	}
	if len(images) == 0 {
		return nil, nil
	}
	img := images[0]
	repoTag := resolveRepoTag(img, ref)
	localDigest := ""
	if len(img.RepoDigests) > 0 {
		localDigest = img.RepoDigests[0]
	}
	version := firstLabel(img.Config.Labels, c.settings.Server.PossibleImageLabels)
	homepageURL := c.homepageURLFromImage(repoTag, img.Config.Labels)
	latestUpdate := img.Created
	latestVersion := ""
	if localDigest != "" && repoTag != "" && !strings.Contains(repoTag, "@sha256:") {
		digestRef, err := c.regctl.GetImageRemoteDigest(repoTag, noCache)
		if err == ErrRateLimited {
			// stop further remote checks; fall back to cached values if any
			if cached, ok := c.regctl.GetCached(repoTag); ok {
				if !cached.LatestUpdate.IsZero() {
					latestUpdate = cached.LatestUpdate
				}
				if cached.LatestVersion != "" {
					latestVersion = cached.LatestVersion
				}
			}
		} else if err == nil && digestRef != "" {
			inspect, err := c.regctl.GetImageInspect(digestRef, noCache)
			if err == ErrRateLimited {
				if cached, ok := c.regctl.GetCached(repoTag); ok {
					if !cached.LatestUpdate.IsZero() {
						latestUpdate = cached.LatestUpdate
					}
					if cached.LatestVersion != "" {
						latestVersion = cached.LatestVersion
					}
				}
			} else if err == nil && inspect != nil {
				latestUpdate = inspect.Created
				latestVersion = firstLabel(inspect.Config.Labels, c.settings.Server.PossibleImageLabels)
				c.regctl.UpdateCache(repoTag, latestUpdate, latestVersion)
			}
		}
	}
	if cached, ok := c.regctl.GetCached(repoTag); ok {
		if !cached.LatestUpdate.IsZero() {
			latestUpdate = cached.LatestUpdate
		}
		if cached.LatestVersion != "" {
			latestVersion = cached.LatestVersion
		}
	}

	return &DockerImage{
		ID:              img.ID,
		CreatedAt:       img.Created,
		LatestUpdate:    latestUpdate,
		LatestVersion:   latestVersion,
		RepoLocalDigest: localDigest,
		RepoTag:         repoTag,
		Version:         version,
		HomepageURL:     homepageURL,
	}, nil
}

func (c *DockerClient) getLocalImage(repositoryOrTag string) (*DockerImage, error) {
	ref := normalizeImageRef(repositoryOrTag, c.settings.Server.IgnoredImagePrefixes)
	inspectOut, err := runCommand("docker", "image", "inspect", ref.Lookup)
	if err != nil {
		return nil, err
	}
	var images []imageInspect
	if err := json.Unmarshal(inspectOut, &images); err != nil {
		return nil, err
	}
	if len(images) == 0 {
		return nil, nil
	}
	img := images[0]
	repoTag := resolveRepoTag(img, ref)
	localDigest := ""
	if len(img.RepoDigests) > 0 {
		localDigest = img.RepoDigests[0]
	}
	version := firstLabel(img.Config.Labels, c.settings.Server.PossibleImageLabels)
	homepageURL := c.homepageURLFromImage(repoTag, img.Config.Labels)
	return &DockerImage{
		ID:              img.ID,
		CreatedAt:       img.Created,
		LatestUpdate:    img.Created,
		LatestVersion:   "",
		RepoLocalDigest: localDigest,
		RepoTag:         repoTag,
		Version:         version,
		HomepageURL:     homepageURL,
	}, nil
}

func (c *DockerClient) UpdateComposeStack(task *Task, stackName string, services []string, req DockerStackUpdateRequest) error {
	stack, err := c.findStack(stackName)
	if err != nil {
		return err
	}

	envFile := ""
	if req.InferEnvFile {
		for _, file := range stack.ConfigFiles {
			if tryEnv := replaceExt(file, ".env"); fileExists(tryEnv) {
				envFile = tryEnv
				break
			}
			if tryEnv := filepath.Join(filepath.Dir(file), ".env"); fileExists(tryEnv) {
				envFile = tryEnv
				break
			}
		}
	}

	if req.RestartContainers {
		task.Append(Message{Stage: "docker compose up --pull always"})
		if !c.settings.Server.DryRun {
			if err := runCompose(task, stack.ConfigFiles, envFile, services, true); err != nil {
				return err
			}
		} else {
			simulateOutput(task, "docker compose up --pull always")
		}
	} else {
		task.Append(Message{Stage: "docker compose pull"})
		if !c.settings.Server.DryRun {
			if err := runComposePull(task, stack.ConfigFiles, envFile, services); err != nil {
				return err
			}
		} else {
			simulateOutput(task, "docker compose pull")
		}
	}

	if req.PruneImages {
		task.Append(Message{Stage: "docker image prune"})
		if !c.settings.Server.DryRun {
			if err := runPrune(task); err != nil {
				return err
			}
		} else {
			simulateOutput(task, "docker image prune")
		}
	}

	return nil
}

func (c *DockerClient) findStack(name string) (DockerStack, error) {
	stacks, err := c.ListComposeStacks(true, true, true)
	if err != nil {
		return DockerStack{}, err
	}
	for _, stack := range stacks {
		if stack.Name == name {
			return stack, nil
		}
	}
	return DockerStack{}, errStackNotFound
}

func stackHasUpdates(services []DockerContainer) bool {
	for _, svc := range services {
		if svc.HasUpdates {
			return true
		}
	}
	return false
}

func (c *DockerClient) isContainerEnabled(labels map[string]string) bool {
	if labels == nil {
		return false
	}
	isOptOut := c.settings.Server.DiscoveryStrategy == DiscoveryOptOut
	defaultValue := "false"
	if isOptOut {
		defaultValue = "true"
	}
	value := labels[c.settings.Server.EnabledLabelFieldName]
	if value == "" {
		value = defaultValue
	}
	return strings.EqualFold(value, "true")
}

func (c *DockerClient) homepageURL(container DockerContainer) string {
	for _, label := range c.settings.Server.PossibleHomepageLabels {
		if url := container.Labels[label]; url != "" {
			return url
		}
	}
	if container.Image != nil && strings.HasPrefix(container.Image.RepoTag, "ghcr.io/") {
		imageName := strings.TrimPrefix(container.Image.RepoTag, "ghcr.io/")
		return fmt.Sprintf("http://github.com/%s", imageName)
	}
	if container.Image != nil {
		name := strings.Split(container.Image.RepoTag, ":")[0]
		return fmt.Sprintf("http://hub.docker.com/r/%s", name)
	}
	return ""
}

func (c *DockerClient) homepageURLFromImage(imageRef string, labels map[string]string) string {
	for _, label := range c.settings.Server.PossibleHomepageLabels {
		if url := labels[label]; url != "" {
			return url
		}
	}
	if imageRef == "" {
		for _, label := range c.settings.Server.PossibleHomepageLabels {
			if url := labels[label]; url != "" {
				return url
			}
		}
		return ""
	}
	repo := imageRef
	if strings.Contains(repo, "@") {
		repo = strings.SplitN(repo, "@", 2)[0]
	}
	if strings.Contains(repo, ":") {
		repo = strings.SplitN(repo, ":", 2)[0]
	}
	repo = strings.TrimPrefix(repo, "docker.io/")
	repo = strings.TrimPrefix(repo, "library/")
	if strings.HasPrefix(repo, "ghcr.io/") {
		return fmt.Sprintf("http://github.com/%s", strings.TrimPrefix(repo, "ghcr.io/"))
	}
	return fmt.Sprintf("http://hub.docker.com/r/%s", repo)
}

func (c *DockerClient) ignoreStackPattern() *regexp.Regexp {
	if len(c.settings.Server.IgnoreStackNameKeywords) == 0 {
		return nil
	}
	parts := make([]string, 0, len(c.settings.Server.IgnoreStackNameKeywords))
	for _, item := range c.settings.Server.IgnoreStackNameKeywords {
		parts = append(parts, fmt.Sprintf("(%s)", item))
	}
	return regexp.MustCompile(strings.Join(parts, "|"))
}

func runCompose(task *Task, files []string, envFile string, services []string, pull bool) error {
	args := []string{"compose"}
	for _, file := range files {
		args = append(args, "-f", file)
	}
	if envFile != "" {
		args = append(args, "--env-file", envFile)
	}
	args = append(args, "up", "-d")
	if pull {
		args = append(args, "--pull", "always")
	}
	args = append(args, services...)
	return streamCommand(task, "docker", args...)
}

func runComposePull(task *Task, files []string, envFile string, services []string) error {
	args := []string{"compose"}
	for _, file := range files {
		args = append(args, "-f", file)
	}
	if envFile != "" {
		args = append(args, "--env-file", envFile)
	}
	args = append(args, "pull")
	args = append(args, services...)
	return streamCommand(task, "docker", args...)
}

func runPrune(task *Task) error {
	return streamCommand(task, "docker", "image", "prune", "-f")
}

func streamCommand(task *Task, cmd string, args ...string) error {
	command := exec.Command(cmd, args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	command.Stderr = command.Stdout
	if err := command.Start(); err != nil {
		return err
	}

	reader := bufio.NewReader(stdout)
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			line = strings.TrimSpace(line)
			if line != "" {
				msg := line
				task.Append(Message{Stage: task.CurrentStage(), Message: &msg})
			}
		}
		if err != nil {
			break
		}
	}
	return command.Wait()
}

func simulateOutput(task *Task, stage string) {
	for i := 1; i <= 30; i++ {
		msg := fmt.Sprintf("test line %d/30", i)
		task.Append(Message{Stage: stage, Message: &msg})
		time.Sleep(100 * time.Millisecond)
	}
}

func runCommand(cmd string, args ...string) ([]byte, error) {
	command := exec.Command(cmd, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("%s %s: %w (%s)", cmd, strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

func extractConfigFiles(raw any) []string {
	switch v := raw.(type) {
	case string:
		return splitConfigFiles(v)
	case []any:
		items := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				items = append(items, s)
			}
		}
		return items
	default:
		return nil
	}
}

func splitConfigFiles(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	files := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			files = append(files, trimmed)
		}
	}
	return files
}

type imageRef struct {
	Repo   string
	Tag    string
	Digest string
	Lookup string
}

func normalizeImageRef(ref string, prefixes []string) imageRef {
	original := ref
	for _, prefix := range prefixes {
		if strings.HasPrefix(ref, prefix) {
			ref = strings.TrimPrefix(ref, prefix)
		}
	}

	repo := ref
	tag := ""
	digest := ""
	if strings.Contains(ref, "@") {
		parts := strings.SplitN(ref, "@", 2)
		repo = parts[0]
		digest = parts[1]
	}
	if strings.Contains(repo, ":") {
		parts := strings.SplitN(repo, ":", 2)
		repo = parts[0]
		tag = parts[1]
	}

	lookup := repo
	if digest != "" {
		lookup = fmt.Sprintf("%s@%s", repo, digest)
	} else if tag != "" {
		lookup = fmt.Sprintf("%s:%s", repo, tag)
	}

	if lookup == "" {
		lookup = original
	}

	return imageRef{Repo: repo, Tag: tag, Digest: digest, Lookup: lookup}
}

func resolveRepoTag(img imageInspect, ref imageRef) string {
	if len(img.RepoTags) > 0 {
		return img.RepoTags[0]
	}
	if len(img.RepoDigests) > 0 {
		parts := strings.SplitN(img.RepoDigests[0], "@", 2)
		return parts[0]
	}
	if ref.Lookup != "" {
		return ref.Lookup
	}
	return ""
}

func firstLabel(labels map[string]string, candidates []string) string {
	if labels == nil {
		return ""
	}
	for _, label := range candidates {
		if v := labels[label]; v != "" {
			return v
		}
	}
	return ""
}

func matchImageForRef(imageMap map[string]*DockerImage, ref string) *DockerImage {
	if img := imageMap[ref]; img != nil {
		return img
	}
	parsed := normalizeImageRef(ref, []string{"docker.io/", "docker.io/library/"})
	repo := parsed.Repo
	if strings.HasPrefix(repo, "docker.io/") {
		repo = strings.TrimPrefix(repo, "docker.io/")
	}
	if strings.HasPrefix(repo, "library/") {
		repo = strings.TrimPrefix(repo, "library/")
	}
	candidates := []string{}
	if parsed.Digest != "" {
		if parsed.Tag != "" {
			candidates = append(candidates, fmt.Sprintf("%s:%s@%s", repo, parsed.Tag, parsed.Digest))
		}
		candidates = append(candidates, fmt.Sprintf("%s@%s", repo, parsed.Digest))
	}
	if parsed.Tag != "" {
		candidates = append(candidates, fmt.Sprintf("%s:%s", repo, parsed.Tag))
	}
	candidates = append(candidates, repo)
	for _, key := range candidates {
		if img := imageMap[key]; img != nil {
			return img
		}
	}
	for key, img := range imageMap {
		if strings.HasPrefix(key, repo+":") || strings.HasPrefix(key, repo+"@") {
			return img
		}
	}
	return nil
}

func addStatus(statusMap map[string]*ImageStatus, imageRef string, status string) {
	parsed := normalizeImageRef(imageRef, []string{"docker.io/", "docker.io/library/"})
	repo := parsed.Repo
	if strings.HasPrefix(repo, "docker.io/") {
		repo = strings.TrimPrefix(repo, "docker.io/")
	}
	if strings.HasPrefix(repo, "library/") {
		repo = strings.TrimPrefix(repo, "library/")
	}
	candidates := []string{}
	if repo != "" {
		if parsed.Tag != "" && parsed.Digest != "" {
			candidates = append(candidates, fmt.Sprintf("%s:%s@%s", repo, parsed.Tag, parsed.Digest))
		}
		if parsed.Digest != "" {
			candidates = append(candidates, fmt.Sprintf("%s@%s", repo, parsed.Digest))
		}
		if parsed.Tag != "" {
			candidates = append(candidates, fmt.Sprintf("%s:%s", repo, parsed.Tag))
		}
		candidates = append(candidates, repo)
	}
	if len(candidates) == 0 {
		candidates = append(candidates, imageRef)
	}
	for _, key := range candidates {
		stat := statusMap[key]
		if stat == nil {
			stat = &ImageStatus{}
			statusMap[key] = stat
		}
		if status == "running" {
			stat.Running++
		} else {
			stat.Stopped++
		}
	}
}

func statusForRepoTag(statusMap map[string]*ImageStatus, repoTag string) *ImageStatus {
	if stat := statusMap[repoTag]; stat != nil {
		return stat
	}
	parsed := normalizeImageRef(repoTag, []string{"docker.io/", "docker.io/library/"})
	repo := parsed.Repo
	if strings.HasPrefix(repo, "docker.io/") {
		repo = strings.TrimPrefix(repo, "docker.io/")
	}
	if strings.HasPrefix(repo, "library/") {
		repo = strings.TrimPrefix(repo, "library/")
	}
	if repo != "" {
		if parsed.Tag != "" && parsed.Digest != "" {
			if stat := statusMap[fmt.Sprintf("%s:%s@%s", repo, parsed.Tag, parsed.Digest)]; stat != nil {
				return stat
			}
		}
		if parsed.Digest != "" {
			if stat := statusMap[fmt.Sprintf("%s@%s", repo, parsed.Digest)]; stat != nil {
				return stat
			}
		}
		if parsed.Tag != "" {
			if stat := statusMap[fmt.Sprintf("%s:%s", repo, parsed.Tag)]; stat != nil {
				return stat
			}
		}
		if stat := statusMap[repo]; stat != nil {
			return stat
		}
	}
	return nil
}

func replaceExt(path string, ext string) string {
	base := strings.TrimSuffix(path, filepath.Ext(path))
	return base + ext
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	if _, err := os.Stat(path); err == nil {
		return true
	}
	return false
}

type containerInspect struct {
	ID      string    `json:"Id"`
	Image   string    `json:"Image"`
	Name    string    `json:"Name"`
	Created time.Time `json:"Created"`
	Config  struct {
		Image  string            `json:"Image"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Status    string    `json:"Status"`
		StartedAt time.Time `json:"StartedAt"`
	} `json:"State"`
	NetworkSettings struct {
		Ports map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"Ports"`
	} `json:"NetworkSettings"`
}

type imageInspect struct {
	ID         string    `json:"Id"`
	Created    time.Time `json:"Created"`
	RepoTags   []string  `json:"RepoTags"`
	RepoDigests []string `json:"RepoDigests"`
	Config     struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
}

func mapPorts(ports map[string][]struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}) map[string][]DockerContainerPort {
	if ports == nil {
		return map[string][]DockerContainerPort{}
	}
	res := make(map[string][]DockerContainerPort, len(ports))
	for key, items := range ports {
		mapped := make([]DockerContainerPort, 0, len(items))
		for _, item := range items {
			if item.HostPort == "" {
				continue
			}
			port, _ := strconv.Atoi(item.HostPort)
			mapped = append(mapped, DockerContainerPort{HostIP: item.HostIP, HostPort: port})
		}
		res[key] = mapped
	}
	return res
}

func formatUptime(start time.Time) string {
	if start.IsZero() {
		return ""
	}
	delta := time.Since(start)
	if delta < 0 {
		delta = 0
	}
	days := int(delta.Hours()) / 24
	if days > 0 {
		return fmt.Sprintf("Up %d day%s", days, plural(days))
	}
	hours := int(delta.Hours())
	if hours > 0 {
		return fmt.Sprintf("Up %d hour%s", hours, plural(hours))
	}
	minutes := int(delta.Minutes())
	if minutes > 0 {
		return fmt.Sprintf("Up %d minute%s", minutes, plural(minutes))
	}
	seconds := int(delta.Seconds())
	return fmt.Sprintf("Up %d second%s", seconds, plural(seconds))
}

func plural(v int) string {
	if v == 1 {
		return ""
	}
	return "s"
}

func normalizeStatus(status string) string {
	switch strings.ToLower(status) {
	case "running":
		return "running"
	case "exited", "dead", "created", "paused", "restarting", "stopped":
		return "stopped"
	default:
		return "stopped"
	}
}
