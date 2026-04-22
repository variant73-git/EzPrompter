# Mode E Refinement Loop — M1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass diff-vs-original refinement loop to Mode E so generated clones are compared to the original screenshot and regenerated once with LLM-identified fixes.

**Architecture:**
1. Mode E runs normally (capture → DESIGN.md → Gemini generate → inject HTML).
2. After injection, capture the current tab (= output screenshot).
3. Send [original screenshot, output screenshot] to Gemini Flash with a vision-diff prompt → receive JSON issues list.
4. If high/medium issues found, call Gemini Pro Vision once with the original screenshot + current HTML + issues list → receive refined HTML.
5. Replace page content with refined HTML. Hard cap: 1 pass (MVP).

**Tech Stack:** Chrome Extension MV3, `chrome.runtime.sendMessage`, `chrome.tabs.captureVisibleTab`, Gemini `gemini-2.5-flash` (diff) + `gemini-3.1-pro-preview` (regen, reuses existing `modeERebuild` handler).

**Out of scope for M1:** pixel-based diff cross-check, multi-pass loops, revert-on-worse, UI for per-region regeneration. Covered in follow-up plans.

---

## Context for implementer (read first)

**File conventions:**
- Editor scripts live in `editor/`, are IIFE modules exposed on `window.__rbX`.
- Pattern: `(function() { if (window.__rbX) return; ... window.__rbX = {...}; })();`
- Background handlers in `background.js` match on `message.action === 'xxx'`, use `return true` for async channels.
- Progress logs use `log({step, message, current, total})`.
- Editor UI in `editor/editor.js` — but we do NOT touch UI in M1 (option-based trigger only).

**Relevant existing files:**
- `editor/mode-e.js:1058-1129` — `runModeE(onProgress)`. Captures `screenshots[]`, generates `sectionsHTML[]`, calls `replacePageContent(sectionsHTML)`, returns wrapper.
- `editor/mode-e.js:1135` — exports `window.__rbModeE = {run, runChunked, runViewport, runFromImage, ...}`.
- `background.js:282-335` — `modeERebuild` handler (vision call, single image + prompt, returns HTML text). Reuse this for regen.
- `background.js:254-279` — `captureScreenshot` handler with `returnData: true`. Use this to capture output.
- `editor/mode-e2.js:30-52` — example of `callLLM` that sendMessage to background.
- `editor/mode-e2.js:63-74` — `stripFence` helper for JSON parsing.
- `manifest.json:49` — `web_accessible_resources` list.

**Commit style:** `feat: <short>` or `feat(mode-e): <short>`. One commit per task (unless step explicitly splits).

---

### Task 1: Background handler for multi-image Flash diff calls

**Files:**
- Modify: `background.js` (add new handler near existing `modeE2Call` handler around line 339)

**Why:** The existing `modeERebuild` handler only accepts one image. Vision diff needs two images in one prompt. Reuse that exact request shape but add a second `inline_data` part.

- [ ] **Step 1: Add the new action handler right after `modeE2Call`**

Locate `background.js` and find the end of the `modeE2Call` handler block (search for `if (message.action === 'modeE2Call')`, find its closing `})();return true;}`). Insert directly after:

```javascript
  // Mode E refinement: multi-image vision diff call.
  // Accepts 1+ image dataUrls, defaults to Flash for cost.
  // Used by the diff step and any future multi-image refinement.
  if (message.action === 'modeERefineCall') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(['apiKey', 'modelE2']);
        const apiKey = settings.apiKey;
        if (!apiKey) { sendResponse({error: 'No API key configured.'}); return; }

        const imageDataUrls = message.imageDataUrls || [];
        if (!Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
          sendResponse({error: 'modeERefineCall requires imageDataUrls array'}); return;
        }

        const parts = [{ text: message.prompt || '' }];
        for (const url of imageDataUrls) {
          const m = (url || '').match(/^data:(.+?);base64,(.+)$/);
          if (!m) { sendResponse({error: 'Invalid image data in imageDataUrls'}); return; }
          parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
        }

        const model = message.model || settings.modelE2 || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { maxOutputTokens: message.maxOutputTokens || 8000 }
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          sendResponse({error: `Gemini API error: ${err.error?.message || response.status}`});
          return;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        sendResponse({text});
      } catch (e) {
        sendResponse({error: e.message});
      }
    })();
    return true;
  }
```

- [ ] **Step 2: Load the extension and verify no syntax errors**

```bash
node -c /Users/adilsonporto/EzPrompter/background.js 2>&1 | head -20
```
Expected: no output (node `-c` returns silent on success).

- [ ] **Step 3: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add background.js
git commit -m "feat(mode-e): add modeERefineCall background handler for multi-image Flash diffs"
```

---

### Task 2: Create `editor/mode-e-diff.js` — vision diff helper

**Files:**
- Create: `editor/mode-e-diff.js`

**Why:** Encapsulates the diff-prompt builder + LLM call + JSON parsing so `mode-e-refine.js` can call a single `runVisionDiff(originalDataUrl, outputDataUrl)` and get back a structured issues array.

- [ ] **Step 1: Create the file with the full IIFE module**

Create `/Users/adilsonporto/EzPrompter/editor/mode-e-diff.js` with exactly this content:

```javascript
/**
 * Repix Mode E — Vision diff helper.
 *
 * Given an original screenshot and an output screenshot (of the generated
 * clone), asks Gemini Flash to identify divergent regions with severity.
 *
 * Returns: Array<{ region: string, severity: 'high'|'medium'|'low',
 *                  bbox: {x,y,w,h} (normalized 0-1), issue: string }>
 *
 * No-op if the browser can't reach background.js.
 */
(function() {
  if (window.__rbModeEDiff) return;

  var CALL_TIMEOUT_MS = 60000;

  function callDiff(imageDataUrls, prompt, model) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        reject(new Error('Diff call timed out after ' + Math.round(CALL_TIMEOUT_MS / 1000) + 's'));
      }, CALL_TIMEOUT_MS);
      chrome.runtime.sendMessage({
        action: 'modeERefineCall',
        imageDataUrls: imageDataUrls,
        prompt: prompt,
        model: model || null,
        maxOutputTokens: 4000
      }, function(response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.text) resolve(response.text);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from diff LLM'));
      });
    });
  }

  function stripFence(raw) {
    if (!raw) return '';
    var s = raw.trim();
    s = s.replace(/^```(?:json|javascript)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (s[0] !== '[' && s[0] !== '{') {
      var a = s.indexOf('[');
      var b = s.lastIndexOf(']');
      if (a >= 0 && b > a) s = s.substring(a, b + 1);
    }
    return s.trim();
  }

  function buildDiffPrompt() {
    return [
      'You are comparing two screenshots of a website.',
      'IMAGE 1 is the ORIGINAL site. IMAGE 2 is an AI-generated clone.',
      '',
      'Identify regions where the clone differs from the original in a way a user would notice.',
      'Focus on: missing elements, wrong colors, incorrect layout/spacing, typography mismatches, missing or wrong imagery, incorrect text.',
      'Ignore: minor antialiasing, subpixel diffs, font-rendering nuances.',
      '',
      'Return STRICT JSON only — a single array. No prose, no markdown fences.',
      'Schema per item:',
      '{',
      '  "region": "hero | navigation | features | pricing | testimonials | footer | <other short label>",',
      '  "severity": "high | medium | low",',
      '  "bbox": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 },   // normalized 0-1 of IMAGE 2',
      '  "issue": "one-sentence description of what is wrong"',
      '}',
      '',
      'Rules:',
      '- Max 8 items. If perfect match, return [].',
      '- severity "high" = clearly broken or missing; "medium" = visibly off; "low" = minor.',
      '- bbox is a rough rectangle around the problem area in the clone (IMAGE 2), not the original.',
      '- If a whole section is wrong, one bbox for that section — do not duplicate items.'
    ].join('\n');
  }

  /**
   * Compare an original screenshot to an output screenshot.
   * @param {string} originalDataUrl - "data:image/...;base64,..."
   * @param {string} outputDataUrl   - "data:image/...;base64,..."
   * @param {object} opts - { model? }
   * @returns {Promise<Array>}
   */
  async function runVisionDiff(originalDataUrl, outputDataUrl, opts) {
    opts = opts || {};
    if (!originalDataUrl || !outputDataUrl) {
      throw new Error('runVisionDiff requires both screenshots');
    }
    var prompt = buildDiffPrompt();
    var raw = await callDiff([originalDataUrl, outputDataUrl], prompt, opts.model);
    var json = stripFence(raw);
    var parsed;
    try { parsed = JSON.parse(json); }
    catch (e) {
      throw new Error('Diff JSON parse failed: ' + e.message + ' — raw start: ' + json.substring(0, 200));
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Diff expected an array, got: ' + typeof parsed);
    }
    // Best-effort: clamp severities + coerce bbox shape.
    return parsed
      .map(function(item) {
        return {
          region: String(item.region || 'unknown'),
          severity: ['high','medium','low'].indexOf(item.severity) >= 0 ? item.severity : 'low',
          bbox: (item.bbox && typeof item.bbox === 'object') ? item.bbox : {x:0,y:0,w:0,h:0},
          issue: String(item.issue || '')
        };
      })
      .slice(0, 8);
  }

  window.__rbModeEDiff = {
    runVisionDiff: runVisionDiff
  };
})();
```

- [ ] **Step 2: Syntax check**

```bash
node -c /Users/adilsonporto/EzPrompter/editor/mode-e-diff.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add editor/mode-e-diff.js
git commit -m "feat(mode-e): add mode-e-diff.js — vision diff helper for refinement"
```

---

### Task 3: Create `editor/mode-e-refine.js` — orchestrator

**Files:**
- Create: `editor/mode-e-refine.js`

**Why:** Glue between capture/diff/regen. Keeps the orchestration logic out of `mode-e.js` so the main generator stays at its current size.

- [ ] **Step 1: Create the file with the full IIFE module**

Create `/Users/adilsonporto/EzPrompter/editor/mode-e-refine.js` with exactly this content:

```javascript
/**
 * Repix Mode E — Refinement orchestrator.
 *
 * Called after Mode E's main generation + inject succeeds. Captures the
 * current tab (the injected clone), diffs against the original screenshot
 * Mode E already captured, and if significant issues are found, asks the
 * main Mode E generator for a corrected HTML.
 *
 * MVP: single pass. Returns { html: string|null, issues: Array, changed: bool }.
 *
 * html === null means "no refinement — keep current". changed === true
 * means caller should re-inject the returned html.
 */
(function() {
  if (window.__rbModeERefine) return;

  var REGEN_TIMEOUT_MS = 120000;
  var PAINT_WAIT_MS = 600; // give the browser time to paint the injected HTML

  /** Capture the current visible tab via background. Returns data URL. */
  function captureOutput() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        action: 'captureScreenshot',
        returnData: true
      }, function(response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.dataUrl) resolve(response.dataUrl);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Capture returned no data'));
      });
    });
  }

  /**
   * Wait for paint + an optional delay, then capture.
   * Uses 2x rAF + setTimeout to ride out React/Framer re-renders.
   */
  function waitAndCapture(extraMs) {
    return new Promise(function(resolve) {
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          setTimeout(function() {
            captureOutput().then(resolve).catch(function(e) {
              console.warn('[refine] capture failed:', e);
              resolve(null);
            });
          }, typeof extraMs === 'number' ? extraMs : PAINT_WAIT_MS);
        });
      });
    });
  }

  function buildRegenPrompt(currentHtml, issues, designMD) {
    var issuesList = issues
      .filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; })
      .map(function(i) { return '- [' + i.severity + '] ' + i.region + ': ' + i.issue; })
      .join('\n');

    var tokens = designMD && designMD.length > 6000 ? designMD.substring(0, 6000) : (designMD || '');

    return [
      'You previously generated this HTML as a clone of a website. The attached image is the ORIGINAL site.',
      '',
      'A visual diff found these issues when comparing your generated clone with the original:',
      issuesList,
      '',
      'Fix ALL issues listed above. Match the original screenshot exactly for layout, colors, typography, and content.',
      '',
      'OUTPUT RULES:',
      '- Return ONLY the full corrected HTML. No prose, no markdown fences, no <html>/<head>/<body> wrappers.',
      '- Preserve any parts of the current HTML that were NOT flagged as issues.',
      '- Keep the same inline-style approach as the current HTML (no Tailwind CDN, no external CSS).',
      '- If unsure about a text/image, copy it VERBATIM from the current HTML below.',
      '',
      '==== DESIGN TOKENS (from original) ====',
      tokens,
      '',
      '==== CURRENT HTML (to refine) ====',
      currentHtml
    ].join('\n');
  }

  /** Call the existing modeERebuild endpoint (Gemini Pro Vision, one image + prompt → HTML). */
  function callRegen(originalScreenshot, prompt) {
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        reject(new Error('Regen call timed out after ' + Math.round(REGEN_TIMEOUT_MS / 1000) + 's'));
      }, REGEN_TIMEOUT_MS);
      chrome.runtime.sendMessage({
        action: 'modeERebuild',
        imageDataUrl: originalScreenshot,
        prompt: prompt
      }, function(response) {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.html) resolve(response.html);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from regen'));
      });
    });
  }

  function stripHtmlFence(raw) {
    if (!raw) return '';
    var s = raw.trim();
    s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    return s;
  }

  /**
   * Run one refinement pass.
   * @param {object} opts
   * @param {string} opts.originalScreenshot - dataUrl captured before inject
   * @param {string} opts.currentHtml        - the HTML currently on the page
   * @param {string} [opts.designMD]         - tokens for the regen prompt
   * @param {function} [opts.onProgress]     - log({step,message,current,total})
   * @returns {Promise<{html: string|null, issues: Array, changed: boolean}>}
   */
  async function runRefine(opts) {
    opts = opts || {};
    var log = opts.onProgress || function() {};
    if (!opts.originalScreenshot) throw new Error('runRefine requires originalScreenshot');
    if (!opts.currentHtml) throw new Error('runRefine requires currentHtml');
    if (!window.__rbModeEDiff || !window.__rbModeEDiff.runVisionDiff) {
      throw new Error('__rbModeEDiff not loaded');
    }

    log({step: 'refine-capture', message: 'Capturing output…', current: 1, total: 4});
    var outputScreenshot = await waitAndCapture();
    if (!outputScreenshot) {
      log({step: 'refine-skip', message: 'Output capture failed — skipping refinement', current: 4, total: 4});
      return {html: null, issues: [], changed: false};
    }

    log({step: 'refine-diff', message: 'Diffing vs original…', current: 2, total: 4});
    var issues = [];
    try {
      issues = await window.__rbModeEDiff.runVisionDiff(opts.originalScreenshot, outputScreenshot);
    } catch (e) {
      log({step: 'refine-skip', message: 'Diff failed (' + e.message + ') — skipping', current: 4, total: 4});
      return {html: null, issues: [], changed: false};
    }

    var toFix = issues.filter(function(i) { return i.severity === 'high' || i.severity === 'medium'; });
    if (toFix.length === 0) {
      log({step: 'refine-clean', message: 'Clean — no significant issues', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    log({step: 'refine-regen', message: 'Regenerating with ' + toFix.length + ' fixes…', current: 3, total: 4});
    var prompt = buildRegenPrompt(opts.currentHtml, toFix, opts.designMD);
    var newHtmlRaw;
    try {
      newHtmlRaw = await callRegen(opts.originalScreenshot, prompt);
    } catch (e) {
      log({step: 'refine-skip', message: 'Regen failed (' + e.message + ') — keeping current', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    var newHtml = stripHtmlFence(newHtmlRaw);
    if (!newHtml || newHtml.length < 100) {
      log({step: 'refine-skip', message: 'Regen returned empty/too short — keeping current', current: 4, total: 4});
      return {html: null, issues: issues, changed: false};
    }

    log({step: 'refine-done', message: 'Refined — ' + toFix.length + ' issues fixed', current: 4, total: 4});
    return {html: newHtml, issues: issues, changed: true};
  }

  window.__rbModeERefine = {
    runRefine: runRefine,
    // Exposed for tests / manual diagnostics:
    _buildRegenPrompt: buildRegenPrompt,
    _stripHtmlFence: stripHtmlFence
  };
})();
```

- [ ] **Step 2: Syntax check**

```bash
node -c /Users/adilsonporto/EzPrompter/editor/mode-e-refine.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add editor/mode-e-refine.js
git commit -m "feat(mode-e): add mode-e-refine.js — single-pass refinement orchestrator"
```

---

### Task 4: Expose `runWithRefine` on `mode-e.js`

**Files:**
- Modify: `editor/mode-e.js` (append a new function + add to the exports)

**Why:** We need a public entry point that runs the main generator AND then the refinement pass. Keeping it as a separate function (not a flag on `run`) preserves backward compat with `editor.js` which calls `window.__rbModeE.run(onProgress)`.

- [ ] **Step 1: Locate the exports object**

Open `editor/mode-e.js` and find line 1135:

```javascript
  window.__rbModeE = {
    run: runModeE,
    runChunked: runModeEChunked,
    runViewport: runModeE,
    runFromImage: runModeEFromImage,
```

Look at the surrounding closing — you'll need to insert code BEFORE this exports block and add an entry inside the object.

- [ ] **Step 2: Insert the new function right before `window.__rbModeE = {`**

Insert this function right before the `window.__rbModeE = {` line (so it's in the same closure scope and can see `runModeE`, `captureFullPage`, `replacePageContent`, `cleanHTML`):

```javascript
  // Orchestrated entry: runModeE + one refinement pass.
  // Keeps the original screenshot + generated HTML, pipes them into
  // __rbModeERefine.runRefine. If refinement returns new HTML, swap page
  // content via replacePageContent([newHtml]).
  async function runModeEWithRefine(onProgress) {
    var log = onProgress || function() {};

    if (!window.__rbModeERefine || !window.__rbModeEDiff) {
      log({step: 'refine-unavailable', message: 'Refinement modules missing — falling back to plain Mode E', current: 0, total: 1});
      return runModeE(onProgress);
    }

    // Capture the original screenshot BEFORE runModeE injects the clone.
    // (runModeE takes its own screenshots internally but does not expose them;
    // grabbing one here is cheap and keeps the contract simple.)
    log({step: 'refine-pre', message: 'Capturing original…', current: 0, total: 8});
    var originalScreenshot = null;
    try {
      originalScreenshot = await new Promise(function(resolve, reject) {
        chrome.runtime.sendMessage({action: 'captureScreenshot', returnData: true}, function(r) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r && r.dataUrl) resolve(r.dataUrl);
          else reject(new Error('captureScreenshot returned no data'));
        });
      });
    } catch (e) {
      log({step: 'refine-skip', message: 'Could not capture original (' + e.message + ') — running plain Mode E', current: 0, total: 1});
      return runModeE(onProgress);
    }

    // Run main Mode E.
    var rebuilt = await runModeE(log);
    if (!rebuilt) return null;

    // Extract the current injected HTML (wrapper.innerHTML).
    var currentHtml = '';
    try { currentHtml = rebuilt.innerHTML || ''; } catch (e) {}
    if (!currentHtml) {
      log({step: 'refine-skip', message: 'No current HTML to refine', current: 8, total: 8});
      return rebuilt;
    }

    // Grab DESIGN.MD fresh from the extractor (the live site has been swapped,
    // but extractor reads computed styles — pre-cache before inject would be
    // better; MVP reads what's available).
    var designMD = '';
    try { if (window.__rbExtractor && window.__rbExtractor.generateDesignMD) designMD = window.__rbExtractor.generateDesignMD() || ''; } catch (e) {}

    // Run refinement.
    var result;
    try {
      result = await window.__rbModeERefine.runRefine({
        originalScreenshot: originalScreenshot,
        currentHtml: currentHtml,
        designMD: designMD,
        onProgress: log
      });
    } catch (e) {
      log({step: 'refine-skip', message: 'Refinement threw (' + e.message + ') — keeping Mode E output', current: 8, total: 8});
      return rebuilt;
    }

    if (!result || !result.changed || !result.html) return rebuilt;

    // Swap the page with refined HTML. replacePageContent expects an array.
    log({step: 'refine-inject', message: 'Injecting refined HTML…', current: 8, total: 8});
    return replacePageContent([result.html]);
  }
```

- [ ] **Step 3: Add `runWithRefine` to the exports object**

Still in `mode-e.js`, modify the exports block (was at line 1135) so it reads:

```javascript
  window.__rbModeE = {
    run: runModeE,
    runWithRefine: runModeEWithRefine,
    runChunked: runModeEChunked,
    runViewport: runModeE,
    runFromImage: runModeEFromImage,
```

(i.e., one new line `runWithRefine: runModeEWithRefine,` inserted right after `run: runModeE,`). Do NOT change any other exports.

- [ ] **Step 4: Syntax check**

```bash
node -c /Users/adilsonporto/EzPrompter/editor/mode-e.js
```
Expected: no output.

- [ ] **Step 5: Sanity-grep to confirm both pieces landed**

```bash
grep -n "runModeEWithRefine" /Users/adilsonporto/EzPrompter/editor/mode-e.js
```
Expected: at least 2 lines (function declaration + export entry).

- [ ] **Step 6: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add editor/mode-e.js
git commit -m "feat(mode-e): expose runWithRefine — plain Mode E + one refinement pass"
```

---

### Task 5: Register new files in `manifest.json` + `background.js` injection

**Files:**
- Modify: `manifest.json` (add two entries to `web_accessible_resources`)
- Modify: `background.js` (add two entries to the `executeScript` injection chain)

**Why:** Content scripts can only load files listed in `web_accessible_resources`. The injection order in `background.js` determines when the modules are available on `window`.

- [ ] **Step 1: Update `manifest.json`**

Edit line 49 of `/Users/adilsonporto/EzPrompter/manifest.json`. The current line is:
```json
"resources": ["editor/editor.css", "editor/editor.js", "editor/rebuild.js", "editor/detect.js", "editor/freeze.js", "editor/mode-e.js", "editor/mode-b.js", "editor/mode-e2.js", "editor/s2h.js", "editor/persist.js", "editor/fill-popup.js", "overlay/extractor.js", "editor/test-minimal.js"],
```

Change to:
```json
"resources": ["editor/editor.css", "editor/editor.js", "editor/rebuild.js", "editor/detect.js", "editor/freeze.js", "editor/mode-e.js", "editor/mode-e-diff.js", "editor/mode-e-refine.js", "editor/mode-b.js", "editor/mode-e2.js", "editor/s2h.js", "editor/persist.js", "editor/fill-popup.js", "overlay/extractor.js", "editor/test-minimal.js"],
```

(Two new entries inserted between `mode-e.js` and `mode-b.js`: `editor/mode-e-diff.js` and `editor/mode-e-refine.js`.)

- [ ] **Step 2: Find the injection chain in `background.js`**

```bash
grep -n "executeScript\|files:\|editor/mode-e\.js\|editor/mode-b\.js" /Users/adilsonporto/EzPrompter/background.js | head -40
```

Look for the block that lists the script files injected into the tab (per CLAUDE.md ordering: `detect → freeze → extractor → persist → mode-e → s2h → rebuild → fill-popup → editor`). Depending on the current code, it's either one `executeScript({files: [...]})` call or multiple. Note the exact lines.

- [ ] **Step 3: Insert the new files right after `editor/mode-e.js` in the injection list**

Add `"editor/mode-e-diff.js"` and `"editor/mode-e-refine.js"` to the `files:` array, positioned immediately after `editor/mode-e.js`. The new ordering fragment should read:

```
editor/mode-e.js,
editor/mode-e-diff.js,
editor/mode-e-refine.js,
```

Do NOT touch other injection-order relationships.

- [ ] **Step 4: Verify manifest JSON validity and grep for injection**

```bash
python3 -c "import json; json.load(open('/Users/adilsonporto/EzPrompter/manifest.json'))" && echo "manifest OK"
grep -n "mode-e-diff\|mode-e-refine" /Users/adilsonporto/EzPrompter/background.js
```
Expected: `manifest OK` and two grep hits.

- [ ] **Step 5: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add manifest.json background.js
git commit -m "feat(mode-e): register mode-e-diff.js + mode-e-refine.js in manifest + injection chain"
```

---

### Task 6: Wire a hidden debug trigger to `runWithRefine`

**Files:**
- Modify: `editor/editor.js` (expose a dev-only shortcut — no UI toggle in M1)

**Why:** We need to trigger `runWithRefine` from the editor without shipping UI for it yet. Exposing it on `window.__rbRefineLastModeE` lets us test via console and lets a future PR add a checkbox.

- [ ] **Step 1: Find a safe place to expose the handle**

Locate the place in `editor/editor.js` where `window.__rbModeE.run` is called (around line 1329 per the grep earlier). You do NOT need to replace the existing call — we are only adding a parallel dev path.

Add the following somewhere in the same closure as the existing Mode E trigger (search for `__rbModeE.run` and add near it):

```javascript
    // Dev hook: ``window.__rbRunModeERefined()`` triggers the generation +
    // one refinement pass. Surfaced on window so it's callable from DevTools
    // without shipping UI in M1.
    window.__rbRunModeERefined = function() {
      if (!window.__rbModeE || !window.__rbModeE.runWithRefine) {
        console.error('[Repix] __rbModeE.runWithRefine unavailable');
        return;
      }
      return window.__rbModeE.runWithRefine(function(p) {
        console.log('[Repix refine]', p.step, p.message, p.current + '/' + p.total);
      });
    };
```

- [ ] **Step 2: Syntax check**

```bash
node -c /Users/adilsonporto/EzPrompter/editor/editor.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/adilsonporto/EzPrompter
git add editor/editor.js
git commit -m "feat(mode-e): expose __rbRunModeERefined dev hook for testing refinement loop"
```

---

### Task 7: End-to-end manual test

**Files:**
- None modified. This is a test-plan + evidence capture task.

**Why:** The Chrome-ext integration path isn't unit-testable without a browser. We confirm the full loop manually.

- [ ] **Step 1: Reload the extension**

In Chrome: `chrome://extensions` → find Repix → click the reload icon. Open DevTools console of an ordinary site (e.g. `https://linear.app`).

- [ ] **Step 2: Run vanilla Mode E first to baseline**

In DevTools console:

```javascript
window.__rbModeE && window.__rbModeE.run(p => console.log(p.step, p.message));
```

Expected: toast progresses through `detect → freeze → tokens → capture → rebuild → replace → done`. Page is replaced with a clone.

Note the wall time (rough).

- [ ] **Step 3: Reload, run the refined path**

Hard-reload the page (⌘⇧R / Ctrl+Shift+R) to restore the original, then in DevTools:

```javascript
window.__rbRunModeERefined();
```

Expected log sequence:
```
[Repix refine] refine-pre Capturing original… 0/8
[Repix refine] detect Detected: <builder> 0/5
[Repix refine] ... (normal Mode E steps)
[Repix refine] done Rebuild complete! <N> sections. 6/6
[Repix refine] refine-capture Capturing output… 1/4
[Repix refine] refine-diff Diffing vs original… 2/4
[Repix refine] refine-clean Clean — no significant issues 4/4
   — or —
[Repix refine] refine-regen Regenerating with <N> fixes… 3/4
[Repix refine] refine-inject Injecting refined HTML… 8/8
```

- [ ] **Step 4: Verify the refined HTML is actually in the DOM**

In DevTools console:

```javascript
document.getElementById('rb-e2-clone') || document.querySelectorAll('[id^="rb-"]')
```

Expected: a wrapper element containing the refined clone.

- [ ] **Step 5: Capture evidence**

Screenshot the DevTools console log + the final rendered page. Save both to `research/2026-04-22-mode-e-refinement-evidence.md` with a one-paragraph description of what you observed (does the refined output look closer to the original than the first pass?).

- [ ] **Step 6: Commit the evidence**

```bash
cd /Users/adilsonporto/EzPrompter
git add research/2026-04-22-mode-e-refinement-evidence.md
git commit -m "docs(mode-e): capture M1 refinement manual test evidence"
```

---

## Self-Review (done during plan writing)

**1. Spec coverage vs `research/2026-04-22-diff-refinement-plan.md`:**
- Architecture (render → diff → regen → inject): covered by Tasks 3-4 ✓
- Two-strategy diff (vision + pixel): **M1 is vision-only** per spec ("A primeiro, B depois"). Pixel diff deferred to M2 ✓
- Hard cap 1 pass for MVP (spec says 2 passes in M1 but cost/complexity argues for 1 in MVP — documented in plan header). Flagged explicitly as a narrowing.
- UI toggle: **deferred to a follow-up**. M1 ships a DevTools hook (Task 6). Spec M1 says "Toggle manual no UI (checkbox 'High fidelity')" — narrowing explicitly documented.
- Budget math: spec says ~$0.13/pass; plan uses 1 Flash diff + 1 Pro regen = matches ✓

**2. Placeholder scan:** none — all code blocks are complete.

**3. Type consistency:**
- `runVisionDiff` returns array; `runRefine` expects array and filters on `severity` ✓
- `runRefine` returns `{html, issues, changed}`; caller in mode-e.js checks `result.changed && result.html` ✓
- `replacePageContent` takes an array per mode-e.js:1125 — caller passes `[result.html]` ✓

**4. Ambiguity check:**
- Task 5 step 2 leaves injection-chain structure discovery to the implementer — guarded by the explicit `grep` command. Safe because the ordering rule in `CLAUDE.md` is fixed.
- Task 7 step 5 "does the refined output look closer" is subjective — acceptable for manual QA evidence.

**Narrowings made vs original spec (M1 MVP):**
1. 1 refinement pass max (spec said up to 2)
2. Vision diff only (no pixel diff cross-check)
3. DevTools hook instead of UI toggle
4. Whole-HTML regen (spec explored per-region regen — whole-HTML is simpler and matches same.new's pattern)

All four are documented in the plan header. M2/M3 plans (to be written later) will lift them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-mode-e-refinement.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
