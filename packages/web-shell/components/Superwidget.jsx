'use client';

import { useState, useRef } from 'react';

export default function Superwidget({ onAddUrl, onUploadMd, nodeCount }) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState(null);  // 'url' | 'upload' | null
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function submitUrl() {
    if (!/^https?:\/\//i.test(url)) {
      alert('Enter a full http(s) URL.');
      return;
    }
    setBusy(true);
    try {
      await onAddUrl(url);
      setUrl('');
      setTool(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function pickMd() {
    fileRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await onUploadMd(file);
      setTool(null);
      setOpen(false);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  if (!open) {
    return (
      <div className="superwidget" onClick={() => setOpen(true)}>
        <div className="superwidget-collapsed">
          {nodeCount === 0 ? 'Add a site URL or design.md to start your canvas…' : 'Add another node…'}
        </div>
      </div>
    );
  }

  return (
    <div className="superwidget">
      <div className="superwidget-tools">
        <button className="superwidget-tool" onClick={() => setTool('url')}>+ Add URL</button>
        <button className="superwidget-tool" onClick={pickMd}>+ Upload .md</button>
        <button className="superwidget-tool" disabled style={{opacity:0.4,cursor:'not-allowed'}} title="Coming next">+ Template</button>
        <button className="superwidget-tool" disabled style={{opacity:0.4,cursor:'not-allowed'}} title="Coming next">Chat</button>
        <span style={{ flex: 1 }} />
        <button className="superwidget-tool" onClick={() => { setOpen(false); setTool(null); }} style={{background:'transparent',border:'1px solid #2a2a4a'}}>Close</button>
      </div>

      {tool === 'url' && (
        <div className="superwidget-input-row">
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && submitUrl()}
            autoFocus
          />
          <button onClick={submitUrl} disabled={busy}>{busy ? 'Capturing…' : 'Capture →'}</button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
    </div>
  );
}
