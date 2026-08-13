package main
import (
	"fmt"
	"os/exec"
	"syscall"
)
func main() {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`explorer.exe /select,"%s"`, "C:\\Users\\soumy\\Downloads\\test [1080p].txt"),
	}
	_ = cmd.Start()
}
