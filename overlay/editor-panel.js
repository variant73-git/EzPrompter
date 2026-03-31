// RepixBridge — Figma-like Editor Panel
// Floating side panel that appears when a node is selected.
// Shows sliders + numeric inputs for all editableProps of the selected element.
// Runs in page context (injected by background.js).

(function() {
  if (window.__rbEditorPanel) return;
  window.__rbEditorPanel = true;

  const PANEL_ID = 'rb-editor-panel';

  let currentDescriptor = null;
  let currentTokens = null;
  let onChangeCallback = null;

  // ─── Init ──────────────────────────────────────────────────────────────────

  window.__rbInitEditorPanel = function(tokens, onChange) {
    currentTokens = tokens;
    onChangeCallback = onChange;

    // Remove existing
    document.getElementById(PANEL_ID)?.remove();

    const panel = buildPanelShell();
    document.body.appendChild(panel);

    // Start hidden
    panel.setAttribute('hidden', '');
    return panel;
  };

  window.__rbShowEditorPanel = function(descriptor) {
    currentDescriptor = descriptor;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    renderPanelContent(panel, descriptor);
    panel.removeAttribute('hidden');
    positionPanel();
  };

  window.__rbHideEditorPanel = function() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.setAttribute('hidden', '');
    currentDescriptor = null;
  };

  window.__rbDestroyEditorPanel = function() {
    document.getElementById(PANEL_ID)?.remove();
  };

  // ─── Shell ─────────────────────────────────────────────────────────────────

  function buildPanelShell() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Header
    const header = document.createElement('div');
    header.className = 'rbep-header';

    const title = document.createElement('span');
    title.className = 'rbep-title';
    title.textContent = 'Properties';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rbep-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => window.__rbHideEditorPanel());

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body (filled dynamically)
    const body = document.createElement('div');
    body.className = 'rbep-body';
    panel.appendChild(body);

    // Make draggable
    makeDraggable(panel, header);

    return panel;
  }

  // ─── Content rendering ─────────────────────────────────────────────────────

  function renderPanelContent(panel, descriptor) {
    const body = panel.querySelector('.rbep-body');
    body.innerHTML = '';

    // Role badge + ID
    const meta = document.createElement('div');
    meta.className = 'rbep-meta';

    const roleBadge = document.createElement('span');
    roleBadge.className = 'rbep-role-badge';
    roleBadge.textContent = descriptor.role || descriptor.type || 'element';
    meta.appendChild(roleBadge);

    const idLabel = document.createElement('span');
    idLabel.className = 'rbep-id';
    idLabel.textContent = descriptor.id;
    meta.appendChild(idLabel);

    body.appendChild(meta);

    // Edit controls for each editable prop
    const props = descriptor.editableProps || [];
    if (props.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rbep-empty';
      empty.textContent = 'No editable properties.';
      body.appendChild(empty);
      return;
    }

    props.forEach(prop => {
      const control = buildControl(prop, descriptor);
      if (control) body.appendChild(control);
    });
  }

  // ─── Control builder ───────────────────────────────────────────────────────

  function buildControl(prop, descriptor) {
    const currentValue = descriptor.style?.[prop] ?? getDefaultValue(prop, descriptor);

    const group = document.createElement('div');
    group.className = 'rbep-group';

    const label = document.createElement('label');
    label.className = 'rbep-label';
    label.textContent = propLabel(prop);
    group.appendChild(label);

    if (prop === 'color') {
      group.appendChild(buildColorControl(prop, currentValue, descriptor));
    } else if (prop === 'background') {
      group.appendChild(buildColorControl(prop, currentValue, descriptor));
    } else if (prop === 'fontFamily') {
      group.appendChild(buildFontControl(prop, currentValue, descriptor));
    } else if (prop === 'fontWeight') {
      group.appendChild(buildFontWeightControl(prop, currentValue, descriptor));
    } else if (prop === 'content') {
      group.appendChild(buildTextControl(prop, currentValue, descriptor));
    } else if (prop === 'fontSize' || prop === 'lineHeight' || prop === 'letterSpacing' ||
               prop === 'height' || prop === 'padding') {
      group.appendChild(buildSliderControl(prop, currentValue, descriptor));
    } else {
      group.appendChild(buildTextInput(prop, currentValue, descriptor));
    }

    return group;
  }

  // ─── Color control (swatch palette + hex input) ────────────────────────────

  function buildColorControl(prop, currentValue, descriptor) {
    const wrap = document.createElement('div');
    wrap.className = 'rbep-color-wrap';

    // Current color preview + hex input
    const inputRow = document.createElement('div');
    inputRow.className = 'rbep-color-row';

    const swatch = document.createElement('div');
    swatch.className = 'rbep-color-swatch';
    swatch.style.background = currentValue || '#000000';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'rbep-hex-input';
    hexInput.value = currentValue || '';
    hexInput.placeholder = '#000000';
    hexInput.maxLength = 7;

    hexInput.addEventListener('input', () => {
      const v = hexInput.value;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        swatch.style.background = v;
        applyChange(descriptor, prop, v);
      }
    });

    inputRow.appendChild(swatch);
    inputRow.appendChild(hexInput);
    wrap.appendChild(inputRow);

    // Token palette (from extracted site colors)
    if (currentTokens?.colors?.length) {
      const palette = document.createElement('div');
      palette.className = 'rbep-palette';

      currentTokens.colors.forEach(hex => {
        const dot = document.createElement('button');
        dot.className = 'rbep-palette-dot';
        dot.style.background = hex;
        dot.title = hex;
        dot.addEventListener('click', () => {
          hexInput.value = hex;
          swatch.style.background = hex;
          applyChange(descriptor, prop, hex);
        });
        palette.appendChild(dot);
      });

      wrap.appendChild(palette);
    }

    return wrap;
  }

  // ─── Slider + numeric input (font size, line height, etc.) ─────────────────

  function buildSliderControl(prop, currentValue, descriptor) {
    const wrap = document.createElement('div');
    wrap.className = 'rbep-slider-wrap';

    const { min, max, step, unit } = sliderConfig(prop);
    const numericValue = parseFloat(currentValue) || min;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'rbep-slider';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = numericValue;

    const numericRow = document.createElement('div');
    numericRow.className = 'rbep-numeric-row';

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'rbep-num-input';
    numInput.min = min;
    numInput.max = max;
    numInput.step = step;
    numInput.value = numericValue;

    const unitLabel = document.createElement('span');
    unitLabel.className = 'rbep-unit';
    unitLabel.textContent = unit;

    numericRow.appendChild(numInput);
    numericRow.appendChild(unitLabel);

    // Sync slider ↔ numeric input
    slider.addEventListener('input', () => {
      numInput.value = slider.value;
      applyChange(descriptor, prop, slider.value + unit);
    });

    numInput.addEventListener('input', () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v)) {
        slider.value = v;
        applyChange(descriptor, prop, v + unit);
      }
    });

    wrap.appendChild(slider);
    wrap.appendChild(numericRow);
    return wrap;
  }

  // ─── Font family control ───────────────────────────────────────────────────

  function buildFontControl(prop, currentValue, descriptor) {
    const wrap = document.createElement('div');
    wrap.className = 'rbep-font-wrap';

    const select = document.createElement('select');
    select.className = 'rbep-select';

    // Site fonts from tokens + common fallbacks
    const fonts = [
      ...(currentTokens?.fonts || []),
      'Arial', 'Georgia', 'Helvetica Neue', 'Inter', 'Roboto', 'Times New Roman'
    ];
    const unique = [...new Set(fonts)];

    unique.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === currentValue || currentValue?.startsWith(f)) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      applyChange(descriptor, prop, select.value);
    });

    wrap.appendChild(select);
    return wrap;
  }

  // ─── Font weight control ───────────────────────────────────────────────────

  function buildFontWeightControl(prop, currentValue, descriptor) {
    const wrap = document.createElement('div');
    wrap.className = 'rbep-weight-wrap';

    const weights = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

    const row = document.createElement('div');
    row.className = 'rbep-weight-row';

    weights.forEach(w => {
      const btn = document.createElement('button');
      btn.className = 'rbep-weight-btn';
      btn.textContent = w;
      btn.style.fontWeight = w;
      if (String(currentValue) === w) btn.classList.add('active');

      btn.addEventListener('click', () => {
        row.querySelectorAll('.rbep-weight-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyChange(descriptor, prop, w);
      });

      row.appendChild(btn);
    });

    wrap.appendChild(row);
    return wrap;
  }

  // ─── Text content control (multiline) ─────────────────────────────────────

  function buildTextControl(prop, currentValue, descriptor) {
    const wrap = document.createElement('div');

    const textarea = document.createElement('textarea');
    textarea.className = 'rbep-textarea';
    textarea.value = currentValue || '';
    textarea.rows = 3;

    let debounceTimer;
    textarea.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        applyChange(descriptor, prop, textarea.value);
      }, 300);
    });

    wrap.appendChild(textarea);
    return wrap;
  }

  // ─── Generic text input ────────────────────────────────────────────────────

  function buildTextInput(prop, currentValue, descriptor) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rbep-text-input';
    input.value = currentValue || '';

    input.addEventListener('change', () => {
      applyChange(descriptor, prop, input.value);
    });

    return input;
  }

  // ─── Apply change ──────────────────────────────────────────────────────────

  function applyChange(descriptor, prop, value) {
    // Update our semantic map via renderer
    if (window.__rbApplyStyle) {
      window.__rbApplyStyle(descriptor.id, prop, value);
    }
    // Update local descriptor
    if (!descriptor.style) descriptor.style = {};
    descriptor.style[prop] = value;

    if (onChangeCallback) onChangeCallback(descriptor.id, prop, value);
  }

  // ─── Position panel ────────────────────────────────────────────────────────

  function positionPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    // Default: right side of viewport
    if (!panel.dataset.positioned) {
      panel.style.right = '24px';
      panel.style.top = '80px';
      panel.dataset.positioned = '1';
    }
  }

  // ─── Drag ─────────────────────────────────────────────────────────────────

  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('rbep-close')) return;
      e.preventDefault();

      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // Switch from right-anchored to left-anchored when dragging
      panel.style.right = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.dataset.positioned = '1';

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = (startLeft + dx) + 'px';
        panel.style.top = (startTop + dy) + 'px';
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function propLabel(prop) {
    const labels = {
      fontSize: 'Font Size',
      fontWeight: 'Font Weight',
      fontFamily: 'Font Family',
      color: 'Color',
      background: 'Background',
      lineHeight: 'Line Height',
      letterSpacing: 'Letter Spacing',
      height: 'Height',
      padding: 'Padding',
      content: 'Content',
    };
    return labels[prop] || prop;
  }

  function sliderConfig(prop) {
    const configs = {
      fontSize:      { min: 8,    max: 120,  step: 1,   unit: 'px' },
      lineHeight:    { min: 0.8,  max: 3,    step: 0.05, unit: '' },
      letterSpacing: { min: -2,   max: 20,   step: 0.5,  unit: 'px' },
      height:        { min: 20,   max: 800,  step: 4,   unit: 'px' },
      padding:       { min: 0,    max: 120,  step: 4,   unit: 'px' },
    };
    return configs[prop] || { min: 0, max: 100, step: 1, unit: 'px' };
  }

  function getDefaultValue(prop, descriptor) {
    const defaults = {
      fontSize: '16px', fontWeight: '400', fontFamily: 'sans-serif',
      color: '#000000', background: 'transparent', lineHeight: '1.5',
      letterSpacing: '0px', height: 'auto', padding: '0px', content: '',
    };
    return defaults[prop] || '';
  }

})();
