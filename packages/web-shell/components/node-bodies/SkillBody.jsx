'use client';

const FileGlyph = () => (
  <svg viewBox="0 0 64 80" width="64" height="80" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4h28l16 16v52a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" />
    <path d="M40 4v16h16" />
    <path d="M20 38h24M20 48h24M20 58h16" />
  </svg>
);

export default function SkillBody({ node }) {
  const name = node.meta?.name || node.meta?.title || 'skill';
  return (
    <div className="cnode-skill-body">
      <div className="cnode-skill-glyph" aria-hidden="true">
        <FileGlyph />
      </div>
      <div className="cnode-skill-title" title={name}>{name}</div>
    </div>
  );
}
