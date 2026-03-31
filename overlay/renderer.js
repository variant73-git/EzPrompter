// RepixBridge — Semantic Overlay Renderer
// Creates our controlled "papel vegetal" layer over the frozen site.
// Runs in page context (injected by background.js).

(function() {
  if (window.__rbRenderer) return;
  window.__rbRenderer = true;

  const LAYER_ID = 'rb-design-layer';
  const NODE_CLASS = 'rb-node';
  const SELECTED_CLASS = 'rb-node-selected';
  const HOVERED_CLASS = 'rb-node-hovered';

  let semanticMap = null;
  let selectedNode = null;
  let onSelectCallback = null;

  // ─── Init ──────────────────────────────────────────────────────────────────

  window.__rbRender = function(map, onSelect) {
    semanticMap = map;
    onSelectCallback = onSelect;

    // Remove existing layer
    document.getElementById(LAYER_ID)?.remove();

    // Freeze site
    document.documentElement.style.pointerEvents = 'none';
    document.documentElement.style.userSelect = 'none';

    // Create our controlled layer
    const layer = document.createElement('div');
    layer.id = LAYER_ID;
    document.body.appendChild(layer);

    // Render sections and their elements
    map.sections.forEach(section => {
      renderSection(section, layer);
    });

    return layer;
  };

  window.__rbDestroy = function() {
    document.getElementById(LAYER_ID)?.remove();
    document.documentElement.style.pointerEvents = '';
    document.documentElement.style.userSelect = '';
    selectedNode = null;
  };

  // ─── Section rendering ─────────────────────────────────────────────────────

  function renderSection(section, layer) {
    const node = createNode(section, 'section');
    applyBounds(node, section.bounds);
    layer.appendChild(node);

    // Render child elements
    if (section.elements) {
      section.elements.forEach(el => {
        const child = createNode(el, 'element');
        applyBounds(child, el.bounds);
        layer.appendChild(child); // flat layout — all on same layer plane
      });
    }
  }

  function createNode(descriptor, nodeType) {
    const node = document.createElement('div');
    node.className = NODE_CLASS;
    node.dataset.rbId = descriptor.id;
    node.dataset.rbType = nodeType;
    node.dataset.rbRole = descriptor.role || descriptor.type || '';
    node.dataset.rbEditable = JSON.stringify(descriptor.editableProps || []);
    node.dataset.rbDescriptor = JSON.stringify(descriptor);

    // Visual label (shown on hover)
    const label = document.createElement('div');
    label.className = 'rb-node-label';
    label.textContent = descriptor.role || descriptor.type || descriptor.id;
    node.appendChild(label);

    // Resize handles (shown on select)
    if (nodeType === 'element') {
      ['nw', 'ne', 'sw', 'se'].forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `rb-handle rb-handle-${dir}`;
        handle.dataset.dir = dir;
        node.appendChild(handle);
      });
    }

    // Events
    node.addEventListener('mouseenter', () => {
      node.classList.add(HOVERED_CLASS);
    });

    node.addEventListener('mouseleave', () => {
      node.classList.remove(HOVERED_CLASS);
    });

    node.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(node, descriptor);
    });

    return node;
  }

  function applyBounds(node, bounds) {
    node.style.cssText += `
      left: ${bounds.x}px;
      top: ${bounds.y}px;
      width: ${bounds.w}px;
      height: ${bounds.h}px;
    `;
  }

  // ─── Selection ─────────────────────────────────────────────────────────────

  function selectNode(node, descriptor) {
    // Deselect previous
    document.querySelectorAll(`.${SELECTED_CLASS}`)
      .forEach(n => n.classList.remove(SELECTED_CLASS));

    node.classList.add(SELECTED_CLASS);
    selectedNode = { node, descriptor };

    if (onSelectCallback) onSelectCallback(descriptor);
  }

  // Deselect on layer background click
  document.addEventListener('click', (e) => {
    if (e.target.id === LAYER_ID) {
      document.querySelectorAll(`.${SELECTED_CLASS}`)
        .forEach(n => n.classList.remove(SELECTED_CLASS));
      selectedNode = null;
      if (onSelectCallback) onSelectCallback(null);
    }
  });

  // ─── Live style application ─────────────────────────────────────────────────
  // When designer edits a property, apply it to the real DOM element

  window.__rbApplyStyle = function(elementId, prop, value) {
    if (!semanticMap) return;

    // Find descriptor
    let descriptor = null;
    for (const section of semanticMap.sections) {
      if (section.id === elementId) { descriptor = section; break; }
      if (section.elements) {
        const el = section.elements.find(e => e.id === elementId);
        if (el) { descriptor = el; break; }
      }
    }

    if (!descriptor || !descriptor.selector) return;

    // Apply to real DOM element
    const realEl = document.querySelector(descriptor.selector);
    if (realEl) {
      realEl.style[cssProp(prop)] = value;
    }

    // Update our overlay node bounds if size changed
    if (prop === 'fontSize' || prop === 'height' || prop === 'padding') {
      setTimeout(() => refreshNodeBounds(elementId, descriptor.selector), 50);
    }

    // Update descriptor
    if (descriptor.style) descriptor.style[prop] = value;
  };

  function refreshNodeBounds(id, selector) {
    const realEl = document.querySelector(selector);
    if (!realEl) return;
    const r = realEl.getBoundingClientRect();
    const node = document.querySelector(`[data-rb-id="${id}"]`);
    if (node) {
      node.style.left = `${r.left + window.scrollX}px`;
      node.style.top = `${r.top + window.scrollY}px`;
      node.style.width = `${r.width}px`;
      node.style.height = `${r.height}px`;
    }
  }

  // ─── Export current state ──────────────────────────────────────────────────

  window.__rbExportState = function() {
    return JSON.parse(JSON.stringify(semanticMap)); // deep clone
  };

  // ─── CSS prop name normalization ───────────────────────────────────────────

  function cssProp(name) {
    const map = {
      fontSize: 'fontSize',
      fontWeight: 'fontWeight',
      fontFamily: 'fontFamily',
      color: 'color',
      background: 'background',
      lineHeight: 'lineHeight',
      letterSpacing: 'letterSpacing',
      height: 'height',
      padding: 'padding',
    };
    return map[name] || name;
  }

})();
