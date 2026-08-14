package ytdlp

import (
	"fmt"
	"os"
	"strings"
)

type Cookie struct {
	Name           string  `json:"name"`
	Value          string  `json:"value"`
	Domain         string  `json:"domain"`
	Path           string  `json:"path"`
	Secure         bool    `json:"secure"`
	HttpOnly       bool    `json:"httpOnly"`
	ExpirationDate float64 `json:"expirationDate,omitempty"`
}

// WriteCookiesFile creates a temporary Netscape format cookie file.
// Returns the file path and a cleanup function to delete it.
func WriteCookiesFile(cookies []Cookie) (string, func(), error) {
	if len(cookies) == 0 {
		return "", func() {}, nil
	}

	f, err := os.CreateTemp("", "fukyt-cookies-*.txt")
	if err != nil {
		return "", nil, fmt.Errorf("create cookies temp file: %w", err)
	}

	path := f.Name()
	cleanup := func() {
		os.Remove(path)
	}

	var sb strings.Builder
	sb.WriteString("# Netscape HTTP Cookie File\n")
	sb.WriteString("# This is a generated file! Do not edit.\n\n")

	for _, c := range cookies {
		domainFlag := "FALSE"
		if strings.HasPrefix(c.Domain, ".") {
			domainFlag = "TRUE"
		}
		secureFlag := "FALSE"
		if c.Secure {
			secureFlag = "TRUE"
		}
		exp := int64(c.ExpirationDate)
		if exp == 0 {
			exp = 2147483647 // Far future fallback
		}

		// domain \t flag \t path \t secure \t expiration \t name \t value
		sb.WriteString(fmt.Sprintf("%s\t%s\t%s\t%s\t%d\t%s\t%s\n",
			c.Domain, domainFlag, c.Path, secureFlag, exp, c.Name, c.Value))
	}

	if _, err := f.WriteString(sb.String()); err != nil {
		f.Close()
		cleanup()
		return "", nil, fmt.Errorf("write cookies: %w", err)
	}
	f.Close()

	return path, cleanup, nil
}
