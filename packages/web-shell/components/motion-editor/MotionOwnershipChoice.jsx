'use client';

import styles from './native-motion-canvas.module.css';

export default function MotionOwnershipChoice({ conflict, onChoose }) {
  if (!conflict || !Array.isArray(conflict.candidates) || !conflict.candidates.length) return null;
  const label = conflict.label || conflict.property || 'this property';
  const unsupported = conflict.status === 'unsupported';
  if (!unsupported && (conflict.status !== 'ambiguous' || conflict.candidates.length < 2)) return null;
  return (
    <section className={styles.ownershipChoice} aria-labelledby="native-motion-ownership-heading">
      <div className={styles.ownershipChoiceCopy}>
        <strong id="native-motion-ownership-heading">
          {unsupported ? `${label} needs a specific motion control` : `Multiple motions control ${label}`}
        </strong>
        <p>
          {unsupported
            ? 'This motion cannot be changed safely with a standard Properties field.'
            : 'Choose the behavior whose final value you want to change.'}
        </p>
      </div>
      <div className={styles.ownershipChannels} role="list">
        {conflict.candidates.map((candidate) => (
          <div key={candidate.channelId} role="listitem">
            {unsupported ? (
              <div className={styles.ownershipUnavailable}>
                <span>{candidate.label}</span>
                <small>{candidate.engine} · Code only</small>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Edit ${candidate.label}`}
                onClick={() => onChoose?.(candidate.channelId)}
              >
                <span>{candidate.label}</span>
                <small>{candidate.engine}</small>
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
