# Nested Layers Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Figma-style layers panel on the left side of the screen and progressive click-to-deepen selection, so designers can navigate any nested DOM structure visually.

**Architecture:** Two complementary systems — (1) a click-depth tracker that starts at the outermost container and drills one level per subsequent click, and (2) a left-side layers panel that renders the DOM tree lazily, syncs highlight/selection with the canvas, and uses the same visual language as the existing inspector. The layers panel is a new DOM tree inside the existing `#rb-editor-root` overlay. No new files — all code lives in `editor/editor.js` and `editor/editor.css`.

**Tech Stack:** Vanilla JS (Chrome Extension content script), CSS, Chrome Scripting API

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `editor/editor.js` | Modify | Add layers panel logic, click-depth selection system |
| `editor/editor.css` | Modify | Add layers panel styles (mirrors inspector visual language) |

---

## Concepts

### Click-Depth Selection

Current behavior: `resolveContainer(rawEl)` always jumps to the outermost meaningful container.

New behavior:
- **First click** on an area: `resolveContainer` runs as today — selects the outermost meaningful container.
- **Second click** on the *same* selected element (within 500ms): instead of entering text edit, it **drills into the first visible child** at the click coordinates (using `elementsFromPoint` to find the deepest element, then walking up to one level below the current selection).
- **Third click** and beyond: keeps drilling deeper, one level at a time.
- **Double-click on a text element** (leaf): enters text edit as today.
- **Click on a different area**: resets depth, selects new outermost container.
- Track current depth with a `selectionDepth` counter and `selectionAncestor` reference.

### Layers Panel

A fixed panel on the left side, same visual style as the inspector:
- `#rb-editor-layers` — mirror of `#rb-editor-inspector` position/style but on the left
- Shows DOM tree starting from `<body>` children
- Each node row: collapse chevron + tag icon + element label (tag.class or text preview)
- **Lazy rendering**: only expand children when the user clicks the chevron
- **Hover sync**: hovering a layer row highlights the element on the page (uses existing `updateHoverBox`)
- **Click sync**: clicking a layer row selects the element (calls `selectEl`)
- **Selection sync**: selecting an element on the canvas auto-expands the tree to that element and highlights its row
- Wrapper divs (matching `isUselessWrapper`) shown with 40% opacity
- Scroll into view when selecting from canvas

---

## Task 1: Click-Depth Selection System

**Files:**
- Modify: `editor/editor.js` (mousedown handler at ~line 2681, selectEl at ~line 1978)

### Steps

- [ ] **Step 1.1: Add depth-tracking state variables**

After the existing `var selectedEl = null;` declaration (around line 40-50 area where global state lives), add:

```javascript
var selectionDepth = 0;       // How many levels deep we've drilled
var selectionAncestor = null; // The outermost container we started drilling from
```

- [ ] **Step 1.2: Create `drillInto` helper function**

Add this function near `resolveContainer` (around line 2575):

```javascript
function drillInto(parentEl, x, y) {
  // Get all elements at this point, deepest first
  var stack = document.elementsFromPoint(x, y);
  // Find elements that are direct or nested children of parentEl
  var candidates = [];
  for (var i = 0; i < stack.length; i++) {
    var el = stack[i];
    if (el === parentEl || isEditorEl(el)) continue;
    if (!parentEl.contains(el)) continue;
    candidates.push(el);
  }
  if (candidates.length === 0) return null;

  // Walk each candidate up to find the direct child of parentEl
  var directChild = null;
  for (var i = 0; i < candidates.length; i++) {
    var walk = candidates[i];
    var maxWalk = 20;
    while (walk && walk.parentElement !== parentEl && maxWalk-- > 0) {
      walk = walk.parentElement;
    }
    if (walk && walk.parentElement === parentEl && isValid(walk) && !isEditorEl(walk)) {
      directChild = walk;
      break;
    }
  }

  // If direct child is inline text, try its first visible block child instead
  if (directChild && INLINE_TAGS.has(directChild.tagName)) {
    return null; // Can't drill into inline tags
  }

  return directChild;
}
```

- [ ] **Step 1.3: Rewrite the mousedown click handler**

Replace the mousedown handler (lines ~2681-2728) with the new depth-aware version:

```javascript
document.addEventListener('mousedown', function(e) {
  if (isEditorEl(e.target)) return;
  var rawEl = document.elementFromPoint(e.clientX, e.clientY);
  if (!rawEl || !isValid(rawEl)) return;

  // Prevent link navigation
  var link = e.target.closest('a');
  if (link && !isEditorEl(link)) { e.preventDefault(); }

  var now = Date.now();
  var isRepeatClick = (selectedEl) && (now - lastClickTime < 500) && selectedEl.contains(rawEl);
  lastClickTime = now;
  lastClickEl = rawEl;

  // Already in text edit mode — let browser handle
  if (selectedEl && selectedEl.contentEditable === 'true') {
    return;
  }

  e.preventDefault();
  removeImgMenu();

  if (!isRepeatClick) {
    // --- NEW AREA: reset depth, resolve outermost container ---
    var el = resolveContainer(rawEl);
    if (!isValid(el)) return;
    selectionDepth = 0;
    selectionAncestor = el;

    if (el.tagName === 'IMG') showImgMenu(el, e.clientX, e.clientY);
    selectEl(el);
    syncLayersSelection(el);

    if (el.contentEditable !== 'true') {
      dragStart = {x: e.clientX, y: e.clientY};
      dragThreshold = false;
    }
  } else {
    // --- REPEAT CLICK on same area: drill deeper ---
    var deeper = drillInto(selectedEl, e.clientX, e.clientY);

    if (deeper) {
      // Check if the deeper element is a text leaf — if so, enter text edit
      if (isText(deeper) && deeper.children.length === 0) {
        selectEl(deeper);
        syncLayersSelection(deeper);
        enterTextEdit(deeper);
        dragStart = null;
        dragThreshold = false;
        return;
      }

      selectionDepth++;
      selectEl(deeper);
      syncLayersSelection(deeper);

      if (deeper.tagName === 'IMG') showImgMenu(deeper, e.clientX, e.clientY);
      if (deeper.contentEditable !== 'true') {
        dragStart = {x: e.clientX, y: e.clientY};
        dragThreshold = false;
      }
    } else {
      // Can't drill deeper — if text, enter edit mode
      if (isText(selectedEl) && selectedEl.contentEditable !== 'true') {
        enterTextEdit(selectedEl);
        dragStart = null;
        dragThreshold = false;
      }
    }
  }
}, {signal: sig, capture: true});
```

- [ ] **Step 1.4: Reset depth on deselect**

In `deselectEl` (line ~2023), add depth reset:

```javascript
function deselectEl() {
  if (selectedEl) {
    selectedEl.contentEditable = 'false';
    selectedEl.removeAttribute('data-rb-editing');
    selectedEl.classList.remove('rb-ed-movable');
  }
  var sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  selectedEl = null;
  selectionDepth = 0;        // ADD
  selectionAncestor = null;  // ADD
  if (isTextEditing) exitTextEdit();
  isTextEditing = false;
  selBox.style.display = 'none';
  parentBox.style.display = 'none';
  var lock = document.getElementById('rb-ed-lock');
  if (lock) lock.remove();
  hideSpacingGuides();
  showGlobalCSS();
  syncLayersSelection(null);  // ADD
}
```

- [ ] **Step 1.5: Test click-depth manually**

Load the extension on any site (e.g. apple.com). Click a hero section — should select outermost container. Click again in same area — should drill into a child. Click again — deeper child. Click elsewhere — resets to new outermost container.

- [ ] **Step 1.6: Commit**

```bash
git add editor/editor.js
git commit -m "feat: click-depth selection — drill into nested elements with repeated clicks"
```

---

## Task 2: Layers Panel — DOM Structure and CSS

**Files:**
- Modify: `editor/editor.css` (add layers panel styles)
- Modify: `editor/editor.js` (create layers panel DOM in `buildInspector`)

### Steps

- [ ] **Step 2.1: Add layers panel CSS**

Add to `editor/editor.css` after the inspector styles (~line 85):

```css
/* ===== LAYERS PANEL (left) ===== */
#rb-editor-layers {
  position:fixed; left:8px; top:40px;
  width:220px; max-height:calc(100vh - 52px);
  background:#1A1A1A; border-radius:16px;
  box-shadow:0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  overflow-y:auto; overflow-x:hidden;
  pointer-events:auto; z-index:2147483643;
  animation:rb-ed-slide-in 200ms ease-out;
  scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.06) transparent;
  -webkit-font-smoothing:antialiased;
  font-family:'Instrument Sans',sans-serif;
}
#rb-editor-layers::-webkit-scrollbar { width:3px; }
#rb-editor-layers::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06); border-radius:2px; }

#rb-ed-layers-header {
  position:sticky; top:0; z-index:1;
  background:#1A1A1A; padding:12px 14px 8px;
  border-bottom:1px solid rgba(255,255,255,0.06);
  display:flex; align-items:center; justify-content:space-between;
}
#rb-ed-layers-header span {
  font:600 10px/1 'Instrument Sans',sans-serif;
  color:rgba(239,238,235,0.35); text-transform:uppercase; letter-spacing:0.5px;
}
#rb-ed-layers-body {
  padding:4px 0;
}

/* Layer row */
.rb-layer-row {
  display:flex; align-items:center; gap:4px;
  padding:3px 6px 3px calc(6px + var(--rb-layer-depth, 0) * 12px);
  cursor:pointer; user-select:none;
  font:400 10px/1.3 'Instrument Sans',sans-serif;
  color:rgba(239,238,235,0.6);
  transition:background 80ms, color 80ms;
  min-height:22px;
}
.rb-layer-row:hover {
  background:rgba(255,255,255,0.04);
  color:#EFEEEB;
}
.rb-layer-row.rb-layer-selected {
  background:rgba(0,149,255,0.12);
  color:#EFEEEB;
}
.rb-layer-row.rb-layer-wrapper {
  opacity:0.4;
}

/* Chevron toggle */
.rb-layer-chev {
  width:10px; height:10px; flex-shrink:0;
  display:flex; align-items:center; justify-content:center;
  transition:transform 120ms ease;
  transform:rotate(0deg);
}
.rb-layer-chev.rb-layer-open { transform:rotate(90deg); }
.rb-layer-chev svg { width:8px; height:8px; }

/* Placeholder for leaf nodes (no chevron but keeps alignment) */
.rb-layer-chev-placeholder {
  width:10px; height:10px; flex-shrink:0;
}

/* Tag icon — small colored indicator */
.rb-layer-icon {
  width:10px; height:10px; border-radius:2px; flex-shrink:0;
}
.rb-layer-icon[data-tag="img"],
.rb-layer-icon[data-tag="video"],
.rb-layer-icon[data-tag="canvas"] { background:#A78BFA; }
.rb-layer-icon[data-tag="a"],
.rb-layer-icon[data-tag="button"] { background:#60A5FA; }
.rb-layer-icon[data-tag="svg"] { background:#34D399; }
.rb-layer-icon[data-tag="div"],
.rb-layer-icon[data-tag="section"],
.rb-layer-icon[data-tag="article"],
.rb-layer-icon[data-tag="main"],
.rb-layer-icon[data-tag="header"],
.rb-layer-icon[data-tag="footer"],
.rb-layer-icon[data-tag="nav"] { background:rgba(239,238,235,0.15); }

/* Text elements */
.rb-layer-icon[data-tag="h1"],
.rb-layer-icon[data-tag="h2"],
.rb-layer-icon[data-tag="h3"],
.rb-layer-icon[data-tag="h4"],
.rb-layer-icon[data-tag="h5"],
.rb-layer-icon[data-tag="h6"],
.rb-layer-icon[data-tag="p"],
.rb-layer-icon[data-tag="span"],
.rb-layer-icon[data-tag="li"] { background:#FBBF24; }

/* Layer label */
.rb-layer-label {
  flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

/* Children container */
.rb-layer-children {
  display:none;
}
.rb-layer-children.rb-layer-expanded {
  display:block;
}

/* Minimized state */
#rb-editor-layers.rb-ed-minimized #rb-ed-layers-body { display:none; }
```

- [ ] **Step 2.2: Create layers panel DOM in `buildInspector`**

In `editor/editor.js`, inside the `buildInspector` function (after the inspector is appended to `root` at line ~929), add:

```javascript
// ---- LAYERS PANEL (left side) ----
var layersPanel = mk('div');
layersPanel.id = 'rb-editor-layers';

var layersHd = mk('div');
layersHd.id = 'rb-ed-layers-header';
var layersTitle = mk('span');
layersTitle.textContent = 'Layers';
layersHd.appendChild(layersTitle);

// Minimize button
var layersMinBtn = mk('button', 'rb-ed-minmax-btn');
layersMinBtn.innerHTML = '<span class="rb-ed-icon-minimize"></span>';
layersMinBtn.title = 'Minimize layers';
var layersMinimized = false;
layersMinBtn.addEventListener('click', function() {
  layersMinimized = !layersMinimized;
  layersPanel.classList.toggle('rb-ed-minimized', layersMinimized);
  layersMinBtn.innerHTML = layersMinimized
    ? '<span class="rb-ed-icon-maximize"></span>'
    : '<span class="rb-ed-icon-minimize"></span>';
}, {signal: sig});
layersHd.appendChild(layersMinBtn);

layersPanel.appendChild(layersHd);

var layersBody = mk('div');
layersBody.id = 'rb-ed-layers-body';
layersPanel.appendChild(layersBody);

root.appendChild(layersPanel);
```

- [ ] **Step 2.3: Verify panel renders**

Load extension, check that an empty dark panel appears on the left side at the same height as the inspector.

- [ ] **Step 2.4: Commit**

```bash
git add editor/editor.js editor/editor.css
git commit -m "feat: layers panel — empty shell with matching inspector styling"
```

---

## Task 3: Populate Layers Tree (Lazy Rendering)

**Files:**
- Modify: `editor/editor.js`

### Steps

- [ ] **Step 3.1: Create `buildLayerRow` function**

Add near the layers panel DOM creation code:

```javascript
function buildLayerRow(el, depth) {
  if (!el || SKIP.has(el.tagName) || isEditorEl(el)) return null;
  var r = el.getBoundingClientRect();
  if (r.width < 2 && r.height < 2) return null;

  var tag = el.tagName.toLowerCase();
  var isWrapper = isUselessWrapper(el);
  var hasVisibleChildren = false;
  for (var i = 0; i < el.children.length; i++) {
    var ch = el.children[i];
    if (!SKIP.has(ch.tagName) && !isEditorEl(ch)) {
      var cr = ch.getBoundingClientRect();
      if (cr.width >= 2 || cr.height >= 2) { hasVisibleChildren = true; break; }
    }
  }

  // Container for this node + its children
  var container = mk('div');
  container.setAttribute('data-rb-layer-el', '');

  // The row itself
  var row = mk('div', 'rb-layer-row');
  row.style.setProperty('--rb-layer-depth', depth);
  if (isWrapper) row.classList.add('rb-layer-wrapper');

  // Chevron or placeholder
  if (hasVisibleChildren) {
    var chev = mk('div', 'rb-layer-chev');
    chev.innerHTML = '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 1l4 3-4 3"/></svg>';
    chev.addEventListener('click', function(e) {
      e.stopPropagation();
      var childContainer = container.querySelector('.rb-layer-children');
      if (!childContainer) return;
      var isOpen = childContainer.classList.contains('rb-layer-expanded');
      if (!isOpen) {
        // Lazy render children on first expand
        if (childContainer.children.length === 0) {
          renderLayerChildren(el, childContainer, depth + 1);
        }
        childContainer.classList.add('rb-layer-expanded');
        chev.classList.add('rb-layer-open');
      } else {
        childContainer.classList.remove('rb-layer-expanded');
        chev.classList.remove('rb-layer-open');
      }
    });
    row.appendChild(chev);
  } else {
    var placeholder = mk('div', 'rb-layer-chev-placeholder');
    row.appendChild(placeholder);
  }

  // Tag color icon
  var icon = mk('div', 'rb-layer-icon');
  icon.setAttribute('data-tag', tag);
  row.appendChild(icon);

  // Label: tag + first class, or text preview for text-only leaves
  var label = mk('span', 'rb-layer-label');
  var clsName = '';
  if (el.className && typeof el.className === 'string') {
    var firstCls = el.className.split(' ').filter(function(c) {
      return c.indexOf('rb-') === -1 && c.length < 30;
    })[0];
    if (firstCls) clsName = '.' + firstCls;
  }
  if (!hasVisibleChildren && isText(el)) {
    var txt = (el.innerText || '').trim();
    if (txt.length > 30) txt = txt.substring(0, 30) + '...';
    label.textContent = txt || tag + clsName;
  } else {
    label.textContent = tag + clsName;
  }
  row.appendChild(label);

  // Hover → highlight element on page
  row.addEventListener('mouseenter', function() {
    if (el !== selectedEl) updateHoverBox(el);
  });
  row.addEventListener('mouseleave', function() {
    hoverBox.style.display = 'none';
  });

  // Click → select element
  row.addEventListener('click', function(e) {
    e.stopPropagation();
    selectEl(el);
    selectionDepth = depth;
    selectionAncestor = null;
    syncLayersSelection(el);
  });

  // Store reference for sync
  row._rbEl = el;
  container.appendChild(row);

  // Children container (populated lazily)
  if (hasVisibleChildren) {
    var childContainer = mk('div', 'rb-layer-children');
    container.appendChild(childContainer);
  }

  return container;
}
```

- [ ] **Step 3.2: Create `renderLayerChildren` function**

```javascript
function renderLayerChildren(parentEl, container, depth) {
  var maxChildren = 50; // Safety limit
  var count = 0;
  for (var i = 0; i < parentEl.children.length && count < maxChildren; i++) {
    var child = parentEl.children[i];
    var rowContainer = buildLayerRow(child, depth);
    if (rowContainer) {
      container.appendChild(rowContainer);
      count++;
    }
  }
}
```

- [ ] **Step 3.3: Create `populateLayers` function**

This is called once when the editor activates, rendering only the top level:

```javascript
function populateLayers() {
  layersBody.innerHTML = '';
  var bodyEl = document.body;
  renderLayerChildren(bodyEl, layersBody, 0);
}
```

Call `populateLayers()` right after `showGlobalCSS()` in `buildInspector` (line ~927):

```javascript
showGlobalCSS();
populateLayers();  // ADD
```

- [ ] **Step 3.4: Test lazy tree**

Load extension. Left panel should show top-level body children (header, main, footer, etc.) as collapsible rows. Click chevrons to expand. Hover a row to see blue highlight on the page.

- [ ] **Step 3.5: Commit**

```bash
git add editor/editor.js
git commit -m "feat: layers panel — lazy DOM tree with hover highlighting"
```

---

## Task 4: Bidirectional Selection Sync

**Files:**
- Modify: `editor/editor.js`

### Steps

- [ ] **Step 4.1: Create `syncLayersSelection` function**

This highlights the matching row in the layers panel and auto-expands parents:

```javascript
function syncLayersSelection(el) {
  // Remove old selection highlight
  var oldSel = layersBody.querySelectorAll('.rb-layer-selected');
  oldSel.forEach(function(r) { r.classList.remove('rb-layer-selected'); });

  if (!el) return;

  // Build the ancestor chain from body to el
  var chain = [];
  var walk = el;
  while (walk && walk !== document.body) {
    chain.unshift(walk);
    walk = walk.parentElement;
  }

  // Walk the layers tree, expanding each level
  var currentContainer = layersBody;
  for (var i = 0; i < chain.length; i++) {
    var target = chain[i];
    var found = false;

    // Find the matching row in currentContainer
    var rowContainers = currentContainer.children;
    for (var j = 0; j < rowContainers.length; j++) {
      var rc = rowContainers[j];
      var row = rc.querySelector('.rb-layer-row');
      if (!row || row._rbEl !== target) continue;

      // Found the matching row
      found = true;

      if (i === chain.length - 1) {
        // This is our target — highlight it
        row.classList.add('rb-layer-selected');
        // Scroll into view
        row.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      } else {
        // This is an ancestor — expand it
        var chev = row.querySelector('.rb-layer-chev');
        var childContainer = rc.querySelector('.rb-layer-children');
        if (childContainer) {
          if (childContainer.children.length === 0) {
            renderLayerChildren(target, childContainer, i + 1);
          }
          childContainer.classList.add('rb-layer-expanded');
          if (chev) chev.classList.add('rb-layer-open');
          currentContainer = childContainer;
        }
      }
      break;
    }

    if (!found) {
      // Row doesn't exist yet — this can happen if tree wasn't fully built
      // Force-render the missing level
      if (i > 0) {
        var parentInChain = chain[i - 1];
        // currentContainer should have been set to the children container of parentInChain
        var rowContainer = buildLayerRow(target, i);
        if (rowContainer) {
          currentContainer.appendChild(rowContainer);
          var row = rowContainer.querySelector('.rb-layer-row');
          if (i === chain.length - 1) {
            row.classList.add('rb-layer-selected');
            row.scrollIntoView({block: 'nearest', behavior: 'smooth'});
          } else {
            var childContainer = rowContainer.querySelector('.rb-layer-children');
            if (childContainer) {
              if (childContainer.children.length === 0) {
                renderLayerChildren(target, childContainer, i + 1);
              }
              childContainer.classList.add('rb-layer-expanded');
              var chev = row.querySelector('.rb-layer-chev');
              if (chev) chev.classList.add('rb-layer-open');
              currentContainer = childContainer;
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4.2: Wire `syncLayersSelection` into `selectEl`**

In `selectEl` (line ~1978), add the sync call at the end:

```javascript
function selectEl(el) {
  if (selectedEl && selectedEl !== el) {
    selectedEl.contentEditable = 'false';
    selectedEl.removeAttribute('data-rb-editing');
    selectedEl.classList.remove('rb-ed-movable');
    isTextEditing = false;
  }

  selectedEl = el;
  updateSelBox(el);
  updateParentBox(el);
  updateInspector(el);
  updateSpacingGuides(el);

  el.classList.add('rb-ed-movable');

  var box = getBox(el);
  if (isText(el)) {
    showFtue('dblclick', 'Double-click to edit text', box.left, box.top);
  }
  showFtue('undo', 'Press <kbd>' + modKey + '+Z</kbd> to undo', box.left, box.top - 24);

  syncLayersSelection(el);  // ADD
}
```

- [ ] **Step 4.3: Test bidirectional sync**

1. Click an element on the page → layers panel should auto-expand to that element and highlight its row.
2. Click a row in layers panel → element should get selected on the page with blue box + inspector updating.
3. Click a chevron → children rows appear. Hover a child row → blue hover box appears on that element.

- [ ] **Step 4.4: Commit**

```bash
git add editor/editor.js
git commit -m "feat: layers panel — bidirectional selection sync with auto-expand"
```

---

## Task 5: Breadcrumb Depth Indicator

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/editor.css`

### Steps

- [ ] **Step 5.1: Add breadcrumb CSS**

```css
/* ===== DEPTH BREADCRUMB ===== */
.rb-ed-breadcrumb {
  display:flex; align-items:center; gap:2px;
  padding:4px 14px 8px; flex-wrap:wrap;
}
.rb-ed-crumb {
  font:400 9px/1 'Instrument Sans',sans-serif;
  color:rgba(239,238,235,0.3);
  cursor:pointer; padding:2px 4px; border-radius:3px;
  transition:background 80ms, color 80ms;
}
.rb-ed-crumb:hover { background:rgba(255,255,255,0.06); color:#EFEEEB; }
.rb-ed-crumb.rb-ed-crumb-active { color:#EFEEEB; font-weight:500; }
.rb-ed-crumb-sep {
  font:400 9px/1 'Instrument Sans',sans-serif;
  color:rgba(239,238,235,0.15);
}
```

- [ ] **Step 5.2: Add breadcrumb to inspector header**

In `updateInspector`, before the first section, add a breadcrumb showing the element's path from body:

```javascript
// At the top of updateInspector, after inspBody.innerHTML = '':
var breadcrumb = mk('div', 'rb-ed-breadcrumb');
var chain = [];
var walk = el;
while (walk && walk !== document.body && chain.length < 6) {
  chain.unshift(walk);
  walk = walk.parentElement;
}
chain.forEach(function(ancestor, i) {
  if (i > 0) {
    var sep = mk('span', 'rb-ed-crumb-sep');
    sep.textContent = '>';
    breadcrumb.appendChild(sep);
  }
  var crumb = mk('span', 'rb-ed-crumb');
  var tag = ancestor.tagName.toLowerCase();
  var cls = '';
  if (ancestor.className && typeof ancestor.className === 'string') {
    var first = ancestor.className.split(' ').filter(function(c) {
      return c.indexOf('rb-') === -1 && c.length < 20;
    })[0];
    if (first) cls = '.' + first;
  }
  crumb.textContent = tag + cls;
  if (ancestor === el) crumb.classList.add('rb-ed-crumb-active');
  crumb.addEventListener('click', function() {
    selectEl(ancestor);
  });
  breadcrumb.appendChild(crumb);
});
inspBody.appendChild(breadcrumb);
```

- [ ] **Step 5.3: Test breadcrumb**

Select a deeply nested element (e.g. drill 3 levels into a card). Inspector should show a breadcrumb path like `section.hero > div.container > div.card` where clicking any ancestor selects it.

- [ ] **Step 5.4: Commit**

```bash
git add editor/editor.js editor/editor.css
git commit -m "feat: breadcrumb depth indicator in inspector header"
```

---

## Task 6: Escape Key to Go Up a Level

**Files:**
- Modify: `editor/editor.js`

### Steps

- [ ] **Step 6.1: Add Escape key handler for depth navigation**

Find the existing keydown handler (search for `addEventListener('keydown'`). Add this case:

```javascript
// Inside the keydown handler, add a check for Escape:
if (e.key === 'Escape') {
  if (isTextEditing) {
    exitTextEdit();
    return;
  }
  if (selectedEl && selectionDepth > 0) {
    // Go up one level
    var parent = selectedEl.parentElement;
    if (parent && parent !== document.body && isValid(parent)) {
      selectionDepth--;
      selectEl(parent);
      syncLayersSelection(parent);
    }
    return;
  }
  if (selectedEl) {
    deselectEl();
    return;
  }
}
```

Note: Check the existing Escape handling first. If there's already an Escape case for `exitTextEdit`, integrate the depth navigation into it rather than duplicating.

- [ ] **Step 6.2: Test escape navigation**

Drill 3 levels deep into a section. Press Escape — should go up to parent. Press again — grandparent. Press again — deselect completely.

- [ ] **Step 6.3: Commit**

```bash
git add editor/editor.js
git commit -m "feat: Escape key navigates up through selection depth"
```

---

## Task 7: Cleanup and Polish

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/editor.css`

### Steps

- [ ] **Step 7.1: Add layers panel cleanup to deactivation**

Find the deactivation/cleanup function (the function that removes the editor when the user closes it). Add:

```javascript
// In the cleanup/deactivation function:
if (layersPanel && layersPanel.parentElement) {
  layersPanel.parentElement.removeChild(layersPanel);
}
```

- [ ] **Step 7.2: Handle window resize — update layers panel max-height**

The layers panel inherits `max-height:calc(100vh - 52px)` from CSS, which auto-adjusts. No JS needed. Verify this works by resizing the browser window.

- [ ] **Step 7.3: Add keyboard shortcut to toggle layers panel**

In the keydown handler, add:

```javascript
// Alt+L or Opt+L toggles layers panel visibility
if (e.altKey && e.key === 'l') {
  e.preventDefault();
  layersPanel.style.display = layersPanel.style.display === 'none' ? '' : 'none';
}
```

- [ ] **Step 7.4: Final integration test**

Full workflow test:
1. Open editor on a complex site (e.g. stripe.com, apple.com)
2. Layers panel shows body children on the left
3. Click header in layers → selects it on canvas
4. Click header on canvas → layers auto-expands and highlights
5. Click again on same area → drills into nav/logo
6. Escape → goes back up to header
7. Expand layers tree manually → hover shows highlights
8. Breadcrumb in inspector reflects current depth path
9. Click breadcrumb ancestor → selects it, layers syncs
10. Close editor → layers panel removed cleanly

- [ ] **Step 7.5: Commit**

```bash
git add editor/editor.js editor/editor.css
git commit -m "feat: layers panel polish — cleanup, toggle shortcut, integration tested"
```

---

## Summary

| Task | What it does | Estimated complexity |
|---|---|---|
| Task 1 | Click-depth selection system | Core mechanic — rewrites mousedown handler |
| Task 2 | Layers panel shell + CSS | DOM creation, visual styling |
| Task 3 | Lazy DOM tree rendering | `buildLayerRow`, `renderLayerChildren`, `populateLayers` |
| Task 4 | Bidirectional selection sync | `syncLayersSelection` — auto-expand + highlight |
| Task 5 | Breadcrumb depth indicator | Path display in inspector header |
| Task 6 | Escape key depth navigation | Go up one level per press |
| Task 7 | Cleanup and polish | Deactivation, toggle shortcut, integration test |
