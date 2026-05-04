/**
 * UncraftTransport — interface every editor-core consumer (extension shell or
 * web shell) must implement. Editor code never imports `chrome.*` or `fetch`
 * directly; it goes through the transport injected by the host shell.
 *
 * The interface is documented as JSDoc rather than TypeScript so it ships as
 * vanilla JS into Chrome's classic-script loader without a build step.
 *
 * Phase 1 of the canvas refactor (2026-05-03) ships this scaffold. Editor
 * code still calls `chrome.runtime.sendMessage` directly today; migration
 * to `transport.callLLM(...)` happens incrementally as features land in
 * web-shell that need transport-mediated execution.
 */

/* eslint-disable no-unused-vars */

/**
 * @typedef {Object} LLMRequest
 * @property {string} model        e.g. 'gemini-3.1-pro-preview', 'claude-opus-4-7'
 * @property {string} system       System prompt
 * @property {Array<{role:'user'|'assistant',content:string|Array}>} messages
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 */

/**
 * @typedef {Object} LLMResponse
 * @property {string} text
 * @property {{input:number, output:number}} [tokens]
 * @property {string} [stopReason]
 */

/**
 * @typedef {Object} ViewportSpec
 * @property {number} width
 * @property {number} height
 * @property {number} [dpr]
 */

/**
 * @typedef {Object} CaptureResult
 * @property {string} dataUrl     PNG data URL
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} ScrapeResult
 * @property {string} html
 * @property {Object} [assets]    optional asset manifest
 */

/**
 * @typedef {Object} UncraftTransport
 * @property {(req:LLMRequest)=>Promise<LLMResponse>} callLLM
 * @property {(viewport:ViewportSpec)=>Promise<CaptureResult>} capture
 * @property {(name:string, value:string)=>Promise<void>} storeKey
 * @property {(name:string)=>Promise<string|null>} readKey
 * @property {(target:'self'|'iframe', css:string)=>Promise<void>} injectCSS
 * @property {(url:string)=>Promise<ScrapeResult>} [scrapeURL]   // optional: web-shell only
 */

/**
 * @returns {UncraftTransport}
 */
function createNullTransport() {
  const notImpl = (name) => () => Promise.reject(new Error(`UncraftTransport.${name}: not implemented`));
  return {
    callLLM: notImpl('callLLM'),
    capture: notImpl('capture'),
    storeKey: notImpl('storeKey'),
    readKey: notImpl('readKey'),
    injectCSS: notImpl('injectCSS')
  };
}

// Browser global so editor-core JS files (classic scripts) can reach it.
if (typeof window !== 'undefined') {
  window.UncraftTransport = window.UncraftTransport || { createNullTransport };
}

// CommonJS export for web-shell bundler.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createNullTransport };
}
