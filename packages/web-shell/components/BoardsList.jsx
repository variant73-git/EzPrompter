'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/canvas-api.js';

export default function BoardsList({ boards: initial, userName }) {
  const [boards, setBoards] = useState(initial);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function createBoard() {
    setCreating(true);
    try {
      const { board } = await api.createBoard('Untitled');
      router.push(`/canvas/${board.id}`);
    } catch (e) {
      alert(`Could not create board: ${e.message}`);
      setCreating(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  return (
    <div style={{ minHeight: '100vh', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem' }}>Uncraft</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Hello, {userName}</p>
        </div>
        <button onClick={logout} className="btn btn-outline" style={{ width: 'auto', padding: '0.5rem 1rem' }}>
          Sign out
        </button>
      </header>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: 0 }}>Your boards</h2>
        <button onClick={createBoard} disabled={creating} className="btn" style={{ width: 'auto', padding: '0.5rem 1.25rem' }}>
          {creating ? 'Creating…' : '+ New board'}
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="card">
          <p style={{ color: '#94a3b8' }}>No boards yet. Create your first to start the canvas.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {boards.map((b) => (
            <a key={b.id} href={`/canvas/${b.id}`} className="card" style={{ display: 'block', cursor: 'pointer' }}>
              <h3 style={{ color: '#fff', fontSize: '1rem', marginBottom: '0.5rem' }}>{b.name}</h3>
              <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                Updated {new Date(b.updated_at).toLocaleString()}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
