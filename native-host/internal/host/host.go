// Package host implements Chrome Native Messaging stdio framing.
// Protocol: 4-byte little-endian uint32 message length, followed by UTF-8 JSON payload.
// See: https://developer.chrome.com/docs/extensions/reference/api/runtime#native-messaging
package host


import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/fukyt/host/internal/logging"
)

const maxMessageSize = 1 * 1024 * 1024 // 1 MB Chrome limit

// RawMessage is a parsed incoming envelope with type and requestId extracted.
type RawMessage struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Payload   json.RawMessage `json:"payload"` // forwarded to handlers
	Raw       json.RawMessage // full message bytes
}

// Context returns a background context for use in handlers.
// Future versions may attach a deadline here.
func (m *RawMessage) Context() context.Context {
	return context.Background()
}

// Host manages the stdin/stdout Chrome Native Messaging connection.
type Host struct {
	in  io.Reader
	out io.Writer
	mu  sync.Mutex // guards stdout writes (multiple goroutines may push events)
}

// New creates a Host using os.Stdin/Stdout (the Chrome NM transport).
func New() *Host {
	return &Host{in: os.Stdin, out: os.Stdout}
}

// Read blocks until a complete message is received from Chrome.
// Returns io.EOF when Chrome disconnects.
// SEC-08: malformed payloads return an error without crashing.
func (h *Host) Read() (*RawMessage, error) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(h.in, lenBuf[:]); err != nil {
		return nil, err // caller checks for io.EOF
	}
	msgLen := binary.LittleEndian.Uint32(lenBuf[:])
	if msgLen == 0 {
		return nil, fmt.Errorf("host: zero-length message")
	}
	if msgLen > maxMessageSize {
		return nil, fmt.Errorf("host: message too large: %d bytes", msgLen)
	}

	buf := make([]byte, msgLen)
	if _, err := io.ReadFull(h.in, buf); err != nil {
		return nil, fmt.Errorf("host: read body: %w", err)
	}

	logging.Debug("host: received message", map[string]interface{}{"len": msgLen})

	var env struct {
		Type      string          `json:"type"`
		RequestID string          `json:"requestId"`
		Payload   json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(buf, &env); err != nil {
		return nil, fmt.Errorf("host: JSON unmarshal: %w", err)
	}

	return &RawMessage{
		Type:      env.Type,
		RequestID: env.RequestID,
		Payload:   env.Payload,
		Raw:       json.RawMessage(buf),
	}, nil
}

// Send writes a value as a length-prefixed JSON message to stdout.
// Thread-safe — multiple goroutines may call Send concurrently.
func (h *Host) Send(v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("host: marshal: %w", err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(b)))
	if _, err := h.out.Write(lenBuf[:]); err != nil {
		return fmt.Errorf("host: write length: %w", err)
	}
	if _, err := h.out.Write(b); err != nil {
		return fmt.Errorf("host: write body: %w", err)
	}
	return nil
}

// SendResponse sends a PRD §18-compliant response envelope.
func (h *Host) SendResponse(requestID string, payload interface{}) error {
	return h.Send(map[string]interface{}{
		"requestId": requestID,
		"ok":        true,
		"payload":   payload,
	})
}

// SendError sends a PRD §18-compliant error response.
// Never crashes the host (SEC-08).
func (h *Host) SendError(requestID, code, message string) error {
	return h.Send(map[string]interface{}{
		"requestId": requestID,
		"ok":        false,
		"error":     map[string]string{"code": code, "message": message},
	})
}

// SendPush sends an unsolicited push event (jobProgress / jobComplete / jobError).
func (h *Host) SendPush(eventType, jobID string, payload interface{}) error {
	return h.Send(map[string]interface{}{
		"type":    eventType,
		"jobId":   jobID,
		"payload": payload,
	})
}
