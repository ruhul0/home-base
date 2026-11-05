package main

import (
	"bytes"
	"encoding/base64"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	maxGroups         = 50
	maxLinksPerGroup  = 200
	maxNameLength     = 100
	maxURLLength      = 2048
	maxGreetingLength = 60
)

var hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var preferenceChoices = map[string][]string{
	// "auto" and the DaisyUI themes, followed by older theme names that saved designs may still use.
	"theme": {
		"auto", "light", "dark", "cupcake", "bumblebee", "emerald", "corporate", "synthwave", "retro", "cyberpunk",
		"valentine", "halloween", "garden", "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
		"luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade", "night", "coffee", "winter",
		"dim", "nord", "sunset", "caramellatte", "abyss", "silk",
		"aurora", "ocean", "rose", "violet", "amber", "midnight", "mono",
	},
	"mode":           {"auto", "light", "dark"},
	"backgroundType": {"theme", "solid", "image"},
	"pattern":        {"none", "dots", "grid", "lines"},
	"font":           {"system", "serif", "mono", "rounded"},
	"layout":         {"tiles", "list", "compact"},
	"tileSize":       {"small", "medium", "large"},
	"iconShape":      {"rounded", "circle", "square"},
	"columns":        {"auto", "1", "2", "3", "4"},
	"pageWidth":      {"narrow", "normal", "wide"},
	"cardStyle":      {"glass", "solid", "outline", "none"},
	"corners":        {"round", "soft", "sharp"},
	"heroAlign":      {"center", "left"},
	"clockFormat":    {"auto", "12", "24"},
	"clockSize":      {"small", "medium", "large"},
	"searchEngine":   {"default", "google", "duckduckgo", "bing", "brave"},
}

var preferenceSwitches = []string{
	"showClock", "showSeconds", "showGreeting", "showDate", "showSearch",
	"showLabels", "showGroupTitles", "showMostVisited", "showBookmarks",
	"showGitHub", "showNews", "showMonitors", "showTodos", "showNotes", "showClocks", "showServers",
}

var backgroundDims = []float64{0, 20, 40, 60}

// cleanPreferences keeps only known settings and exact colour formats, so nothing a user saves can run
// as code or add its own styling. The greeting is free text, but the page only displays it as plain text.
// It returns false if any known setting has an invalid value.
func cleanPreferences(input map[string]any) (map[string]any, bool) {
	if input == nil {
		return nil, false
	}
	cleaned := map[string]any{}

	for key, choices := range preferenceChoices {
		value, present := input[key]
		if !present {
			continue
		}
		text, isText := value.(string)
		if !isText || !slices.Contains(choices, text) {
			return nil, false
		}
		cleaned[key] = text
	}

	for _, key := range preferenceSwitches {
		value, present := input[key]
		if !present {
			continue
		}
		enabled, isBool := value.(bool)
		if !isBool {
			return nil, false
		}
		cleaned[key] = enabled
	}

	if value, present := input["backgroundDim"]; present {
		dim, isNumber := value.(float64)
		if !isNumber || !slices.Contains(backgroundDims, dim) {
			return nil, false
		}
		cleaned["backgroundDim"] = dim
	}

	if value, present := input["accentColor"]; present {
		colour, isText := value.(string)
		if !isText || (colour != "" && !hexColour.MatchString(colour)) {
			return nil, false
		}
		cleaned["accentColor"] = colour
	}

	if value, present := input["backgroundColor"]; present {
		colour, isText := value.(string)
		if !isText || !hexColour.MatchString(colour) {
			return nil, false
		}
		cleaned["backgroundColor"] = colour
	}

	if value, present := input["greetingText"]; present {
		greeting, isText := value.(string)
		if !isText || utf8.RuneCountInString(greeting) > maxGreetingLength {
			return nil, false
		}
		cleaned["greetingText"] = greeting
	}

	return cleaned, true
}

func cleanName(value string) (string, bool) {
	name := strings.TrimSpace(value)
	return name, name != "" && utf8.RuneCountInString(name) <= maxNameLength
}

// cleanURL only accepts http and https, because links render as clickable addresses.
func cleanURL(value string) (string, bool) {
	if len(value) > maxURLLength {
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", false
	}
	return parsed.String(), true
}

const (
	iconEmojiPrefix  = "emoji:"
	iconSymbolPrefix = "lucide:"
	iconImagePrefix  = "image:data:"
	maxIconEmoji     = 8
	maxIconImage     = 16 * 1024
)

var iconSymbol = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)

// cleanIcon accepts an empty value, a short emoji, the name of a built-in symbol, or a small photo.
// Images are checked by their real contents, and SVG is refused because it can contain scripts.
func cleanIcon(icon string) bool {
	switch {
	case icon == "":
		return true
	case strings.HasPrefix(icon, iconEmojiPrefix):
		count := utf8.RuneCountInString(strings.TrimPrefix(icon, iconEmojiPrefix))
		return count >= 1 && count <= maxIconEmoji
	case strings.HasPrefix(icon, iconSymbolPrefix):
		return iconSymbol.MatchString(strings.TrimPrefix(icon, iconSymbolPrefix))
	case strings.HasPrefix(icon, iconImagePrefix):
		return cleanIconImage(strings.TrimPrefix(icon, iconImagePrefix), len(icon))
	}
	return false
}

func cleanIconImage(dataURL string, totalLength int) bool {
	if totalLength > maxIconImage {
		return false
	}
	declaredType, encoded, found := strings.Cut(dataURL, ";base64,")
	if !found {
		return false
	}
	image, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return false
	}
	return detectImageType(image) == declaredType
}

func cleanOptionalColour(colour string) bool {
	return colour == "" || hexColour.MatchString(colour)
}

// keepCustomization fills in icons and colours from the stored sites, matching links by address
// and groups by name.
func keepCustomization(groups, existing []Group) {
	links := map[string]Link{}
	colours := map[string]string{}
	for _, group := range existing {
		colours[group.Name] = group.Color
		for _, link := range group.Links {
			links[link.URL] = link
		}
	}
	for groupIndex := range groups {
		group := &groups[groupIndex]
		if group.Color == "" {
			group.Color = colours[group.Name]
		}
		for linkIndex := range group.Links {
			link := &group.Links[linkIndex]
			if link.Icon == "" {
				link.Icon = links[link.URL].Icon
			}
			if link.IconColor == "" {
				link.IconColor = links[link.URL].IconColor
			}
		}
	}
}

func cleanGroups(input []Group) ([]Group, bool) {
	if input == nil || len(input) > maxGroups {
		return nil, false
	}
	groups := make([]Group, 0, len(input))
	for _, group := range input {
		name, ok := cleanName(group.Name)
		if !ok || group.Links == nil || len(group.Links) > maxLinksPerGroup || !cleanOptionalColour(group.Color) {
			return nil, false
		}
		links := make([]Link, 0, len(group.Links))
		for _, link := range group.Links {
			linkName, nameOK := cleanName(link.Name)
			address, addressOK := cleanURL(link.URL)
			if !nameOK || !addressOK || !cleanIcon(link.Icon) || !cleanOptionalColour(link.IconColor) {
				return nil, false
			}
			links = append(links, Link{Name: linkName, URL: address, Icon: link.Icon, IconColor: link.IconColor})
		}
		groups = append(groups, Group{Name: name, Color: group.Color, Links: links})
	}
	return groups, true
}

// detectImageType reads the file's own first bytes, never what the browser claims, so only real
// photos are stored. SVG is excluded because it can contain scripts.
func detectImageType(image []byte) string {
	if len(image) < 12 {
		return ""
	}
	switch {
	case bytes.HasPrefix(image, []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg"
	case bytes.HasPrefix(image, []byte{0x89, 0x50, 0x4e, 0x47}):
		return "image/png"
	case string(image[:4]) == "RIFF" && string(image[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}
