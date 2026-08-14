package main

import (
	"context"
	"fmt"
	"os"

	"github.com/fukyt/host/internal/download"
	"github.com/fukyt/host/internal/ffmpeg"
	"github.com/fukyt/host/internal/files"
	"github.com/fukyt/host/internal/ytdlp"
)

func main() {
	cwd, _ := os.Getwd()
	ytdlpPath := cwd + "/../bin/yt-dlp.exe"
	ffmpegPath := cwd + "/../bin/ffmpeg.exe"
	ffprobePath := cwd + "/../bin/ffprobe.exe"
	storageDir := cwd + "/test_downloads"

	filesSvc := files.New(storageDir)
	ytdlpSvc := ytdlp.New(ytdlpPath, nil)
	ffmpegSvc := ffmpeg.New(ffmpegPath, ffprobePath, nil)
	downSvc := download.New(ytdlpSvc, ffmpegSvc, filesSvc)

	progressFn := func(percent float64, speed, eta *float64, down, tot *int64) {
		fmt.Printf("Progress: %.2f%%\n", percent)
	}

	fmt.Println("--- Testing Clip Audio ---")
	audioPath, err := downSvc.DownloadClip(context.Background(), "jNQXAC9IVRw", "Me at the zoo", 5, 10, "audio", "best", "mp3", "job1", progressFn, nil)
	if err != nil {
		fmt.Println("Clip Audio Error:", err)
	} else {
		fmt.Println("Clip Audio Success:", audioPath)
	}

	fmt.Println("\n--- Testing Clip Video ---")
	videoPath, err := downSvc.DownloadClip(context.Background(), "jNQXAC9IVRw", "Me at the zoo", 5, 10, "video", "best", "mp4", "job2", progressFn, nil)
	if err != nil {
		fmt.Println("Clip Video Error:", err)
	} else {
		fmt.Println("Clip Video Success:", videoPath)
	}
}
