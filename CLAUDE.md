# EzPrompter - Contexto do Projeto

## O que é
Extensão para Chrome e Opera que usa IA para fazer reverse-engineer do prompt de qualquer imagem.
Clique direito em uma imagem → "EzPrompter" → salva imagem + `.md` + `.json` em pasta separada.

## Branch ativa
`claude/ai-image-description-extension-Tp3jY`

## Versão atual
`1.0.3`

## Estrutura
```
manifest.json       # Manifest V3 (Chrome/Opera)
background.js       # Service worker: processa imagens, chama APIs, salva arquivos
content.js          # Injeta overlay na página (loading/success/error)
styles/content.css  # CSS do overlay
popup/popup.html    # Popup de configurações
popup/popup.css     # CSS do popup
popup/popup.js      # Lógica do popup
icons/              # Ícones 16/48/128px
```

## Provedores de IA suportados
- **Google Gemini** (padrão, tier gratuito) — `gemini-2.0-flash`
- **Ollama** (local/offline) — `moondream` ou `llava`
- **OpenAI** — `gpt-4o`
- **Anthropic** — `claude-sonnet-4-6`

## Como funciona o fluxo
1. Usuário clica direito em imagem → context menu
2. `background.js` busca a imagem e redimensiona (768px para Ollama, 1536px para outros)
3. Envia para a API de IA configurada
4. IA retorna `TITLE: [2-4 palavras]` na primeira linha + prompt completo
5. Salva em `Downloads/EzPrompter/{title} - {domain}/` (ex: `blue car - pinterest.com/`)
6. Arquivos salvos: `.png` + `.md` + `.json`

## Particularidade do Ollama (IMPORTANTE)
O Ollama bloqueia requisições de `chrome-extension://` por CORS.
**Solução implementada:** abre uma aba em background em `http://localhost:11434/`, injeta o fetch via `chrome.scripting.executeScript` — a requisição fica same-origin e o Ollama aceita.

## Regras de versionamento
Incrementar o patch (`1.0.x`) a cada commit com alterações.

## Como instalar para testar
1. `git clone` + `git checkout claude/ai-image-description-extension-Tp3jY`
2. `chrome://extensions/` → Developer mode → Load unpacked → selecionar a pasta
3. Configurar API key no popup da extensão
