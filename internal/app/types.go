package app

import "time"

type DockerContainerPort struct {
	HostIP   string `json:"hostIp"`
	HostPort int    `json:"hostPort"`
}

type DockerImage struct {
	ID             string    `json:"id"`
	CreatedAt      time.Time `json:"createdAt"`
	LatestUpdate   time.Time `json:"latestUpdate"`
	LatestVersion  string    `json:"latestVersion,omitempty"`
	RepoLocalDigest string   `json:"repoLocalDigest"`
	RepoTag        string    `json:"repoTag"`
	Version        string    `json:"version,omitempty"`
	HomepageURL    string    `json:"homepageUrl,omitempty"`
}

type DockerContainer struct {
	ID        string                         `json:"id"`
	CreatedAt time.Time                      `json:"createdAt"`
	Uptime    string                         `json:"uptime"`
	Image     *DockerImage                   `json:"image"`
	Labels    map[string]string              `json:"labels"`
	Name      string                         `json:"name"`
	ContainerName string                     `json:"containerName"`
	Ports     map[string][]DockerContainerPort `json:"ports"`
	Status    string                         `json:"status"`
	StackName string                         `json:"stackName"`
	ServiceName string                       `json:"serviceName"`
	HomepageURL string                       `json:"homepageUrl"`
	HasUpdates bool                          `json:"hasUpdates"`
}

type DockerStack struct {
	Name       string           `json:"name"`
	FolderName string           `json:"folderName,omitempty"`
	Created    int              `json:"created"`
	Dead       int              `json:"dead"`
	Exited     int              `json:"exited"`
	Paused     int              `json:"paused"`
	Restarting int              `json:"restarting"`
	Running    int              `json:"running"`
	ConfigFiles []string        `json:"configFiles"`
	Services   []DockerContainer `json:"services"`
	HasUpdates bool             `json:"hasUpdates"`
}

type ImageEntry struct {
	Image             DockerImage `json:"image"`
	RepoTag           string      `json:"repoTag"`
	Status            string      `json:"status"`
	ContainersRunning int         `json:"containersRunning"`
	ContainersStopped int         `json:"containersStopped"`
	HasUpdates        bool        `json:"hasUpdates"`
	HomepageURL       string      `json:"homepageUrl"`
}

type DockerStackUpdateRequest struct {
	InferEnvFile      bool `json:"inferEnvfile"`
	PruneImages       bool `json:"pruneImages"`
	RestartContainers bool `json:"restartContainers"`
}

type DockerStackBatchUpdateRequest struct {
	Services          []string `json:"services"`
	InferEnvFile      bool     `json:"inferEnvfile"`
	PruneImages       bool     `json:"pruneImages"`
	RestartContainers bool     `json:"restartContainers"`
}

type Message struct {
	Stage   string  `json:"stage"`
	Message *string `json:"message"`
}

type StatsResponse struct {
	NumOfServicesWithUpdates int `json:"numOfServicesWithUpdates"`
	NumOfServices            int `json:"numOfServices"`
	NumOfStacksWithUpdates   int `json:"numOfStacksWithUpdates"`
	NumOfStacks              int `json:"numOfStacks"`
}
