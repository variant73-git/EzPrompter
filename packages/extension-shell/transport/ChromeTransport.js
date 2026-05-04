/**
 * ChromeTransport — UncraftTransport implementation for the Chrome extension shell.
 * Wraps chrome.runtime.sendMessage / chrome.storage.sync / chrome.scripting.insertCSS
 * so editor-core code can be transport-agnostic.
 *
 * NOTE: Phase 1 ships this as scaffolding. editor-core code still calls
 * chrome.runtime.* directly inside the extension. This wrapper is the
 * forward-compatible target for incremental migration as features land in
 * web-shell.
 */
(function () {
  function send(action, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (resp && resp.ok === false) return reject(new Error(resp.error || `${action} failed`));
          resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function createChromeTransport() {
    return {
      async callLLM(req) {
        // Background.js routes by model-name regex (gemini/anthropic/openai).
        const resp = await send('modeERebuild', { request: req });
        return { text: resp?.text || resp?.html || '', tokens: resp?.tokens, stopReason: resp?.stopReason };
      },

      async capture(viewport) {
        const resp = await send('captureVisibleTab', { viewport });
        return { dataUrl: resp?.dataUrl, width: resp?.width, height: resp?.height };
      },

      storeKey(name, value) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set({ [name]: value }, () => {
            const err = chrome.runtime.lastError;
            err ? reject(new Error(err.message)) : resolve();
          });
        });
      },

      readKey(name) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.get([name], (data) => {
            const err = chrome.runtime.lastError;
            err ? reject(new Error(err.message)) : resolve(data?.[name] ?? null);
          });
        });
      },

      async injectCSS(target, css) {
        // Editor.js currently injects via <link> tag; this wrapper exists for
        // shell-mediated injection when needed.
        if (target === 'self' && typeof document !== 'undefined') {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.appendChild(style);
          return;
        }
        // For 'iframe', host caller must provide the iframe ref via DOM.
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.ChromeTransport = { create: createChromeTransport };
  }
})();
