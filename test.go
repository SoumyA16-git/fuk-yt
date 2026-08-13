package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"os/exec"
)

func main() {
	cmd := exec.Command(".\\native-host\\bin\\host.exe")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		panic(err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		panic(err)
	}

	err = cmd.Start()
	if err != nil {
		panic(err)
	}

	msg := []byte(`{"type":"getEngineInfo","requestId":"test-123"}`)
	buf := new(bytes.Buffer)
	binary.Write(buf, binary.LittleEndian, uint32(len(msg)))
	buf.Write(msg)

	stdin.Write(buf.Bytes())

	go io.Copy(os.Stderr, stdout)

	cmd.Wait()
	fmt.Println("Done")
}
