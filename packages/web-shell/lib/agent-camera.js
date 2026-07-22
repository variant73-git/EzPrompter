import { clampCanvasScale } from './canvas-view.js';

// Final camera landing for chat-created chains. The graph may assemble over
// several server events, but it is framed once as a single spatial result.
export function frameAgentNodes(nodes, {
  viewportWidth,
  viewportHeight,
  insets = { left: 0, right: 0, top: 0 },
  padding = 160,
} = {}) {
  const valid = (nodes || []).filter((node) => Number.isFinite(node?.pos_x) && Number.isFinite(node?.pos_y));
  if (!valid.length) return null;

  const minX = Math.min(...valid.map((node) => node.pos_x));
  const minY = Math.min(...valid.map((node) => node.pos_y));
  const maxX = Math.max(...valid.map((node) => node.pos_x + (node.width || 1280)));
  const maxY = Math.max(...valid.map((node) => node.pos_y + (node.height || 800)));
  const freeWidth = Math.max(1, viewportWidth - insets.left - insets.right);
  const freeHeight = Math.max(1, viewportHeight - insets.top);
  const scale = clampCanvasScale(Math.min(
    freeWidth / (maxX - minX + padding * 2),
    freeHeight / (maxY - minY + padding * 2),
    1,
  ));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    positionX: insets.left + freeWidth / 2 - centerX * scale,
    positionY: insets.top + freeHeight / 2 - centerY * scale,
    scale,
  };
}
