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
