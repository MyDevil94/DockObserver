package app

import (
	"sync"
)

type Task struct {
	mu       sync.Mutex
	messages []Message
	stage    string
	done     bool
	err      error
}

func (t *Task) Append(msg Message) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if msg.Stage != "" {
		t.stage = msg.Stage
	}
	t.messages = append(t.messages, msg)
}

func (t *Task) CurrentStage() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stage
}

func (t *Task) Done(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.done = true
	t.err = err
}

func (t *Task) IsDone() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.done
}

func (t *Task) Messages(offset int) []Message {
	t.mu.Lock()
	defer t.mu.Unlock()
	if offset < 0 || offset >= len(t.messages) {
		return []Message{}
	}
	return append([]Message(nil), t.messages[offset:]...)
}

type StoreKey struct {
	Stack   string
	Service string
}

type TaskStore struct {
	mu    sync.Mutex
	tasks map[StoreKey]*Task
}

func NewTaskStore() *TaskStore {
	return &TaskStore{tasks: make(map[StoreKey]*Task)}
}

func (s *TaskStore) Get(key StoreKey) (*Task, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.tasks[key]
	return item, ok
}

func (s *TaskStore) Set(key StoreKey, task *Task) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[key] = task
}

func (s *TaskStore) Exists(key StoreKey) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.tasks[key]
	return ok
}

