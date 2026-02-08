package app

import (
	"io"
	"mime"
	"net/http"
	"path"
	"strings"

	webassets "dockobserver/web"
)

func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if p == "/" || p == "" {
		p = "index.html"
	} else {
		p = strings.TrimPrefix(p, "/")
	}
	p = path.Clean(p)
	if strings.HasPrefix(p, "..") {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
		return
	}
	file, err := webassets.FS.Open(p)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not found"})
		return
	}
	defer file.Close()
	if contentType := mime.TypeByExtension(path.Ext(p)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	io.Copy(w, file)
}
