package main

import (
	"context"
	"fmt"
	"github.com/fukyt/host/internal/ytdlp"
)

func main() {
	svc := ytdlp.New("yt-dlp.exe", nil)
	formats, err := svc.GetFormats(context.Background(), "dQw4w9WgXcQ", nil)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("Parsed %d formats\n", len(formats))
	for _, f := range formats {
		if f.Height != nil {
			fmt.Printf("Format: %s (H: %d)\n", f.FormatID, *f.Height)
		} else {
			fmt.Printf("Format: %s (H: nil)\n", f.FormatID)
		}
	}
}
