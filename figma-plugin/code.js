// EzPrompter Figma Plugin - Main Code
// Receives captured website layouts and recreates them as Figma frames.

const MAX_DEPTH = 15;
const DEFAULT_FONT = { family: "Inter", style: "Regular" };
const BOLD_FONT = { family: "Inter", style: "Bold" };

// Named colors lookup
const NAMED_COLORS = {
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0, g: 0, b: 0 },
  red: { r: 1, g: 0, b: 0 },
  green: { r: 0, g: 0.502, b: 0 },
  blue: { r: 0, g: 0, b: 1 },
  transparent: null,
  yellow: { r: 1, g: 1, b: 0 },
  orange: { r: 1, g: 0.647, b: 0 },
  purple: { r: 0.502, g: 0, b: 0.502 },
  pink: { r: 1, g: 0.753, b: 0.796 },
  gray: { r: 0.502, g: 0.502, b: 0.502 },
  grey: { r: 0.502, g: 0.502, b: 0.502 },
};

// ─── Color Parsing ───────────────────────────────────────────────

function parseColor(cssColor) {
  if (!cssColor || cssColor === 'none' || cssColor === 'initial' || cssColor === 'inherit') {
    return null;
  }

  cssColor = cssColor.trim().toLowerCase();

  // Named colors
  if (NAMED_COLORS.hasOwnProperty(cssColor)) {
    const c = NAMED_COLORS[cssColor];
    if (!c) return null; // transparent
    return { color: { r: c.r, g: c.g, b: c.b }, opacity: 1 };
  }

  // rgba(r, g, b, a)
  const rgbaMatch = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      color: {
        r: parseInt(rgbaMatch[1]) / 255,
        g: parseInt(rgbaMatch[2]) / 255,
        b: parseInt(rgbaMatch[3]) / 255,
      },
      opacity: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Hex colors
  const hexMatch = cssColor.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    return { color: { r, g, b }, opacity: a };
  }

  return null;
}

// ─── Shadow Parsing ──────────────────────────────────────────────

function parseShadow(cssShadow) {
  if (!cssShadow || cssShadow === 'none') return null;

  // Handle multiple shadows - take first one
  const shadowStr = cssShadow.split(/,(?![^(]*\))/).map(s => s.trim())[0];
  if (!shadowStr) return null;

  const isInset = shadowStr.includes('inset');
  const cleaned = shadowStr.replace('inset', '').trim();

  // Extract color first (rgb/rgba/hex/named)
  let color = null;
  let remaining = cleaned;

  const rgbaColorMatch = cleaned.match(/rgba?\([^)]+\)/);
  if (rgbaColorMatch) {
    color = parseColor(rgbaColorMatch[0]);
    remaining = cleaned.replace(rgbaColorMatch[0], '').trim();
  } else {
    const hexColorMatch = cleaned.match(/#[0-9a-fA-F]{3,8}/);
    if (hexColorMatch) {
      color = parseColor(hexColorMatch[0]);
      remaining = cleaned.replace(hexColorMatch[0], '').trim();
    }
  }

  // Parse numeric values (offsetX, offsetY, blur, spread)
  const values = remaining.match(/-?[\d.]+px/g);
  if (!values || values.length < 2) return null;

  const nums = values.map(v => parseFloat(v));
  const offsetX = nums[0] || 0;
  const offsetY = nums[1] || 0;
  const blur = nums[2] || 0;
  const spread = nums[3] || 0;

  if (!color) {
    color = { color: { r: 0, g: 0, b: 0 }, opacity: 0.25 };
  }

  return {
    type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color: { r: color.color.r, g: color.color.g, b: color.color.b, a: color.opacity },
    offset: { x: offsetX, y: offsetY },
    radius: blur,
    spread: spread,
    visible: true,
    blendMode: 'NORMAL',
  };
}

// ─── Gradient Parsing ────────────────────────────────────────────

function parseGradient(bgImage) {
  if (!bgImage || bgImage === 'none') return null;

  const linearMatch = bgImage.match(/linear-gradient\((.+)\)/);
  if (!linearMatch) return null;

  const content = linearMatch[1];

  // Parse angle
  let angle = 180; // default top to bottom
  const angleMatch = content.match(/^(\d+)deg/);
  if (angleMatch) {
    angle = parseFloat(angleMatch[1]);
  } else if (content.startsWith('to ')) {
    const dirMatch = content.match(/to\s+(top|bottom|left|right)/);
    if (dirMatch) {
      const dirMap = { top: 0, right: 90, bottom: 180, left: 270 };
      angle = dirMap[dirMatch[1]] || 180;
    }
  }

  // Parse color stops
  const stopRegex = /(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|\w+)\s*(\d+%)?/g;
  const stops = [];
  let match;
  // Skip the angle/direction part
  const colorPart = content.replace(/^(\d+deg|to\s+\w+)\s*,\s*/, '');
  while ((match = stopRegex.exec(colorPart)) !== null) {
    const parsed = parseColor(match[1]);
    if (parsed) {
      stops.push({
        color: { r: parsed.color.r, g: parsed.color.g, b: parsed.color.b, a: parsed.opacity },
        position: match[2] ? parseFloat(match[2]) / 100 : null,
      });
    }
  }

  if (stops.length < 2) return null;

  // Assign positions if missing
  stops.forEach((stop, i) => {
    if (stop.position === null) {
      stop.position = i / (stops.length - 1);
    }
  });

  // Convert angle to Figma gradient transform
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [
      [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
      [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
    ],
    gradientStops: stops.map(s => ({
      position: s.position,
      color: s.color,
    })),
  };
}

// ─── Border Parsing ──────────────────────────────────────────────

function parseBorder(cssBorder) {
  if (!cssBorder || cssBorder === 'none' || cssBorder === '0px none') return null;

  const match = cssBorder.match(/([\d.]+)px\s+(\w+)\s+(.*)/);
  if (!match) return null;

  const width = parseFloat(match[1]);
  if (width <= 0) return null;

  const color = parseColor(match[3]);
  if (!color) return null;

  return { width, color };
}

// ─── Parse numeric CSS value ─────────────────────────────────────

function parsePx(value) {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// ─── Font style mapping ─────────────────────────────────────────

function getFontStyle(weight, style) {
  const w = parseInt(weight) || 400;
  const isItalic = style === 'italic';

  let styleName = 'Regular';
  if (w <= 100) styleName = 'Thin';
  else if (w <= 200) styleName = 'Extra Light';
  else if (w <= 300) styleName = 'Light';
  else if (w <= 400) styleName = 'Regular';
  else if (w <= 500) styleName = 'Medium';
  else if (w <= 600) styleName = 'Semi Bold';
  else if (w <= 700) styleName = 'Bold';
  else if (w <= 800) styleName = 'Extra Bold';
  else styleName = 'Black';

  if (isItalic) styleName += ' Italic';

  return styleName;
}

// ─── Node Name ───────────────────────────────────────────────────

function getNodeName(node) {
  if (node.name) return node.name;
  const tag = node.tag || 'div';
  const cls = node.className
    ? '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.')
    : '';
  return `${tag}${cls}`;
}

// ─── Check if node is text-only ──────────────────────────────────

function isTextNode(node) {
  if (node.nodeType === 'TEXT') return true;
  const text = node.text || node.textContent;
  if (text && (!node.children || node.children.length === 0)) return true;
  if (node.children && node.children.length > 0 && node.children.every(c => c.nodeType === 'TEXT')) {
    return true;
  }
  return false;
}

function getTextContent(node) {
  if (node.text) return node.text;
  if (node.textContent) return node.textContent;
  if (node.children) {
    return node.children
      .filter(c => c.nodeType === 'TEXT')
      .map(c => c.text || c.textContent || '')
      .join('');
  }
  return '';
}

// ─── Should skip node ────────────────────────────────────────────

function shouldSkip(node) {
  const styles = node.styles || {};
  if (styles.display === 'none') return true;
  if (styles.visibility === 'hidden') return true;

  const rawRect = node.rect || node.boundingRect || {};
  const w = rawRect.width || rawRect.w || 0;
  const h = rawRect.height || rawRect.h || 0;
  if (w <= 0 && h <= 0) return true;

  return false;
}

// ─── Apply common styles to a Figma node ─────────────────────────

function applyStyles(figmaNode, styles, rect) {
  if (!styles) return;

  // Dimensions (clamp min 1x1)
  const w = Math.max(1, rect.width || 1);
  const h = Math.max(1, rect.height || 1);
  figmaNode.resize(w, h);

  // Position (relative to parent)
  const x = rect.x || 0;
  const y = rect.y || 0;
  figmaNode.x = x;
  figmaNode.y = y;

  // Background color
  if (styles.backgroundColor) {
    const bg = parseColor(styles.backgroundColor);
    if (bg) {
      figmaNode.fills = [{ type: 'SOLID', color: bg.color, opacity: bg.opacity }];
    }
  }

  // Background gradient
  if (styles.backgroundImage && styles.backgroundImage !== 'none') {
    const grad = parseGradient(styles.backgroundImage);
    if (grad) {
      figmaNode.fills = [grad];
    }
  }

  // Border radius
  if (styles.borderRadius) {
    const radius = parsePx(styles.borderRadius);
    if (radius > 0 && figmaNode.cornerRadius !== undefined) {
      figmaNode.cornerRadius = radius;
    }
  }

  // Border / strokes
  if (styles.border) {
    const border = parseBorder(styles.border);
    if (border) {
      figmaNode.strokes = [{ type: 'SOLID', color: border.color.color, opacity: border.color.opacity }];
      figmaNode.strokeWeight = border.width;
    }
  }

  // Opacity
  if (styles.opacity !== undefined && styles.opacity !== '1' && styles.opacity !== 1) {
    const op = parseFloat(styles.opacity);
    if (!isNaN(op)) figmaNode.opacity = op;
  }

  // Box shadow
  if (styles.boxShadow && styles.boxShadow !== 'none') {
    const shadow = parseShadow(styles.boxShadow);
    if (shadow) {
      figmaNode.effects = [shadow];
    }
  }

  // Auto-layout (flex)
  if (styles.display === 'flex' || styles.display === 'inline-flex') {
    if (figmaNode.type === 'FRAME') {
      figmaNode.layoutMode = styles.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL';
      figmaNode.primaryAxisSizingMode = 'FIXED';
      figmaNode.counterAxisSizingMode = 'FIXED';

      // Gap
      if (styles.gap) {
        const gap = parsePx(styles.gap);
        if (gap > 0) figmaNode.itemSpacing = gap;
      }

      // Padding
      if (styles.paddingTop) figmaNode.paddingTop = parsePx(styles.paddingTop);
      if (styles.paddingBottom) figmaNode.paddingBottom = parsePx(styles.paddingBottom);
      if (styles.paddingLeft) figmaNode.paddingLeft = parsePx(styles.paddingLeft);
      if (styles.paddingRight) figmaNode.paddingRight = parsePx(styles.paddingRight);

      // Shorthand padding
      if (styles.padding && !styles.paddingTop) {
        const pad = parsePx(styles.padding);
        figmaNode.paddingTop = pad;
        figmaNode.paddingBottom = pad;
        figmaNode.paddingLeft = pad;
        figmaNode.paddingRight = pad;
      }

      // Alignment
      if (styles.alignItems) {
        const alignMap = {
          'flex-start': 'MIN',
          'start': 'MIN',
          'center': 'CENTER',
          'flex-end': 'MAX',
          'end': 'MAX',
          'stretch': 'STRETCH',
        };
        if (alignMap[styles.alignItems]) {
          figmaNode.counterAxisAlignItems = alignMap[styles.alignItems];
        }
      }

      if (styles.justifyContent) {
        const justifyMap = {
          'flex-start': 'MIN',
          'start': 'MIN',
          'center': 'CENTER',
          'flex-end': 'MAX',
          'end': 'MAX',
          'space-between': 'SPACE_BETWEEN',
        };
        if (justifyMap[styles.justifyContent]) {
          figmaNode.primaryAxisAlignItems = justifyMap[styles.justifyContent];
        }
      }
    }
  }
}

// ─── Build Figma tree recursively ────────────────────────────────

let nodeCount = 0;

async function buildNode(domNode, parentFigmaNode, depth, parentRect) {
  if (depth > MAX_DEPTH) return;
  if (shouldSkip(domNode)) return;

  const rawRect = domNode.rect || domNode.boundingRect || { x: 0, y: 0, w: 100, h: 30 };
  const rect = {
    x: rawRect.x || 0,
    y: rawRect.y || 0,
    width: rawRect.width || rawRect.w || 0,
    height: rawRect.height || rawRect.h || 0
  };
  const styles = domNode.styles || {};
  const tag = (domNode.tag || '').toLowerCase();

  // Calculate position relative to parent
  const relativeRect = {
    x: (rect.x || 0) - (parentRect.x || 0),
    y: (rect.y || 0) - (parentRect.y || 0),
    width: rect.width || 0,
    height: rect.height || 0,
  };

  // ─── Image elements ──────────────────────────
  if (tag === 'img' || tag === 'svg' || tag === 'picture') {
    const imgRect = figma.createRectangle();
    imgRect.name = getNodeName(domNode);
    imgRect.resize(Math.max(1, relativeRect.width), Math.max(1, relativeRect.height));
    imgRect.x = relativeRect.x;
    imgRect.y = relativeRect.y;
    imgRect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.9 }, opacity: 1 }];

    if (styles.borderRadius) {
      const radius = parsePx(styles.borderRadius);
      if (radius > 0) imgRect.cornerRadius = radius;
    }
    if (styles.opacity) {
      const op = parseFloat(styles.opacity);
      if (!isNaN(op) && op < 1) imgRect.opacity = op;
    }

    parentFigmaNode.appendChild(imgRect);
    nodeCount++;
    return;
  }

  // ─── Text nodes ──────────────────────────────
  if (isTextNode(domNode)) {
    const text = getTextContent(domNode);
    if (!text || !text.trim()) return;

    const textNode = figma.createText();
    textNode.name = getNodeName(domNode) || 'text';

    // Determine font
    const fontFamily = (styles.fontFamily || 'Inter').split(',')[0].trim().replace(/['"]/g, '');
    const fontWeight = styles.fontWeight || '400';
    const fontStyle = styles.fontStyle || 'normal';
    const styleName = getFontStyle(fontWeight, fontStyle);

    // Try to load the requested font, fall back to Inter
    try {
      await figma.loadFontAsync({ family: fontFamily, style: styleName });
      textNode.fontName = { family: fontFamily, style: styleName };
    } catch (e) {
      try {
        await figma.loadFontAsync({ family: "Inter", style: styleName });
        textNode.fontName = { family: "Inter", style: styleName };
      } catch (e2) {
        await figma.loadFontAsync(DEFAULT_FONT);
        textNode.fontName = DEFAULT_FONT;
      }
    }

    textNode.characters = text;

    // Font size
    if (styles.fontSize) {
      const size = parsePx(styles.fontSize);
      if (size > 0) textNode.fontSize = size;
    }

    // Line height
    if (styles.lineHeight && styles.lineHeight !== 'normal') {
      const lh = parsePx(styles.lineHeight);
      if (lh > 0) textNode.lineHeight = { value: lh, unit: 'PIXELS' };
    }

    // Letter spacing
    if (styles.letterSpacing && styles.letterSpacing !== 'normal') {
      const ls = parsePx(styles.letterSpacing);
      textNode.letterSpacing = { value: ls, unit: 'PIXELS' };
    }

    // Text color
    if (styles.color) {
      const tc = parseColor(styles.color);
      if (tc) {
        textNode.fills = [{ type: 'SOLID', color: tc.color, opacity: tc.opacity }];
      }
    }

    // Text alignment
    if (styles.textAlign) {
      const alignMap = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };
      if (alignMap[styles.textAlign]) {
        textNode.textAlignHorizontal = alignMap[styles.textAlign];
      }
    }

    // Text decoration
    if (styles.textDecoration) {
      if (styles.textDecoration.includes('underline')) textNode.textDecoration = 'UNDERLINE';
      else if (styles.textDecoration.includes('line-through')) textNode.textDecoration = 'STRIKETHROUGH';
    }

    // Position and size
    textNode.x = relativeRect.x;
    textNode.y = relativeRect.y;
    if (relativeRect.width > 0) {
      textNode.resize(Math.max(1, relativeRect.width), Math.max(1, relativeRect.height));
      textNode.textAutoResize = 'HEIGHT';
    }

    parentFigmaNode.appendChild(textNode);
    nodeCount++;
    return;
  }

  // ─── Container elements (frames) ─────────────
  const frame = figma.createFrame();
  frame.name = getNodeName(domNode);
  frame.clipsContent = true;

  // Default: no fills (transparent)
  frame.fills = [];

  applyStyles(frame, styles, relativeRect);

  parentFigmaNode.appendChild(frame);
  nodeCount++;

  // Recurse into children
  if (domNode.children && domNode.children.length > 0) {
    for (const child of domNode.children) {
      await buildNode(child, frame, depth + 1, rect);
    }
  }
}

// ─── Main build function ─────────────────────────────────────────

async function buildFigmaTree(captureData) {
  nodeCount = 0;

  const viewport = captureData.viewport || { width: 1440, height: 900 };
  const domTree = captureData.tree || captureData.domTree;

  if (!domTree) {
    throw new Error('No DOM tree found in capture data');
  }

  // Create top-level frame
  const mainFrame = figma.createFrame();
  mainFrame.name = `Layout - ${captureData.url || 'Captured Page'}`;
  mainFrame.resize(viewport.width, viewport.height);
  mainFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  mainFrame.clipsContent = true;
  nodeCount++;

  figma.ui.postMessage({ type: 'build-progress', message: 'Building DOM tree...' });

  // Build the tree
  const rawRoot = domTree.rect || domTree.boundingRect || {};
  const rootRect = {
    x: rawRoot.x || 0,
    y: rawRoot.y || 0,
    width: rawRoot.width || rawRoot.w || viewport.width,
    height: rawRoot.height || rawRoot.h || viewport.height
  };

  if (domTree.children && domTree.children.length > 0) {
    for (const child of domTree.children) {
      await buildNode(child, mainFrame, 1, rootRect);
    }
  }

  // Apply root styles to main frame
  if (domTree.styles) {
    if (domTree.styles.backgroundColor) {
      const bg = parseColor(domTree.styles.backgroundColor);
      if (bg) {
        mainFrame.fills = [{ type: 'SOLID', color: bg.color, opacity: bg.opacity }];
      }
    }
  }

  // ─── Screenshot reference frame ────────────────
  if (captureData.screenshot) {
    figma.ui.postMessage({ type: 'build-progress', message: 'Placing screenshot reference...' });

    try {
      const screenshotFrame = figma.createFrame();
      screenshotFrame.name = `Screenshot - ${captureData.url || 'Reference'}`;
      screenshotFrame.resize(viewport.width, viewport.height);
      screenshotFrame.x = viewport.width + 100; // Place next to layout
      screenshotFrame.y = 0;

      // Decode base64 screenshot
      const base64 = captureData.screenshot.replace(/^data:image\/\w+;base64,/, '');
      const bytes = figma.base64Decode(base64);
      const image = figma.createImage(bytes);

      screenshotFrame.fills = [{
        type: 'IMAGE',
        imageHash: image.hash,
        scaleMode: 'FILL',
      }];

      nodeCount++;
    } catch (e) {
      console.error('Failed to place screenshot:', e);
    }
  }

  // Zoom to fit
  figma.viewport.scrollAndZoomIntoView(figma.currentPage.children);

  return { nodeCount, width: viewport.width, height: viewport.height };
}

// ─── Plugin entry point ──────────────────────────────────────────

figma.showUI(__html__, { width: 320, height: 400 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import-capture') {
    try {
      figma.ui.postMessage({ type: 'build-progress', message: 'Starting layout build...' });

      const result = await buildFigmaTree(msg.data);

      figma.ui.postMessage({
        type: 'build-complete',
        nodeCount: result.nodeCount,
        width: result.width,
        height: result.height,
      });

      figma.notify(`Layout imported: ${result.nodeCount} nodes created`);
    } catch (err) {
      figma.ui.postMessage({
        type: 'build-error',
        error: err.message || String(err),
      });
      figma.notify('Error building layout: ' + (err.message || err), { error: true });
    }
  }
};
