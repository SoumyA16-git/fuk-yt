package ytdlp

import (
	"regexp"
	"strconv"
	"strings"
)
var (
	percentRe     = regexp.MustCompile(`([\d.]+)%`)
	speedRe       = regexp.MustCompile(`at\s+([\d.]+\s*[\w/]+)`)
	etaRe         = regexp.MustCompile(`ETA\s+([\d:]+)`)
	totalRe       = regexp.MustCompile(`of\s+~?\s*([\d.]+\s*[\w]+)`)
	ffmpegTimeRe  = regexp.MustCompile(`time=\s*([\d:]+(?:\.\d+)?)`)
	ffmpegSpeedRe = regexp.MustCompile(`speed=\s*([\d.]+)x`)
	ffmpegSizeRe  = regexp.MustCompile(`size=\s*([\d.]+\s*[\w]+)`)
)

func parseProgressLine(line, jobID string) (ProgressEvent, bool) {
	// 1. Standard yt-dlp [download] progress
	if strings.Contains(line, "[download]") {
		pctMatch := percentRe.FindStringSubmatch(line)
		if pctMatch != nil {
			pct, err := strconv.ParseFloat(pctMatch[1], 64)
			if err == nil {
				evt := ProgressEvent{
					JobID:   jobID,
					Percent: pct,
				}

				if totalMatch := totalRe.FindStringSubmatch(line); totalMatch != nil {
					valStr, unitStr := splitValUnit(totalMatch[1])
					if totalVal, err := strconv.ParseFloat(valStr, 64); err == nil {
						totalBytes := int64(toBytes(totalVal, unitStr))
						evt.Total = &totalBytes
						downloaded := int64(float64(totalBytes) * pct / 100)
						evt.Downloaded = &downloaded
					}
				}

				if speedMatch := speedRe.FindStringSubmatch(line); speedMatch != nil {
					sVal, unitStr := splitValUnit(speedMatch[1])
					if speedVal, err := strconv.ParseFloat(sVal, 64); err == nil {
						speedBps := toBytes(speedVal, unitStr)
						evt.SpeedBps = &speedBps
					}
				}

				if etaMatch := etaRe.FindStringSubmatch(line); etaMatch != nil {
					etaSec := parseDurationSec(etaMatch[1])
					if etaSec > 0 {
						evt.ETASec = &etaSec
					}
				}

				return evt, true
			}
		}
	}

	// 2. FFmpeg section trimming / keyframe cutting progress line:
	// e.g. "frame= 182 fps= 29 q=28.0 size= 2816KiB time=00:00:07.41 bitrate=3111.8kbits/s speed= 1.2x"
	if strings.Contains(line, "time=") || strings.Contains(line, "frame=") {
		timeMatch := ffmpegTimeRe.FindStringSubmatch(line)
		if timeMatch != nil {
			timeSec := parseDurationSec(timeMatch[1])
			evt := ProgressEvent{
				JobID:   jobID,
				Percent: 50.0,
			}

			if sizeMatch := ffmpegSizeRe.FindStringSubmatch(line); sizeMatch != nil {
				valStr, unitStr := splitValUnit(sizeMatch[1])
				if sizeVal, err := strconv.ParseFloat(valStr, 64); err == nil {
					downloadedBytes := int64(toBytes(sizeVal, unitStr))
					evt.Downloaded = &downloadedBytes
				}
			}

			if speedMatch := ffmpegSpeedRe.FindStringSubmatch(line); speedMatch != nil {
				if speedVal, err := strconv.ParseFloat(speedMatch[1], 64); err == nil {
					speedBps := speedVal * 1000000
					evt.SpeedBps = &speedBps
				}
			}

			if timeSec > 0 {
				calcPct := timeSec * 5.0
				if calcPct > 99.0 {
					calcPct = 99.0
				}
				evt.Percent = calcPct
			}

			return evt, true
		}
	}

	return ProgressEvent{}, false
}

func parseDurationSec(raw string) float64 {
	parts := strings.Split(raw, ":")
	if len(parts) == 2 {
		mins, _ := strconv.ParseFloat(parts[0], 64)
		secs, _ := strconv.ParseFloat(parts[1], 64)
		return mins*60 + secs
	} else if len(parts) == 3 {
		hrs, _ := strconv.ParseFloat(parts[0], 64)
		mins, _ := strconv.ParseFloat(parts[1], 64)
		secs, _ := strconv.ParseFloat(parts[2], 64)
		return hrs*3600 + mins*60 + secs
	}
	v, _ := strconv.ParseFloat(raw, 64)
	return v
}

func splitValUnit(s string) (string, string) {
	s = strings.TrimSpace(s)
	for i, r := range s {
		if (r < '0' || r > '9') && r != '.' {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i:])
		}
	}
	return s, ""
}
