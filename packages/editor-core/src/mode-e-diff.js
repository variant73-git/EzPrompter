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
    var p = new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        action: 'modeERefineCall',
        imageDataUrls: imageDataUrls,
        prompt: prompt,
        model: model || null,
        maxOutputTokens: 8000
      }, function(response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.text) resolve(response.text);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from diff LLM'));
      });
    });
    // Use the shared wallclock watchdog + cancel gate from mode-e.js when
    // available — setInterval-based so the timer fires even when Chrome has
    // intensively-throttled the tab, which previously masked a stuck diff
    // call for 80 minutes. Fallback to the original setTimeout if the helper
    // isn't loaded (this file can run standalone).
    if (window.__rbModeE && window.__rbModeE._guardCall) {
      return window.__rbModeE._guardCall(p, CALL_TIMEOUT_MS, 'Diff call');
    }
    return new Promise(function(resolve, reject) {
      var settled = false;
      var start = Date.now();
      var iv = setInterval(function() {
        if (settled) return;
        if (Date.now() - start >= CALL_TIMEOUT_MS) {
          settled = true;
          clearInterval(iv);
          reject(new Error('Diff call timed out after ' + Math.round((Date.now() - start) / 1000) + 's'));
        }
      }, 1000);
      p.then(
        function(v) { if (!settled) { settled = true; clearInterval(iv); resolve(v); } },
        function(e) { if (!settled) { settled = true; clearInterval(iv); reject(e); } }
      );
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
      '  "issue": "one-sentence description (max 80 chars)"',
      '}',
      '',
      'Rules:',
      '- Max 6 items. If perfect match, return [].',
      '- Keep each "issue" string under 80 characters. Be terse.',
      '- severity "high" = clearly broken or missing; "medium" = visibly off; "low" = minor.',
      '- bbox is a rough rectangle around the problem area in the clone (IMAGE 2), not the original.',
      '- If a whole section is wrong, one bbox for that section — do not duplicate items.'
    ].join('\n');
  }

  function coerceBbox(b) {
    function n(v) {
      var x = parseFloat(v);
      return (x >= 0 && x <= 1) ? x : 0;
    }
    if (!b || typeof b !== 'object') return {x:0, y:0, w:0, h:0};
    return { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
  }

  // Tolerant JSON array parser — when the LLM's output is truncated mid-item
  // (hit maxOutputTokens before closing the array), JSON.parse blows up and
  // we lose every valid item that was already produced. This scanner walks
  // the raw text with a string-aware state machine and returns only the
  // top-level {...} items that parse cleanly; malformed/truncated tails are
  // dropped silently. Observed in the field: an 8-item diff got cut inside
  // item 4's "issue" string, and we lost all 3 good items to the parse error.
  function salvageJsonArray(raw) {
    try {
      var v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch (e) { /* fall through to scanner */ }

    var items = [];
    var inString = false;
    var escape = false;
    var depth = 0;
    var start = -1;
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          var slice = raw.substring(start, i + 1);
          try { items.push(JSON.parse(slice)); } catch (_) { /* skip malformed */ }
          start = -1;
        }
      }
    }
    return items;
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
    var parsed = salvageJsonArray(json);
    if (!Array.isArray(parsed)) {
      throw new Error('Diff expected an array, got: ' + typeof parsed);
    }
    // Distinguish "legit clean" ([]) from "salvage found nothing parseable".
    // If the LLM really returned an empty array, parsed.length === 0 is fine.
    // If it returned a big blob that salvage couldn't parse any item from,
    // that's a real failure and we surface it so the user sees refine-skip
    // instead of a false refine-clean.
    if (parsed.length === 0) {
      var trimmed = json.trim();
      if (!(trimmed === '[]' || trimmed === '' || trimmed === '[\n]')) {
        throw new Error('Diff JSON parse salvaged 0 items from ' + json.length + 'B raw. First 200 chars: ' + json.substring(0, 200));
      }
    }
    // Best-effort: clamp severities + coerce bbox shape.
    return parsed
      .map(function(item) {
        return {
          region: String(item.region || 'unknown'),
          severity: ['high','medium','low'].indexOf(item.severity) >= 0 ? item.severity : 'low',
          bbox: coerceBbox(item.bbox),
          issue: String(item.issue || '')
        };
      })
      .slice(0, 8);
  }

  window.__rbModeEDiff = {
    runVisionDiff: runVisionDiff
  };
})();
