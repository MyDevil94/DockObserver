package app

import (
	"log"
	"sync"
	"time"
)

func (s *Server) StartAutoUpdater() {
	if !s.settings.AutoUpdater.Enabled {
		return
	}
	go func() {
		sem := make(chan struct{}, s.settings.AutoUpdater.MaxConcurrent)
		for {
			start := time.Now()
			stacks, err := s.docker.ListComposeStacks(true, false, true)
			if err != nil {
				log.Printf("auto-updater: list stacks failed: %v", err)
				time.Sleep(time.Duration(s.settings.AutoUpdater.IntervalSeconds) * time.Second)
				continue
			}
			var wg sync.WaitGroup
			for _, stack := range stacks {
				for _, svc := range stack.Services {
					if svc.HasUpdates {
						wg.Add(1)
						sem <- struct{}{}
						go func(stackName, serviceName string) {
							defer wg.Done()
							defer func() { <-sem }()
							batch := DockerStackBatchUpdateRequest{
								Services:          []string{stackName + "/" + serviceName},
								InferEnvFile:      true,
								PruneImages:       false,
								RestartContainers: true,
							}
							_ = s.startBatchUpdate(batch)
						}(stack.Name, svc.ServiceName)
					}
				}
			}
			wg.Wait()
			elapsed := time.Since(start)
			log.Printf("auto-updater cycle completed in %s", elapsed.Round(time.Second))
			sleep := time.Duration(s.settings.AutoUpdater.IntervalSeconds)*time.Second - elapsed
			if sleep < time.Second {
				sleep = time.Second
			}
			time.Sleep(sleep)
		}
	}()
}
