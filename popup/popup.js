// EzPrompter - Popup Script

const DEFAULTS = {
  apiProvider: 'gemini',
  apiKey: '',
  model: 'gemini-2.0-flash',
  language: 'en',
  downloadFolder: 'EzPrompter'
};

const MODEL_DEFAULTS = {
  gemini: 'gemini-2.0-flash',
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
  const toggleBtn = document.getElementById('toggleKey');
  const status = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(DEFAULTS, settings => {
    providerSelect.value = settings.apiProvider;
    apiKeyInput.value = settings.apiKey;
    modelInput.value = settings.model;
    languageSelect.value = settings.language;
    folderInput.value = settings.downloadFolder;
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
    const current = modelInput.value;
    const isDefault = Object.values(MODEL_DEFAULTS).includes(current) || !current;
    if (isDefault) {
      modelInput.value = MODEL_DEFAULTS[providerSelect.value];
    }
  });

  // Save settings
  form.addEventListener('submit', e => {
    e.preventDefault();

    const settings = {
      apiProvider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || MODEL_DEFAULTS[providerSelect.value],
      language: languageSelect.value,
      downloadFolder: folderInput.value.trim() || 'EzPrompter'
    };

    chrome.storage.sync.set(settings, () => {
      status.textContent = 'Settings saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});
