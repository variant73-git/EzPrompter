# EzPrompter Figma Plugin

Imports captured website layouts from the EzPrompter backend and recreates them as Figma frames.

## Setup

1. Open Figma Desktop
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select `figma-plugin/manifest.json` from this repo
4. The plugin appears under **Plugins > Development > EzPrompter**

## Usage

1. Make sure the EzPrompter backend is running (default: `http://localhost:3333`)
2. Capture a website layout using the browser extension
3. Open the plugin in Figma
4. Enter the capture ID (or leave empty to fetch the latest)
5. Click **Import Layout**

The plugin will create:
- A frame matching the captured viewport with the full DOM tree recreated as Figma nodes
- A reference frame next to it with the original screenshot (if available)

## Expected Capture Data Format

The backend should return JSON with this structure:

```json
{
  "id": "capture-123",
  "url": "https://example.com",
  "viewport": { "width": 1440, "height": 900 },
  "screenshot": "data:image/png;base64,...",
  "domTree": {
    "tag": "body",
    "className": "page",
    "boundingRect": { "x": 0, "y": 0, "width": 1440, "height": 900 },
    "styles": {
      "backgroundColor": "rgb(255, 255, 255)",
      "display": "flex",
      "flexDirection": "column"
    },
    "children": [
      {
        "tag": "div",
        "className": "header",
        "boundingRect": { "x": 0, "y": 0, "width": 1440, "height": 64 },
        "styles": { "backgroundColor": "#1a1a2e" },
        "children": []
      }
    ]
  }
}
```

## Features

- Maps CSS properties to Figma equivalents (fills, strokes, auto-layout, shadows, gradients, etc.)
- Handles text nodes with font loading (falls back to Inter)
- Skips hidden/zero-dimension elements
- Limits recursion to 15 levels
- Names nodes after HTML tag + class (e.g., `div.header.nav-container`)
