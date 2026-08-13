package server

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"

	"github.com/fukyt/host/internal/logging"
)

type Server struct {
	port       int
	stagingDir string
	mu         sync.RWMutex
}

var (
	globalServer *Server
	once         sync.Once
)

func Start(stagingDir string) (int, error) {
	var startErr error
	once.Do(func() {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			startErr = fmt.Errorf("server: failed to bind loopback: %w", err)
			return
		}

		port := listener.Addr().(*net.TCPAddr).Port

		s := &Server{
			port:       port,
			stagingDir: stagingDir,
		}
		globalServer = s

		mux := http.NewServeMux()
		fileServer := http.FileServer(http.Dir(stagingDir))

		// Serve files with CORS headers and cache disable
		mux.HandleFunc("/files/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			http.StripPrefix("/files/", fileServer).ServeHTTP(w, r)
		})

		logging.Info("server: local HTTP file server started", map[string]interface{}{
			"port":       port,
			"stagingDir": stagingDir,
		})

		go func() {
			if err := http.Serve(listener, mux); err != nil {
				logging.Warn("server: http server stopped: " + err.Error())
			}
		}()
	})

	if globalServer != nil {
		return globalServer.port, nil
	}
	return 0, startErr
}

func GetDownloadURL(filename string) string {
	if globalServer == nil {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d/files/%s", globalServer.port, url.PathEscape(filename))
}
