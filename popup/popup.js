// EzPrompter - Popup Script

const DEFAULTS = {
  apiProvider: 'gemini',
  apiKey: '',
  model: 'gemini-2.0-flash',
  ollamaUrl: 'http://localhost:11434',
  language: 'en',
  downloadFolder: 'EzPrompter'
};

const MODEL_DEFAULTS = {
  gemini: 'gemini-2.0-flash',
  ollama: 'moondream',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6'
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('settings-form');
  const providerSelect = document.getElementById('apiProvider');
  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model');
  const languageSelect = document.getElementById('language');
  const folderInput = document.getElementById('downloadFolder');
  const ollamaUrlInput = document.getElementById('ollamaUrl');
  const ollamaUrlField = document.getElementById('ollama-url-field');
  const toggleBtn = document.getElementById('toggleKey');
  const status = document.getElementById('status');

  function updateProviderUI(provider) {
    const isOllama = provider === 'ollama';
    ollamaUrlField.style.display = isOllama ? 'block' : 'none';
    apiKeyInput.parentElement.style.display = isOllama ? 'none' : 'block';
  }

  // Load saved settings
  chrome.storage.sync.get(DEFAULTS, settings => {
    providerSelect.value = settings.apiProvider;
    apiKeyInput.value = settings.apiKey;
    modelInput.value = settings.model;
    ollamaUrlInput.value = settings.ollamaUrl || 'http://localhost:11434';
    languageSelect.value = settings.language;
    folderInput.value = settings.downloadFolder;
    updateProviderUI(settings.apiProvider);
  });

  // Toggle API key visibility
  toggleBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  });

  // Update default model when provider changes
  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    const current = modelInput.value;
    const isDefault = Object.values(MODEL_DEFAULTS).includes(current) || !current;
    if (isDefault) modelInput.value = MODEL_DEFAULTS[provider];
    updateProviderUI(provider);
  });

  // Save settings
  form.addEventListener('submit', e => {
    e.preventDefault();

    const settings = {
      apiProvider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || MODEL_DEFAULTS[providerSelect.value],
      ollamaUrl: ollamaUrlInput.value.trim() || 'http://localhost:11434',
      language: languageSelect.value,
      downloadFolder: folderInput.value.trim() || 'EzPrompter'
    };

    chrome.storage.sync.set(settings, () => {
      status.textContent = 'Settings saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});
