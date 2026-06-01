'use client';

export default function SoftPauseChip({ iterationsSoFar, breakdown, onContinue, onStop }) {
  const breakdownEntries = Object.entries(breakdown || {})
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="soft-pause-chip">
      <div className="soft-pause-line">
        <span className="soft-pause-icon">⏸</span>
        <span>Did {iterationsSoFar} actions so far. Continue?</span>
      </div>
      {breakdownEntries.length > 0 && (
        <div className="soft-pause-breakdown">
          {breakdownEntries.map(([name, n], i) => (
            <span key={name}>
              {i > 0 && ', '}
              {name} × {n}
            </span>
          ))}
        </div>
      )}
      <div className="soft-pause-actions">
        <button type="button" className="soft-pause-btn soft-pause-continue" onClick={onContinue}>Continue</button>
        <button type="button" className="soft-pause-btn soft-pause-stop" onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}
