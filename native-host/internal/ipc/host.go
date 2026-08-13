// Package ipc handles Chrome Native Messaging framing over stdin/stdout.
// Protocol: 4-byte little-endian uint32 message length, followed by JSON payload.
package ipc

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/fukyt/host/internal/logging"
)

const maxMessageSize = 1 * 1024 * 1024 // 1 MB safety limit

// RawMessage is a parsed incoming message with the type extracted.
type RawMessage struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Raw       json.RawMessage // full message for further parsing
}

// Host manages the stdin/stdout IPC connection with Chrome.
type Host struct {
	in  io.Reader
	out io.Writer
	mu  sync.Mutex // guards stdout writes
}

// New creates a new Host using os.Stdin/Stdout.
func New() *Host {
	return &Host{in: os.Stdin, out: os.Stdout}
}

// Read blocks until a full message is received from Chrome.
// Returns an error if the message is malformed, too large, or EOF.
func (h *Host) Read() (*RawMessage, error) {
	// Read 4-byte length prefix (little-endian)
	var lenBuf [4]byte
	if _, err := io.ReadFull(h.in, lenBuf[:]); err != nil {
		if err == io.EOF {
			return nil, io.EOF
		}
		return nil, fmt.Errorf("ipc: read length: %w", err)
	}
	msgLen := binary.LittleEndian.Uint32(lenBuf[:])

	if msgLen == 0 {
		return nil, fmt.Errorf("ipc: zero-length message")
	}
	if msgLen > maxMessageSize {
		return nil, fmt.Errorf("ipc: message too large: %d bytes", msgLen)
	}

	buf := make([]byte, msgLen)
	if _, err := io.ReadFull(h.in, buf); err != nil {
		return nil, fmt.Errorf("ipc: read body: %w", err)
	}

	logging.Debug("ipc: received raw message", map[string]interface{}{"len": msgLen})

	var raw struct {
		Type      string `json:"type"`
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(buf, &raw); err != nil {
		return nil, fmt.Errorf("ipc: JSON unmarshal: %w", err)
	}

	return &RawMessage{
		Type:      raw.Type,
		RequestID: raw.RequestID,
		Raw:       json.RawMessage(buf),
	}, nil
}

// Send writes a JSON response to stdout with the 4-byte length prefix.
func (h *Host) Send(v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("ipc: marshal: %w", err)
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(b)))
	if _, err := h.out.Write(lenBuf[:]); err != nil {
		return fmt.Errorf("ipc: write length: %w", err)
	}
	if _, err := h.out.Write(b); err != nil {
		return fmt.Errorf("ipc: write body: %w", err)
	}
	return nil
}

// SendError sends a structured error response.
func (h *Host) SendError(requestID, code, message string) error {
	return h.Send(map[string]interface{}{
		"type":      "error",
		"requestId": requestID,
		"code":      code,
		"message":   message,
	})
}
