'use client';

import { Hand, MousePointer2, Pin, Redo2, StickyNote, Undo2 } from 'lucide-react';

// Compact vertical tool rail. Cursor is always the resting mode; holding
// Space temporarily moves the mode indicator to Hand. The Hand option is
// intentionally informational rather than persistent so the canvas can never
// be left in pan mode by accident.
export default function CanvasTools({ panActive = false, onUndo, canUndo = false }) {
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Canvas tools">
      <div className={`canvas-tool-mode${panActive ? ' pan-active' : ''}`}>
        <div className="canvas-tool-mode-track">
          <span className="canvas-tool-mode-indicator" aria-hidden="true" />
          <button
            type="button"
            className={`canvas-tools-btn canvas-tool-mode-btn${panActive ? '' : ' active'}`}
            title="Cursor"
            aria-label="Cursor"
            aria-pressed={!panActive}
          >
            <MousePointer2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`canvas-tools-btn canvas-tool-mode-btn${panActive ? ' active' : ''}`}
            title="Hold Space to pan"
            aria-label="Pan (hold Space)"
            aria-pressed={panActive}
            aria-disabled="true"
          >
            <Hand aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        type="button"
        className="canvas-tools-btn"
        disabled
        title="Notes coming soon"
        aria-label="Notes (coming soon)"
      >
        <StickyNote aria-hidden="true" />
      </button>
      <button
        type="button"
        className="canvas-tools-btn"
        disabled
        title="Feedback mode coming soon"
        aria-label="Feedback mode (coming soon)"
      >
        <Pin aria-hidden="true" />
      </button>

      <i className="canvas-tools-sep" aria-hidden="true" />
      <button
        type="button"
        className="canvas-tools-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 aria-hidden="true" />
      </button>
      <button
        type="button"
        className="canvas-tools-btn"
        disabled
        title="Redo coming soon"
        aria-label="Redo"
      >
        <Redo2 aria-hidden="true" />
      </button>
    </div>
  );
}
