/**
 * Repix Mode E2 — Fast HTML-to-Code pipeline.
 *
 * Strategy (inspired by same.new's agent transcript):
 *  1. ANALYZE  — send cleanHTML + tokens to Flash. Get back strict JSON with
 *                {overall_tone, colors, fonts, sections[]}. One small call.
 *  2. GENERATE — for each section, a PARALLEL small call: "build this one
 *                section in HTML+Tailwind, extract texts/images from source".
 *                Many short calls beat one gigantic call on latency + cost.
 *  3. STITCH   — concatenate the section HTMLs, inject Tailwind CDN, replace
 *                the live page.
 *
 * Why not reuse Mode E:
 *  - Mode E is Vision-to-Code (screenshot → LLM). Expensive, ~12 min total.
 *  - E2 is HTML-to-Code (clean DOM → LLM). No vision tokens. Model can be
 *    Flash-class (10-20× cheaper, 3-5× faster) because structure is already
 *    given; the LLM just has to style + organize.
 *
 * Target: 20-40s wall time, $0.05-0.10/clone, ~85-90% fidelity.
 *
 * Delegates the actual Gemini call to background.js (action: 'modeE2Call'),
 * which handles the API key + model selection and returns plain text.
 */
(function() {
  if (window.__rbModeE2) return;

  var CALL_TIMEOUT_MS = 60000;
  var MAX_PARALLEL = 3;

  function callLLM(prompt, model) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        reject(new Error('E2 call timed out after ' + Math.round(CALL_TIMEOUT_MS / 1000) + 's'));
      }, CALL_TIMEOUT_MS);
      chrome.runtime.sendMessage({
        action: 'modeE2Call',
        prompt: prompt,
        model: model || null
      }, function(response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.text) resolve(response.text);
        else if (response && response.error) reject(new Error(response.error));
        else reject(new Error('Empty response from LLM'));
      });
    });
  }

  function gatherInputs() {
    var cleanHTML = '';
    var designMD = '';
    try { if (window.__rbExtractor && window.__rbExtractor.extractCleanHTML) cleanHTML = window.__rbExtractor.extractCleanHTML() || ''; } catch (e) {}
    try { if (window.__rbExtractor && window.__rbExtractor.generateDesignMD) designMD = window.__rbExtractor.generateDesignMD() || ''; } catch (e) {}
    return { cleanHTML: cleanHTML, designMD: designMD };
  }

  // Strip markdown code fences + leading/trailing noise so JSON.parse works.
  function stripFence(raw) {
    if (!raw) return '';
    var s = raw.trim();
    s = s.replace(/^```(?:json|javascript|html)?\s*/i, '');
    s = s.replace(/```\s*$/, '');
    // If the model wrapped JSON in prose, grab from first { to last }.
    if (s[0] !== '{') {
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) s = s.substring(a, b + 1);
    }
    return s.trim();
  }

  function buildAnalyzePrompt(cleanHTML, designMD) {
    var html = cleanHTML.length > 50000 ? cleanHTML.substring(0, 50000) + '\n<!-- truncated -->' : cleanHTML;
    var tokens = designMD.length > 8000 ? designMD.substring(0, 8000) : designMD;
    return [
      'Analyze the website HTML + design tokens. Return STRICT JSON (no prose, no markdown).',
      '',
      'Schema:',
      '{',
      '  "overall_tone": "1 sentence on the site aesthetic",',
      '  "colors": { "bg": "#...", "text": "#...", "primary": "#...", "accent": "#..." },',
      '  "fonts": { "heading": "Font Name", "body": "Font Name" },',
      '  "sections": [',
      '    { "id": "hero-1", "role": "hero|features|testimonials|stats|cta|footer|...", "summary": "~20 words on content" }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- Emit EVERY visible section in visual order (typically 4-10).',
      '- Colors must be hex values present in the tokens, NOT guesses.',
      '- Section summaries should be concrete enough that a generator can recreate them ("Hero with headline X, CTA Y").',
      '- Output ONLY the JSON object. No leading ```, no trailing prose.',
      '',
      '==== DESIGN TOKENS (summary) ====',
      tokens,
      '',
      '==== CLEAN HTML ====',
      html
    ].join('\n');
  }

  function buildSectionPrompt(section, analysis, cleanHTML) {
    var html = cleanHTML.length > 30000 ? cleanHTML.substring(0, 30000) + '\n<!-- truncated -->' : cleanHTML;
    return [
      'Generate ONE section of a website clone in HTML + Tailwind CSS classes.',
      '',
      'OUTPUT: a single <section>...</section> block. No <html>, <head>, <body>, <style>, no wrappers outside <section>.',
      '',
      '== Section to build ==',
      'id: ' + section.id,
      'role: ' + section.role,
      'summary: ' + section.summary,
      '',
      '== Design system (match EXACTLY) ==',
      'Tone: ' + (analysis.overall_tone || ''),
      'Colors: ' + JSON.stringify(analysis.colors || {}),
      'Fonts: heading="' + (analysis.fonts && analysis.fonts.heading || 'inherit') + '", body="' + (analysis.fonts && analysis.fonts.body || 'inherit') + '"',
      '',
      '== Rules ==',
      '- Use Tailwind utility classes for ALL styling. No inline style=, no <style> blocks.',
      '- Match colors via arbitrary values when no Tailwind palette fits: bg-[#abcdef], text-[#abcdef], border-[#abcdef].',
      '- Match fonts with Tailwind class like font-[\'Font_Name\'] or inline style fallback only if Tailwind cannot express it.',
      '- Extract texts VERBATIM from the source HTML below. Do not paraphrase, do not invent.',
      '- Preserve real image URLs when referenced in the source (absolute URLs only).',
      '- For decorative shapes use <div> + Tailwind (rounded-*, rotate-*, etc.), NOT inline SVG.',
      '- If the source uses a marquee/carousel, render ONE copy of the items (not duplicated). Add class="animate-[marquee_30s_linear_infinite]" only if natural.',
      '- Responsive: use md:/lg: prefixes when the source has media-query variations.',
      '- Return ONLY the <section>…</section> block. No commentary.',
      '',
      '==== SOURCE HTML (extract texts/images from this) ====',
      html
    ].join('\n');
  }

  async function analyze(inputs) {
    var prompt = buildAnalyzePrompt(inputs.cleanHTML, inputs.designMD);
    var raw = await callLLM(prompt);
    var json = stripFence(raw);
    var parsed;
    try { parsed = JSON.parse(json); }
    catch (e) { throw new Error('Analyze JSON parse failed: ' + e.message + ' — raw start: ' + json.substring(0, 200)); }
    if (!parsed || !Array.isArray(parsed.sections)) throw new Error('Analyze returned no sections array');
    return parsed;
  }

  function stripSectionFence(raw) {
    if (!raw) return '';
    var s = raw.trim();
    s = s.replace(/^```(?:html|javascript)?\s*/i, '').replace(/```\s*$/, '').trim();
    // Strip accidental wrappers the model adds before <section>
    var m = s.match(/<section[\s\S]*?<\/section>/i);
    return m ? m[0] : s;
  }

  async function generateSection(section, analysis, cleanHTML) {
    var prompt = buildSectionPrompt(section, analysis, cleanHTML);
    var raw = await callLLM(prompt);
    return stripSectionFence(raw);
  }

  // Run async tasks with a concurrency cap. Returns a promise of results in
  // input order (errors become <!-- comments --> so one failed section
  // doesn't kill the whole clone).
  function runWithConcurrency(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    function next() {
      if (cursor >= items.length) return Promise.resolve();
      var i = cursor++;
      return Promise.resolve(worker(items[i], i))
        .then(function(r) { results[i] = r; })
        .catch(function(e) { results[i] = '<!-- section ' + (items[i].id || i) + ' failed: ' + e.message + ' -->'; })
        .then(next);
    }
    var lanes = [];
    for (var k = 0; k < Math.min(limit, items.length); k++) lanes.push(next());
    return Promise.all(lanes).then(function() { return results; });
  }

  function replaceWithClone(sectionHTMLs) {
    var editorEls = [];
    Array.from(document.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) {
        editorEls.push(child);
      }
    });
    var originalChildren = [];
    Array.from(document.body.children).forEach(function(child) {
      if (editorEls.indexOf(child) === -1) originalChildren.push(child);
    });
    var scrollY = window.scrollY;

    var wrapper = document.createElement('div');
    wrapper.id = 'rb-e2-clone';
    wrapper.style.cssText = 'max-width:100%;margin:0 auto;min-height:100vh;font-family:system-ui,-apple-system,sans-serif;';
    sectionHTMLs.forEach(function(html) {
      var holder = document.createElement('div');
      holder.innerHTML = html;
      while (holder.firstChild) wrapper.appendChild(holder.firstChild);
    });

    // Tailwind CDN so utility classes resolve.
    var twId = 'rb-tailwind-cdn';
    if (!document.getElementById(twId)) {
      var tw = document.createElement('script');
      tw.id = twId;
      tw.src = 'https://cdn.tailwindcss.com/3.4.17';
      document.head.appendChild(tw);
    }

    originalChildren.forEach(function(child) { if (child.parentElement) child.parentElement.removeChild(child); });
    if (editorEls.length > 0) document.body.insertBefore(wrapper, editorEls[0]);
    else document.body.appendChild(wrapper);

    document.body.style.margin = '0';
    document.body.style.padding = '0';

    // Push undo (same __modeERun shape so existing handler in editor.js revives it).
    if (typeof window.__rbPushUndo === 'function') {
      try {
        window.__rbPushUndo({
          prop: '__modeERun',
          originalChildren: originalChildren,
          scrollY: scrollY,
          rebuiltWrapper: wrapper
        });
      } catch (e) {}
    }

    window.__rbOriginalPage = { children: originalChildren, scrollY: scrollY };
    return wrapper;
  }

  function restoreOriginalPage() {
    if (!window.__rbOriginalPage) return;
    var wrapper = document.getElementById('rb-e2-clone');
    if (wrapper) wrapper.remove();
    var tw = document.getElementById('rb-tailwind-cdn');
    if (tw) tw.remove();

    var editorEls = [];
    Array.from(document.body.children).forEach(function(child) {
      if (child.id && (child.id.indexOf('rb-editor') === 0 || child.id.indexOf('rb-ed-') === 0)) editorEls.push(child);
    });
    var before = editorEls[0] || null;
    window.__rbOriginalPage.children.forEach(function(child) {
      if (before) document.body.insertBefore(child, before);
      else document.body.appendChild(child);
    });
    window.scrollTo(0, window.__rbOriginalPage.scrollY || 0);
    window.__rbOriginalPage = null;
  }

  async function run(onProgress) {
    var log = onProgress || function() {};
    log({step: 'gather', message: 'Reading HTML + tokens…', current: 0, total: 4});
    var inputs = gatherInputs();
    if (!inputs.cleanHTML) throw new Error('Extractor unavailable or empty cleanHTML');

    log({step: 'analyze', message: 'Analyzing structure…', current: 1, total: 4});
    var t0 = Date.now();
    var analysis = await analyze(inputs);
    var secs = analysis.sections;
    log({step: 'analyze', message: 'Analysis done (' + secs.length + ' sections) in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', current: 2, total: 4});

    log({step: 'generate', message: 'Generating ' + secs.length + ' sections (parallel ' + MAX_PARALLEL + ')…', current: 3, total: 4});
    var t1 = Date.now();
    var htmls = await runWithConcurrency(secs, MAX_PARALLEL, function(sec) {
      return generateSection(sec, analysis, inputs.cleanHTML);
    });
    log({step: 'generate', message: 'Sections done in ' + ((Date.now() - t1) / 1000).toFixed(1) + 's', current: 4, total: 4});

    log({step: 'stitch', message: 'Stitching + injecting…', current: 4, total: 4});
    replaceWithClone(htmls);

    return {
      sectionCount: secs.length,
      totalMs: Date.now() - t0,
      sizeKB: Math.round(htmls.join('').length / 1024)
    };
  }

  window.__rbModeE2 = {
    run: run,
    restore: restoreOriginalPage
  };
})();
