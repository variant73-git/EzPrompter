'use client';

import { useState } from 'react';

function WireframePreview({ pattern }) {
  return (
    <div className={`brainstorm-wireframe brainstorm-wireframe-${pattern}`} aria-hidden="true">
      <span className="brainstorm-wireframe-nav" />
      <span className="brainstorm-wireframe-media" />
      <span className="brainstorm-wireframe-title" />
      <span className="brainstorm-wireframe-copy" />
      <span className="brainstorm-wireframe-action" />
      <span className="brainstorm-wireframe-side" />
    </div>
  );
}

function TypographyPreview({ typeStyle, sample }) {
  return (
    <div className={`brainstorm-type-preview brainstorm-type-${typeStyle}`} aria-hidden="true">
      <span>{sample}</span>
      <i>Headline / body</i>
    </div>
  );
}

function PalettePreview({ colors }) {
  return (
    <div className="brainstorm-palette-preview" aria-hidden="true">
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

function OptionPreview({ kind, option }) {
  if (kind === 'typography') {
    return <TypographyPreview typeStyle={option.typeStyle} sample={option.sample} />;
  }
  if (kind === 'palette') {
    return <PalettePreview colors={option.colors} />;
  }
  return <WireframePreview pattern={option.pattern} />;
}

export default function BrainstormChoiceCards({ visual, onChoose, disabled = false }) {
  const [pendingId, setPendingId] = useState(null);
  const [chosenId, setChosenId] = useState(null);

  if (!visual?.options?.length) return null;

  async function choose(option) {
    if (disabled || pendingId) return;
    setPendingId(option.id);
    try {
      await onChoose?.({ ...option, kind: visual.kind });
      setChosenId(option.id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="brainstorm-choice-grid" data-kind={visual.kind}>
      {visual.options.map((option) => {
        const selected = chosenId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={`brainstorm-choice-card${selected ? ' is-selected' : ''}`}
            aria-label={`Choose ${option.title}`}
            aria-pressed={selected}
            disabled={disabled || Boolean(pendingId)}
            onClick={() => choose(option)}
          >
            <OptionPreview kind={visual.kind} option={option} />
            <span className="brainstorm-choice-title">
              {option.title}
              {selected && <span className="brainstorm-choice-check" aria-hidden="true">✓</span>}
            </span>
            <span className="brainstorm-choice-caption">
              <span>{option.fit}</span>
              <span>{option.signal}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
