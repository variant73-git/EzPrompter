# EzPrompter - AI Image Prompt Describer

Browser extension for Chrome and Opera that uses AI to reverse-engineer the prompt of any image, saving the image along with a `.md` prompt file and `.json` metadata file.

## Features

- **Right-click any image** to analyze it with AI
- **Reverse-engineer prompts** - describes what prompt could recreate the image
- **Saves 3 files** per image:
  - The image itself (original format)
  - `.md` file with the generated prompt and metadata
  - `.json` file with full metadata
- **Multiple AI providers**: OpenAI (GPT-4o) and Anthropic (Claude)
- **Multi-language**: English, Portuguese (BR), Spanish
- **Dark theme UI** with overlay results

## Installation

1. Clone this repository or download the ZIP
2. Open your browser:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Opera**: Navigate to `opera://extensions/`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the `EzPrompter` folder
5. Click the extension icon to configure your API key

## Configuration

Click the EzPrompter icon in your toolbar:

| Setting | Description |
|---------|-------------|
| **AI Provider** | OpenAI or Anthropic |
| **API Key** | Your API key for the selected provider |
| **Model** | AI model to use (auto-fills based on provider) |
| **Language** | Language for prompt descriptions |
| **Download Folder** | Subfolder inside your Downloads directory |

## Usage

1. Right-click on any image on a webpage
2. Select **"EzPrompter: Descrever prompt desta imagem"**
3. Wait for the AI to analyze the image
4. The prompt appears in an overlay - click **Copy Prompt** to copy
5. Three files are automatically saved to your Downloads/EzPrompter folder

## Output Files

For each analyzed image, three files are created:

```
EzPrompter/
  2026-03-25T14-30-00_imagename.png    # Original image
  2026-03-25T14-30-00_imagename.md     # Prompt + metadata in Markdown
  2026-03-25T14-30-00_imagename.json   # Full metadata in JSON
```

## Requirements

- Chrome 88+ or Opera 74+ (Manifest V3 support)
- API key from OpenAI or Anthropic

## License

MIT
