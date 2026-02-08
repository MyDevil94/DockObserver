package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	settings Settings
	docker   *DockerClient
	regctl   *RegctlClient
	cache    *TTLCache
	tasks    *TaskStore
}

func NewServer(settings Settings) *Server {
	cache := NewTTLCache()
	regctl := NewRegctlClient(settings, cache)
	docker := NewDockerClient(settings, regctl, cache)
	return &Server{
		settings: settings,
		docker:   docker,
		regctl:   regctl,
		cache:    cache,
		tasks:    NewTaskStore(),
	}
}

func (s *Server) Run(addr string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api", s.handleRoot)
	mux.HandleFunc("/api/", s.handleAPI)
	mux.HandleFunc("/", s.handleUI)

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	return server.ListenAndServe()
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api" {
		s.handleAPI(w, r)
		return
	}
	w.WriteHeader(http.StatusTeapot)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "This is not the endpoint you are looking for"})
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	switch {
	case path == "/settings" && r.Method == http.MethodGet:
		s.handleSettings(w, r)
	case path == "/stats" && r.Method == http.MethodGet:
		s.handleStats(w, r)
	case path == "/stacks" && r.Method == http.MethodGet:
		s.handleListStacks(w, r)
	case path == "/stacks/batch_update" && r.Method == http.MethodPost:
		s.handleBatchUpdate(w, r)
	case path == "/images" && r.Method == http.MethodGet:
		s.handleListImages(w, r)
	case path == "/images/pull" && r.Method == http.MethodPost:
		s.handlePullImage(w, r)
	case path == "/updates/last" && r.Method == http.MethodGet:
		s.handleLastUpdateCheck(w, r)
	case strings.HasPrefix(path, "/stacks/"):
		s.handleStacks(w, r, strings.TrimPrefix(path, "/stacks/"))
	case path == "/regctl/digest" && r.Method == http.MethodGet:
		s.handleRegctlDigest(w, r)
	case path == "/regctl/inspect" && r.Method == http.MethodGet:
		s.handleRegctlInspect(w, r)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
	}
}

func (s *Server) handleListImages(w http.ResponseWriter, r *http.Request) {
	noCache := parseBoolQuery(r, "no_cache")
	localOnly := parseBoolQuery(r, "local_only")
	images, err := s.docker.ListImageEntries(noCache, !localOnly)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (s *Server) handleLastUpdateCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"lastCheck":        s.regctl.LastCheck().Format(time.RFC3339),
		"rateLimitedUntil": s.regctl.RateLimitUntil().Format(time.RFC3339),
	})
}

type pullImageRequest struct {
	RepoTag string `json:"repoTag"`
}

func (s *Server) handlePullImage(w http.ResponseWriter, r *http.Request) {
	var req pullImageRequest
	if err := decodeJSON(r, &req); err != nil || req.RepoTag == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Missing repoTag"})
		return
	}
	output, err := s.docker.PullImage(req.RepoTag)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"message": err.Error(),
			"output":  output,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"output":  output,
		"success": true,
	})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.settings)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	noCache := parseBoolQuery(r, "no_cache")
	localOnly := parseBoolQuery(r, "local_only")
	stacks, err := s.docker.ListStacksMerged(noCache, false, !localOnly)
	if err != nil {
		writeError(w, err)
		return
	}
	stats := StatsResponse{}
	stats.NumOfStacks = len(stacks)
	for _, stack := range stacks {
		if stack.HasUpdates {
			stats.NumOfStacksWithUpdates++
		}
		for _, svc := range stack.Services {
			if svc.Status == "not-loaded" {
				continue
			}
			if svc.Image == nil {
				continue
			}
			stats.NumOfServices++
			if svc.HasUpdates {
				stats.NumOfServicesWithUpdates++
			}
		}
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleListStacks(w http.ResponseWriter, r *http.Request) {
	noCache := parseBoolQuery(r, "no_cache")
	includeStopped := parseBoolQuery(r, "include_stopped")
	localOnly := parseBoolQuery(r, "local_only")
	stacks, err := s.docker.ListStacksMerged(noCache, includeStopped, !localOnly)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stacks)
}

func (s *Server) handleStacks(w http.ResponseWriter, r *http.Request, rest string) {
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
		return
	}
	stack := parts[0]
	noCache := parseBoolQuery(r, "no_cache")

	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "Method not allowed"})
			return
		}
		item, err := s.docker.GetComposeStack(stack, noCache)
		if errors.Is(err, errStackNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": fmt.Sprintf("Compose stack %q not found", stack)})
			return
		}
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}

	service := parts[1]
	if len(parts) == 2 {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "Method not allowed"})
			return
		}
		item, err := s.docker.GetComposeService(stack, service, noCache)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": fmt.Sprintf("Compose stack service '%s/%s' not found", stack, service)})
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}

	if len(parts) == 3 && parts[2] == "task" {
		s.handleTask(w, r, stack, service)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
}

func (s *Server) handleTask(w http.ResponseWriter, r *http.Request, stack, service string) {
	switch r.Method {
	case http.MethodPost:
		var req DockerStackUpdateRequest
		if err := decodeJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid request"})
			return
		}
		batch := DockerStackBatchUpdateRequest{
			Services:          []string{fmt.Sprintf("%s/%s", stack, service)},
			InferEnvFile:      req.InferEnvFile,
			PruneImages:       req.PruneImages,
			RestartContainers: req.RestartContainers,
		}
		if err := s.startBatchUpdate(batch); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{})
	case http.MethodGet:
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		key := StoreKey{Stack: stack, Service: service}
		if task, ok := s.tasks.Get(key); ok {
			if task.IsDone() {
				s.cache.Clear()
			}
			writeJSON(w, http.StatusOK, task.Messages(offset))
			return
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": fmt.Sprintf("Compose stack service task '%s/%s' not found", stack, service)})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "Method not allowed"})
	}
}

func (s *Server) handleBatchUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "Method not allowed"})
		return
	}
	var req DockerStackBatchUpdateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid request"})
		return
	}
	if err := s.startBatchUpdate(req); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (s *Server) startBatchUpdate(req DockerStackBatchUpdateRequest) error {
	servicesByStack := map[string][]string{}
	for _, item := range req.Services {
		parts := strings.SplitN(item, "/", 2)
		if len(parts) != 2 {
			continue
		}
		servicesByStack[parts[0]] = append(servicesByStack[parts[0]], parts[1])
	}
	for stack, services := range servicesByStack {
		skip := false
		for _, svc := range services {
			if s.tasks.Exists(StoreKey{Stack: stack, Service: svc}) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		task := &Task{}
		for _, svc := range services {
			s.tasks.Set(StoreKey{Stack: stack, Service: svc}, task)
		}
		reqCopy := DockerStackUpdateRequest{
			InferEnvFile:      req.InferEnvFile,
			PruneImages:       req.PruneImages,
			RestartContainers: req.RestartContainers,
		}
		go func(stack string, services []string, task *Task) {
			task.Append(Message{Stage: "Starting"})
			err := s.docker.UpdateComposeStack(task, stack, services, reqCopy)
			if err != nil {
				errMsg := err.Error()
				task.Append(Message{Stage: "Error", Message: &errMsg})
			}
			task.Append(Message{Stage: "Finished"})
			task.Done(err)
		}(stack, services, task)
	}
	return nil
}

func (s *Server) handleRegctlDigest(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	if tag == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Missing tag"})
		return
	}
	res, err := s.regctl.GetImageRemoteDigest(tag, parseBoolQuery(r, "no_cache"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(res))
}

func (s *Server) handleRegctlInspect(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	if tag == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Missing tag"})
		return
	}
	res, err := s.regctl.GetImageInspect(tag, parseBoolQuery(r, "no_cache"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func parseBoolQuery(r *http.Request, key string) bool {
	val := r.URL.Query().Get(key)
	if val == "" {
		return false
	}
	b, _ := strconv.ParseBool(val)
	return b
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload != nil {
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			log.Printf("failed to write response: %v", err)
		}
	}
}

func writeError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
}
