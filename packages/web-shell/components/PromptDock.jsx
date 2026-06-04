'use client';

import { useState, useRef, useEffect, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { normalizeUrl, looksLikeUrl } from '../lib/url.js';
import ChatPanel from './chat/ChatPanel.jsx';

const ICON_PLUS = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14"/><path d="M5 12h14"/>
  </svg>
);

const ICON_GLOBE = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M2 12h20"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const ICON_PIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="17" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
  </svg>
);

const ICON_BRAIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

const ICON_ARROW_UP = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
  </svg>
);

const ICON_X = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const ICON_CHEVRON = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6"/>
  </svg>
);

const ICON_CHECK = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

// Add-menu icons (match the canvas context menu visual language).
const MENU_ICON = {
  Html: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
      <path d="M14 3v5h5"/><path d="m9 14-1.5 2L9 18"/><path d="m13.5 14 1.5 2-1.5 2"/>
    </svg>
  ),
  Md: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.66 0 3-1.34 3-3 0-.78-.29-1.49-.78-2.04-.17-.19-.32-.41-.32-.66 0-.55.45-1 1-1H17c2.76 0 5-2.24 5-5 0-4.98-4.48-9-10-9z"/>
      <circle cx="6.5"  cy="11.5" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="9.5"  cy="7.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="14.5" cy="7.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="17.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  ),
  Image: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="9" cy="10.5" r="1.5"/><path d="m21 16-5-5L5 19"/>
    </svg>
  ),
  Prompt: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h8M8 13h5"/>
    </svg>
  ),
  Skill: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 2.5 5 5.5.8-4 3.9.95 5.5L12 15.6 7.05 18.2 8 12.7 4 8.8 9.5 8z"/>
    </svg>
  ),
  Files: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21H6a2 2 0 0 1-2-2V7"/>
      <path d="M9 17h9a2 2 0 0 0 2-2V6l-4-4H10a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2z"/>
    </svg>
  ),
  Blank: () => (
    // Dashed-corner page — reads as "empty canvas to fill in" rather
    // than a captured/uploaded document. Border weight matches the
    // other menu icons for visual parity.
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeDasharray="3 2.5"/>
      <path d="M9 10h6M9 14h4" opacity="0.55"/>
    </svg>
  )
};

// --- Model picker -----------------------------------------------------------

const PROVIDER_ICON = {
  google: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#EA4335" d="M12 10v3.8h5.4c-.24 1.4-1.7 4.1-5.4 4.1-3.25 0-5.9-2.7-5.9-6s2.65-6 5.9-6c1.85 0 3.1.78 3.8 1.46l2.6-2.5C16.74 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.55 0 9.2-3.9 9.2-9.4 0-.63-.07-1.1-.16-1.6z"/>
      <path fill="#FBBC05" d="M3.7 7.4 6.6 9.5C7.4 7.6 9.5 6.2 12 6.2c1.85 0 3.1.78 3.8 1.46l2.6-2.5C16.74 3.3 14.6 2.4 12 2.4 8.4 2.4 5.3 4.4 3.7 7.4z"/>
      <path fill="#34A853" d="M12 21.6c2.5 0 4.6-.8 6.1-2.2l-2.9-2.4c-.8.55-1.85.9-3.2.9-2.5 0-4.6-1.65-5.35-3.9l-2.9 2.25c1.55 3.1 4.7 5.35 8.25 5.35z"/>
      <path fill="#4285F4" d="M21.2 12.2c0-.63-.07-1.1-.16-1.6H12V14h5.2c-.22.95-.85 2-1.9 2.85l2.9 2.4c1.7-1.6 2.95-3.95 2.95-7.05z"/>
    </svg>
  ),
  kimi: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#1f1f1f" stroke="rgba(255,255,255,0.15)"/>
      <path fill="#a78bfa" d="M9 6.4h1.7v4.2L14.5 6.4h2.05l-3.6 4.05L17 17.6h-2l-2.95-5.05-1.35 1.5v3.55H9z"/>
    </svg>
  ),
  openai: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M22.28 9.82a5.94 5.94 0 0 0-.51-4.91 6 6 0 0 0-6.47-2.88 6 6 0 0 0-4.53-2 6 6 0 0 0-5.7 4.13 5.94 5.94 0 0 0-3.97 2.88 6 6 0 0 0 .74 7.05 5.94 5.94 0 0 0 .51 4.92 6 6 0 0 0 6.47 2.87 6 6 0 0 0 4.53 2 6 6 0 0 0 5.7-4.13 5.94 5.94 0 0 0 3.97-2.88 6 6 0 0 0-.74-7.05zm-9 12.6a4.43 4.43 0 0 1-2.85-1l.14-.08 4.74-2.74a.78.78 0 0 0 .39-.68v-6.69l2 1.16v5.55a4.45 4.45 0 0 1-4.42 4.48zm-9.55-4.07a4.46 4.46 0 0 1-.53-3l.14.08 4.74 2.74a.77.77 0 0 0 .78 0l5.78-3.34v2.31a.07.07 0 0 1 0 .06L9.85 20a4.45 4.45 0 0 1-6.07-1.62zM2.55 9a4.43 4.43 0 0 1 2.32-2L4.86 7v5.48a.78.78 0 0 0 .39.68l5.78 3.34-2 1.16-4.78-2.79A4.45 4.45 0 0 1 2.55 9zm16.5 3.85L13.27 9.5l2-1.15 4.78 2.78a4.45 4.45 0 0 1-.69 8 4.45 4.45 0 0 1-2.31 1V14.6a.79.79 0 0 0-.4-.66zm2-3 -.14-.09-4.74-2.76a.77.77 0 0 0-.78 0L9.6 10.34V8a.07.07 0 0 1 0-.06l4.74-2.74a4.45 4.45 0 0 1 6.61 4.61zM8.51 13.71l-2-1.16V7a4.45 4.45 0 0 1 7.31-3.42l-.14.08-4.74 2.74a.78.78 0 0 0-.39.68zm1.09-2.34 2.59-1.49 2.59 1.49v3l-2.59 1.49-2.59-1.49z"/>
    </svg>
  ),
  anthropic: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M14.27 4h3.42L24 20h-3.42zM6.31 4h3.6L16.3 20h-3.5l-1.3-3.4H4.6L3.3 20H0zm-1 9.27h4.92l-2.46-6.4z"/>
    </svg>
  )
};

const MODEL_OPTIONS = [
  { group: null, items: [
    { id: 'gemini-3.1-pro',  name: 'Gemini 3.1 Pro',  provider: 'google' },
    { id: 'gpt-5.5',         name: 'GPT-5.5',         provider: 'openai' },
    { id: 'claude-4.6-opus', name: 'Claude 4.6 Opus', provider: 'anthropic' },
    { id: 'kimi-k2.6',       name: 'Kimi K2.6',       provider: 'kimi' }
  ]}
];

const ALL_MODELS = MODEL_OPTIONS.flatMap((g) => g.items);
const DEFAULT_MODEL_ID = 'gpt-5.5';
const MODEL_STORAGE_KEY = 'uncraft-model';

function findModel(id) {
  return ALL_MODELS.find((m) => m.id === id) || ALL_MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
}

// Compute fixed-position style for the model menu — anchored to the
// model button's left edge, sitting 8px above its top edge. Width-clamped
// so the menu never spills off the right viewport edge.
function getModelMenuStyle(buttonRef) {
  if (typeof window === 'undefined') return {};
  const r = buttonRef?.current?.getBoundingClientRect();
  if (!r) return { position: 'fixed', left: 8, bottom: 80, right: 'auto', zIndex: 1000 };
  const MENU_W = 260;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
  const bottom = window.innerHeight - r.top + 8;
  return { position: 'fixed', left, bottom, right: 'auto', zIndex: 1000 };
}

// Same pattern for the add (+) menu — when the chat panel expands inside
// the prompt dock, an absolute popover with `bottom: 100%` lands at the
// top of the entire chat block instead of right above the + button.
// Fixed positioning anchored to the button rect keeps the menu glued to
// the button regardless of how tall the dock has grown.
function getAddMenuStyle(buttonRef) {
  if (typeof window === 'undefined') return {};
  const r = buttonRef?.current?.getBoundingClientRect();
  if (!r) return { position: 'fixed', left: 8, bottom: 80, right: 'auto', zIndex: 1000 };
  const MENU_W = 240;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
  const bottom = window.innerHeight - r.top + 8;
  return { position: 'fixed', left, bottom, right: 'auto', zIndex: 1000 };
}

// Convert an attached File into the {kind:'image', dataUrl, name, mimeType}
// shape that /api/chat expects in `attachments`. Reads as base64 data URL so
// the server can hand it directly to the LLM adapter without an intermediate
// upload step. Capped at MAX_IMAGE_SIZE upstream by handlePickedFile.
async function fileToAttachment(file) {
  if (!file) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsDataURL(file);
  });
  return {
    kind: 'image',
    dataUrl,
    name: file.name || 'attachment',
    mimeType: file.type || 'image/png',
  };
}

// --- Control-route helpers --------------------------------------------------
// Used by ChatPanel callbacks to post user decisions back to the agent runner.

async function postConfirm({ runId, toolCallId, action, choice }) {
  return fetch('/api/chat/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId, toolCallId, action, ...(choice ? { choice } : {}) }),
  });
}

async function postContinue({ runId, action }) {
  return fetch('/api/chat/continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId, action }),
  });
}

async function postCancel({ runId }) {
  return fetch('/api/chat/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ runId }),
  });
}

// --- File picker accept maps ------------------------------------------------

const ACCEPT_HTML = '.html,.htm,text/html';
const ACCEPT_MD = '.md,.markdown,text/markdown,text/plain';
const ACCEPT_IMAGE = 'image/*';
const ACCEPT_ANY = 'image/*,.md,.markdown,.html,text/markdown,text/html';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const TEXTAREA_MAX_HEIGHT = 240;

// --- Chat reducer -----------------------------------------------------------
// Phase 1 wiring: holds the active thread, the streaming message list, and
// any in-flight tool calls. The transient assistant message (one growing
// bubble during the stream) is detected by an `id` prefix of `tmp-asst-`
// so we know whether to append to the last bubble or start a new one.

const initialChat = {
  threadId: null,
  messages: [],
  activeToolCalls: [],
  streaming: false,
  softPause: null,
  activeRun: null,
};

function lastIsTransientAssistant(messages) {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' && last?.id?.startsWith('tmp-asst-');
}

function chatReducer(state, action) {
  switch (action.type) {
    case 'THREAD_LOADED': {
      // Normalize tool_calls from DB — neon driver usually parses JSONB but
      // be defensive in case the value comes back as a raw string.
      // Also: any tool_call still in pending/running/awaiting_* state from a
      // prior run is now ORPHANED (the live runMap entry was wiped by HMR,
      // a server restart, or just by time). Mark them 'stale' so the chip
      // renders an inert label instead of looping a spinner that will never
      // resolve and a Confirm button that 404s.
      const normalized = (action.messages || []).map((m) => {
        const raw = typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls;
        const tc = Array.isArray(raw)
          ? raw.map((t) => (
              t && (t.status === 'pending' || t.status === 'running' || t.status === 'awaiting_confirm' || t.status === 'awaiting_choice')
                ? { ...t, status: 'stale' }
                : t
            ))
          : raw;
        return { ...m, tool_calls: tc };
      });
      return { ...state, threadId: action.threadId, messages: normalized };
    }
    case 'USER_MSG_OPTIMISTIC':
      return {
        ...state,
        messages: [...state.messages, { id: `tmp-${Date.now()}`, role: 'user', content: action.content }],
        streaming: true,
        activeToolCalls: [],
      };
    case 'ASSISTANT_TOKEN':
      return {
        ...state,
        messages: lastIsTransientAssistant(state.messages)
          ? state.messages.map((m, i) => i === state.messages.length - 1
              ? { ...m, content: (m.content || '') + action.delta }
              : m)
          : [...state.messages, { id: `tmp-asst-${Date.now()}`, role: 'assistant', content: action.delta, tool_calls: null }],
      };
    case 'TOOL_CALL_STARTED':
      return {
        ...state,
        activeToolCalls: [...state.activeToolCalls, { id: action.id, name: action.name, args: action.args, status: 'running' }],
      };
    case 'TOOL_CALL_STATUS': {
      const updated = state.activeToolCalls.map((tc) => tc.id === action.id
        ? { ...tc, status: action.status, result: action.result, error: action.error }
        : tc);
      return { ...state, activeToolCalls: updated };
    }
    case 'RUN_FINISHED': {
      // Persist the just-completed tool calls into the conversation so they
      // remain visible after the run ends. Attach them to the last assistant
      // message; if none exists (tool-only turn with no streamed reply),
      // synthesize an empty assistant bubble to hold the chips.
      const finishedChips = state.activeToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        status: tc.status === 'running' ? 'done' : tc.status,
        result: tc.result,
        error: tc.error,
      }));
      let nextMessages = state.messages;
      if (finishedChips.length > 0) {
        let lastAsstIdx = -1;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'assistant') { lastAsstIdx = i; break; }
        }
        if (lastAsstIdx === -1) {
          nextMessages = [...state.messages, {
            id: `tmp-asst-${Date.now()}`,
            role: 'assistant',
            content: '',
            tool_calls: finishedChips,
          }];
        } else {
          nextMessages = state.messages.map((m, i) => i === lastAsstIdx
            ? { ...m, tool_calls: [...(m.tool_calls || []), ...finishedChips] }
            : m);
        }
      }
      return { ...state, messages: nextMessages, streaming: false, activeToolCalls: [], softPause: null };
    }
    case 'RUN_ID_RECEIVED':
      return { ...state, activeRun: { runId: action.runId, status: 'running' } };
    case 'TOOL_NEEDS_CONFIRM':
      return {
        ...state,
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.id === action.id ? { ...tc, status: 'awaiting_confirm', summary: action.summary } : tc
        ),
        streaming: false,
      };
    case 'TOOL_NEEDS_CHOICE':
      return {
        ...state,
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.id === action.id ? { ...tc, status: 'awaiting_choice', summary: action.summary, choices: action.choices } : tc
        ),
        streaming: false,
      };
    case 'TOOL_RESUMED':
      return {
        ...state,
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.id === action.id ? { ...tc, status: 'running' } : tc
        ),
        streaming: true,
      };
    case 'RUN_SOFT_PAUSED':
      return {
        ...state,
        softPause: { iterationsSoFar: action.iterationsSoFar, breakdown: action.breakdown },
        streaming: false,
      };
    case 'RUN_CONTINUED':
      return { ...state, softPause: null, streaming: true };
    case 'RUN_ERROR':
      // Surface backend agent failures as an assistant bubble so users see
      // what went wrong (e.g. "credit balance too low", "rate limit"). Phase 5
      // can promote this to a styled error chip.
      return {
        ...state,
        messages: [...state.messages, {
          id: `tmp-err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${action.err || 'Agent failed.'}`,
          tool_calls: null,
        }],
        streaming: false,
        activeToolCalls: [],
      };
    default:
      return state;
  }
}

export default function PromptDock({ boardId, onAddUrl, onUploadMd, onUploadHtml, onAddPrompt, onAddSkill, onAddBlankSite, onRunFlow, runFlowBusy, runFlowError, nodeCount, onAgentMutatedGraph }) {
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);   // attached image (preview only)
  const [imagePreview, setImagePreview] = useState(null);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showBrain, setShowBrain] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const multiFileRef = useRef(null);
  const taRef = useRef(null);
  const addBtnRef = useRef(null);
  const modelBtnRef = useRef(null);

  // --- Chat state (Phase 1) ----------------------------------------------
  const [chat, dispatchChat] = useReducer(chatReducer, initialChat);
  // Tracks the active runId synchronously so auto-confirm in needs_choice
  // doesn't read a stale closure (React may not have re-rendered between
  // the run_id SSE event and the immediately following needs_choice event).
  const latestRunIdRef = useRef(null);
  // Collapsed = dock shows input only (no bubble panel). Auto-collapsed
  // after each turn so the dock returns to its compact "original size".
  // New send or manual expand sets it back to false. Chevron in the panel
  // sets it to true on demand.
  const [chatCollapsed, setChatCollapsed] = useState(true);

  // Load the board's active thread on mount / when boardId changes. The
  // route auto-creates a thread if none exists, so messages will be `[]`
  // for a fresh board. Auto-expands the chat panel if there's history so
  // the user immediately sees past conversation on reload.
  useEffect(() => {
    if (!boardId) return;
    const ctrl = new AbortController();
    fetch(`/api/chat?boardId=${encodeURIComponent(boardId)}`, {
      credentials: 'include',
      signal: ctrl.signal,
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.messages) return;
        dispatchChat({ type: 'THREAD_LOADED', threadId: data.thread?.id, messages: data.messages });
        if (data.messages.length > 0) setChatCollapsed(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.warn('[PromptDock] failed to load chat thread', err);
      });
    return () => ctrl.abort();
  }, [boardId]);

  // SSE event dispatch — keep small and pure so the streaming loop in
  // sendChatMessage stays readable. RUN_FINISHED is dispatched after the
  // reader-loop exits (covers normal end-of-stream and server-side errors
  // that just close the connection).
  function handleSseEvent(name, payload) {
    switch (name) {
      case 'assistant_token':
        dispatchChat({ type: 'ASSISTANT_TOKEN', delta: payload.delta });
        break;
      case 'tool_call':
        dispatchChat({ type: 'TOOL_CALL_STARTED', id: payload.id, name: payload.name, args: payload.args });
        break;
      case 'tool_status':
        dispatchChat({ type: 'TOOL_CALL_STATUS', id: payload.id, status: payload.status, result: payload.result, error: payload.error });
        // (Refetch moved to end-of-run in sendChatMessage — refetching on
        // every tool caused setNodes/setEdges to fire 5+ times per turn,
        // tearing down TransformWrapper's zoom/pan state and locking the
        // canvas mid-conversation.)
        break;
      case 'run_status':
        // Show backend agent failures inline. Successful completions get
        // their final RUN_FINISHED after the reader-loop exits.
        if (payload.status === 'failed' || payload.status === 'hard_limited') {
          const msg = payload.err
            || (payload.status === 'hard_limited' ? 'Hit the action limit for this turn. Send a new message to continue.' : 'Agent failed.');
          latestRunIdRef.current = null;
          dispatchChat({ type: 'RUN_ERROR', err: msg });
        } else if (payload.status === 'cancelled' || payload.status === 'cancelled_softpause') {
          // Agent was cancelled — treat as a clean finish so streaming state
          // clears. No error bubble; the user initiated the cancel.
          latestRunIdRef.current = null;
          dispatchChat({ type: 'RUN_FINISHED' });
        }
        break;
      case 'run_id':
        latestRunIdRef.current = payload.runId;
        dispatchChat({ type: 'RUN_ID_RECEIVED', runId: payload.runId });
        break;
      case 'needs_confirm':
        dispatchChat({ type: 'TOOL_NEEDS_CONFIRM', id: payload.id, summary: payload.summary });
        break;
      case 'needs_choice': {
        // Single-choice → auto-confirm without prompting the user.
        // Use latestRunIdRef (set synchronously on run_id) instead of
        // chat.activeRun?.runId — the React state may not have re-rendered
        // yet when this case fires immediately after run_id in the same
        // stream chunk, leading to a null runId and a 400 from /api/chat/confirm.
        if (Array.isArray(payload.choices) && payload.choices.length <= 1) {
          const choice = payload.choices[0]?.id || 'auto';
          postConfirm({
            runId: latestRunIdRef.current,
            toolCallId: payload.id,
            action: 'confirm',
            choice,
          });
          break;
        }
        dispatchChat({ type: 'TOOL_NEEDS_CHOICE', id: payload.id, summary: payload.summary, choices: payload.choices });
        break;
      }
      case 'needs_softlimit_continue':
        dispatchChat({ type: 'RUN_SOFT_PAUSED', iterationsSoFar: payload.iterationsSoFar, breakdown: payload.breakdown });
        break;
      case 'graph_mutated':
        // The server pre-created some nodes (e.g. chat attachment persistence)
        // before the agent even started. Tell the canvas to refetch so the
        // user sees them appear immediately, without waiting for run end.
        onAgentMutatedGraph?.();
        break;
    }
  }

  // Send a chat message and stream-parse the SSE response. Native
  // EventSource doesn't support POST bodies, so we use fetch + a manual
  // reader. Buffer + split on `\n\n` to recover one SSE event block at a
  // time; lines starting with `event:` and `data:` are reassembled.
  async function sendChatMessage(content, attachments = null) {
    if (!boardId) return;
    const trimmed = (content || '').trim();
    if (!trimmed && !(attachments && attachments.length)) return;
    // Optimistic bubble: if user sent image-only (no text), show the
    // file name(s) so the bubble isn't empty. Matches the placeholder the
    // server persists in chat_messages.content.
    const optimisticText = trimmed
      || (attachments && attachments.length
        ? `[📎 ${attachments.map((a) => a.name || 'image').join(', ')}]`
        : '');
    dispatchChat({ type: 'USER_MSG_OPTIMISTIC', content: optimisticText });
    // Expand the chat panel so the user sees their bubble + the agent's
    // streaming reply. Stays open after the turn — user collapses via chevron.
    setChatCollapsed(false);

    const res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({
        boardId,
        message: trimmed,
        modelId,
        attachments: attachments && attachments.length ? attachments : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[chat] POST failed', err);
      dispatchChat({ type: 'RUN_FINISHED' });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const evBlock = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = evBlock.split('\n');
        let evName = null, dataStr = '';
        for (const ln of lines) {
          if (ln.startsWith('event: ')) evName = ln.slice(7).trim();
          else if (ln.startsWith('data: ')) dataStr += ln.slice(6);
        }
        if (!evName) continue;
        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }
        handleSseEvent(evName, data);
      }
    }
    latestRunIdRef.current = null;
    dispatchChat({ type: 'RUN_FINISHED' });
    // End-of-run refetch + workflow framing. frame:true tells the canvas
    // to zoom out and centre everything the agent created across this
    // turn — instead of jumping the camera per-node mid-stream, we land
    // a single composed view of the finished workflow.
    onAgentMutatedGraph?.({ frame: true });
    // Panel stays open so the user can read the agent's reply and the
    // completed tool chips. Collapse manually via the chevron.
  }

  // Hydrate persisted model on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && findModel(saved)?.id === saved) setModelId(saved);
    } catch (e) {}
  }, []);

  // Persist model selection.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(MODEL_STORAGE_KEY, modelId); } catch (e) {}
  }, [modelId]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
  }, [text]);

  // Close popovers on outside click / Esc.
  useEffect(() => {
    if (!showAddMenu && !showModelMenu) return;
    function onDown(e) {
      const t = e.target;
      if (t?.closest?.('.prompt-dock-popover')) return;
      if (showAddMenu && t?.closest?.('.prompt-dock-add-btn')) return;
      if (showModelMenu && t?.closest?.('.prompt-dock-model-btn')) return;
      setShowAddMenu(false);
      setShowModelMenu(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { setShowAddMenu(false); setShowModelMenu(false); }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showAddMenu, showModelMenu]);

  function fileKind(file) {
    const name = (file.name || '').toLowerCase();
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'text/markdown' || /\.(md|markdown)$/.test(name)) return 'md';
    if (file.type === 'text/html' || /\.html?$/.test(name)) return 'html';
    return 'unknown';
  }

  async function handlePickedFile(file) {
    const kind = fileKind(file);
    if (kind === 'md') {
      setBusy(true);
      try { await onUploadMd(file); } finally { setBusy(false); }
      return;
    }
    if (kind === 'html') {
      setBusy(true);
      try { await onUploadHtml(file); } finally { setBusy(false); }
      return;
    }
    if (kind === 'image') {
      if (file.size > MAX_IMAGE_SIZE) {
        alert('Image too large (max 10MB).');
        return;
      }
      setImageFile(file);
      const r = new FileReader();
      r.onload = (e) => setImagePreview(e.target.result);
      r.readAsDataURL(file);
      return;
    }
    alert('Unsupported file type. Use image, .md, or .html.');
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  // Open the hidden single-file picker with a specific accept list.
  function openPicker(accept) {
    const el = fileRef.current;
    if (!el) return;
    el.accept = accept || ACCEPT_ANY;
    el.click();
  }

  function openMultiPicker() {
    const el = multiFileRef.current;
    if (!el) return;
    el.click();
  }

  function focusComposer() {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
  }

  function pickAddItem(kind) {
    setShowAddMenu(false);
    if (kind === 'html') return openPicker(ACCEPT_HTML);
    if (kind === 'md') return openPicker(ACCEPT_MD);
    if (kind === 'screenshot') return openPicker(ACCEPT_IMAGE);
    if (kind === 'multiple') return openMultiPicker();
    if (kind === 'prompt') {
      setShowAddUrl(false); setShowBrain(false); setShowPin(false);
      if (onAddPrompt) {
        onAddPrompt();
      } else {
        focusComposer();
      }
      return;
    }
    if (kind === 'skill') {
      if (onAddSkill) onAddSkill();
      else alert('Coming next: skill node.');
      return;
    }
    if (kind === 'blank') {
      if (onAddBlankSite) onAddBlankSite();
      else alert('Blank website not wired in this view.');
      return;
    }
  }

  function pickModel(id) {
    setModelId(id);
    setShowModelMenu(false);
  }

  async function submit() {
    const value = text.trim();

    if (showAddUrl) {
      if (!value) return;
      const url = normalizeUrl(value);
      if (!url) {
        alert('Enter a domain (example.com) or full URL.');
        return;
      }
      setBusy(true);
      try {
        await onAddUrl(url);
        setText('');
        setShowAddUrl(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Bare arrow click (no text, no image, not in URL mode) = "run flow" —
    // process the canvas graph. The button doubles as a runner trigger
    // until we wire the conversational chat path. The selected model
    // from the picker is passed through so the backend can route to
    // OpenAI / Anthropic / Gemini accordingly.
    if (!value && !imageFile) {
      if (onRunFlow) {
        try { await onRunFlow({ modelId }); } catch (e) { console.warn('runFlow error', e); }
      }
      return;
    }

    // URL auto-detect — if the free-text input looks like a URL (bare
    // domain, full https://, etc.) we treat it as an Add-URL action even
    // when the dedicated URL toggle wasn't selected. Drops the friction
    // of "did I remember to click the website chip?" and matches the
    // PromptDock's role as a single conversational entry point.
    // Image attached → still falls through to chat (image+url combo
    // belongs to the conversational path).
    if (!imageFile && looksLikeUrl(value)) {
      const url = normalizeUrl(value);
      if (url) {
        setBusy(true);
        try {
          await onAddUrl(url);
          setText('');
        } finally {
          setBusy(false);
        }
        return;
      }
    }

    // Free-text path → chat agent. If an image is attached, forward it as a
    // multimodal user message so the agent can SEE the reference and decide
    // what to do (ingest as asset, edit it, describe its style, etc.).
    // Image-only submits pass an empty text — the server side handles that
    // case by displaying a clean "[image attachment: file.png]" in the
    // chat history, without putting words in the user's mouth.
    if (value || imageFile) {
      const text = value;
      const attachment = imageFile ? await fileToAttachment(imageFile) : null;
      setText('');
      clearImage();
      try {
        await sendChatMessage(text, attachment ? [attachment] : null);
      } catch (e) {
        console.error('[prompt-dock] sendChatMessage failed', e);
      }
      return;
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.indexOf('image') !== -1) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          handlePickedFile(f);
          break;
        }
      }
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handlePickedFile(f);
  }

  const hasContent = text.trim() !== '' || imageFile !== null;
  const placeholder = showAddUrl
    ? 'example.com or full URL…'
    : showBrain
      ? 'Brainstorm…'
      : showPin
        ? 'Pin feedback on the canvas…'
        : nodeCount === 0
          ? 'Add a site URL or design.md to start your canvas…'
          : 'Add another node…';

  const currentModel = findModel(modelId);
  const ProviderIcon = PROVIDER_ICON[currentModel.provider];

  return (
    <div
      className="prompt-dock"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {imagePreview && (
          <motion.div
            className="prompt-dock-chips"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="prompt-dock-chip">
              <img src={imagePreview} alt={imageFile.name} />
              <button className="prompt-dock-chip-x" onClick={clearImage} aria-label="Remove image">
                {ICON_X}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!chatCollapsed && (chat.messages.length > 0 || chat.activeToolCalls.length > 0) && (
        <ChatPanel
          messages={chat.messages}
          activeToolCalls={chat.activeToolCalls}
          streaming={chat.streaming}
          onCollapse={() => setChatCollapsed(true)}
          softPause={chat.softPause}
          onConfirmTool={async (toolCallId) => {
            const res = await postConfirm({ runId: chat.activeRun?.runId, toolCallId, action: 'confirm' });
            if (res.ok) dispatchChat({ type: 'TOOL_RESUMED', id: toolCallId });
          }}
          onSkipTool={async (toolCallId) => {
            const res = await postConfirm({ runId: chat.activeRun?.runId, toolCallId, action: 'skip' });
            if (res.ok) dispatchChat({ type: 'TOOL_RESUMED', id: toolCallId });
          }}
          onChooseTool={async (toolCallId, choiceId) => {
            const res = await postConfirm({ runId: chat.activeRun?.runId, toolCallId, action: 'confirm', choice: choiceId });
            if (res.ok) dispatchChat({ type: 'TOOL_RESUMED', id: toolCallId });
          }}
          onSoftContinue={async () => {
            const res = await postContinue({ runId: chat.activeRun?.runId, action: 'continue' });
            if (res.ok) dispatchChat({ type: 'RUN_CONTINUED' });
          }}
          onSoftStop={async () => {
            const res = await postContinue({ runId: chat.activeRun?.runId, action: 'stop' });
            if (res.ok) dispatchChat({ type: 'RUN_CONTINUED' });
          }}
        />
      )}

      <textarea
        ref={taRef}
        className="prompt-dock-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={1}
        disabled={busy || chat.streaming || chat.softPause !== null}
      />

      <div className="prompt-dock-actions">
        <div className="prompt-dock-actions-left">
          <button
            ref={addBtnRef}
            type="button"
            className={`prompt-dock-icon-btn prompt-dock-add-btn ${showAddMenu ? 'open' : ''}`}
            onClick={() => { setShowAddMenu((p) => !p); setShowModelMenu(false); }}
            title="Add to canvas"
            aria-haspopup="menu"
            aria-expanded={showAddMenu}
            disabled={busy}
          >
            {ICON_PLUS}
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showAddUrl ? 'active add-url' : ''}`}
            onClick={() => { setShowAddUrl((p) => !p); setShowBrain(false); setShowPin(false); }}
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showAddUrl ? 360 : 0, scale: showAddUrl ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_GLOBE}
            </motion.span>
            <AnimatePresence initial={false}>
              {showAddUrl && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Add URL
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showBrain ? 'active brain' : ''}`}
            onClick={() => { setShowBrain((p) => !p); setShowAddUrl(false); setShowPin(false); }}
            title="Brainstorming"
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showBrain ? 360 : 0, scale: showBrain ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_BRAIN}
            </motion.span>
            <AnimatePresence initial={false}>
              {showBrain && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Brainstorming
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showPin ? 'active pin' : ''}`}
            onClick={() => { setShowPin((p) => !p); setShowAddUrl(false); setShowBrain(false); }}
            title="Feedback mode (coming next)"
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showPin ? 360 : 0, scale: showPin ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_PIN}
            </motion.span>
            <AnimatePresence initial={false}>
              {showPin && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Feedback Mode
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            ref={modelBtnRef}
            type="button"
            className={`prompt-dock-pill prompt-dock-model-btn ${showModelMenu ? 'open' : ''}`}
            onClick={() => { setShowModelMenu((p) => !p); setShowAddMenu(false); }}
            title={`Model: ${currentModel.name}`}
            aria-haspopup="menu"
            aria-expanded={showModelMenu}
            disabled={busy}
          >
            <span className="prompt-dock-pill-icon prompt-dock-model-icon">
              <ProviderIcon />
            </span>
            <span className="prompt-dock-model-name">{currentModel.name}</span>
            <span className="prompt-dock-model-chev">{ICON_CHEVRON}</span>
          </button>
        </div>

        <motion.button
          type="button"
          className={`prompt-dock-send ${chat.streaming ? 'stop active' : (hasContent || (nodeCount > 0) ? 'active' : '')}${runFlowBusy ? ' busy' : ''}`}
          whileHover={chat.streaming || ((hasContent || nodeCount > 0) && !runFlowBusy) ? { scale: 1.06 } : {}}
          whileTap={chat.streaming || ((hasContent || nodeCount > 0) && !runFlowBusy) ? { scale: 0.94 } : {}}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          disabled={busy || runFlowBusy || (!chat.streaming && chat.softPause !== null) || (!chat.streaming && !hasContent && nodeCount === 0)}
          onClick={async () => {
            if (chat.streaming) {
              // Stop the in-flight agent run. The backend cancellation flushes
              // any pending confirm/choice/continue Promises and the SSE stream
              // closes with run_status=cancelled; our reducer treats that as
              // RUN_FINISHED so streaming clears immediately.
              const runId = latestRunIdRef.current || chat.activeRun?.runId;
              if (runId) {
                try { await postCancel({ runId }); } catch (e) { console.warn('[prompt-dock] cancel failed', e); }
              }
              // Optimistically clear streaming state even if the cancel POST
              // didn't go through — the user wants to move on.
              latestRunIdRef.current = null;
              dispatchChat({ type: 'RUN_FINISHED' });
              return;
            }
            submit();
          }}
          aria-label={chat.streaming ? 'Stop' : (hasContent ? 'Send' : 'Run flow')}
          title={chat.streaming ? 'Stop the agent' : (runFlowBusy ? 'Running…' : (hasContent ? 'Send' : 'Run flow (process connected nodes)'))}
        >
          {chat.streaming ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="1.5"/>
            </svg>
          ) : runFlowBusy ? (
            <svg className="prompt-dock-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" opacity="0.25"/>
              <path d="M21 12a9 9 0 0 1-9 9"/>
            </svg>
          ) : ICON_ARROW_UP}
        </motion.button>
      </div>

      {/* Same portal trick as the model menu — the .prompt-dock has
          transform:translateX(-50%) which traps descendant position:fixed
          inside the dock's containing block instead of the viewport.
          Portal to body so getAddMenuStyle's viewport coords land where
          we want. AnimatePresence MUST live inside the portal so the
          motion.div is its direct child. */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showAddMenu && (
            <motion.div
              key="add-menu"
              className="prompt-dock-popover prompt-dock-add-menu"
              style={getAddMenuStyle(addBtnRef)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.14 }}
              role="menu"
            >
              <div className="prompt-dock-popover-title">Add to canvas</div>
              <button onClick={() => pickAddItem('blank')}><MENU_ICON.Blank /><span>Add blank website</span></button>
              <button onClick={() => pickAddItem('html')}><MENU_ICON.Html /><span>Add .html</span></button>
              <button onClick={() => pickAddItem('md')}><MENU_ICON.Md /><span>Add .md</span></button>
              <button onClick={() => pickAddItem('screenshot')}><MENU_ICON.Image /><span>Add screenshot</span></button>
              <button onClick={() => pickAddItem('prompt')}><MENU_ICON.Prompt /><span>Add prompt</span></button>
              <button onClick={() => pickAddItem('skill')}><MENU_ICON.Skill /><span>Add skill</span></button>
              <button onClick={() => pickAddItem('multiple')}><MENU_ICON.Files /><span>Add multiple files</span></button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Anchor the menu to the model button via getBoundingClientRect.
          The dock has `transform: translateX(-50%)`, which traps any
          descendant `position: fixed` element (containing block becomes
          the dock instead of the viewport). Portal to <body> so the
          menu escapes the dock's stacking context. AnimatePresence MUST
          live inside the portal — wrapping createPortal directly leaves
          AnimatePresence with a portal element as its child instead of
          the motion.div, which breaks the mount lifecycle and leaves
          the menu stuck at initial opacity:0. */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModelMenu && (
            <motion.div
              key="model-menu"
              className="prompt-dock-popover prompt-dock-model-menu"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.14 }}
              role="menu"
              style={getModelMenuStyle(modelBtnRef)}
            >
              {MODEL_OPTIONS.map((group, gi) => (
                <div key={gi} className="prompt-dock-model-group">
                  {group.group && (
                    <div className="prompt-dock-popover-title prompt-dock-model-grouptitle">
                      {group.group}
                    </div>
                  )}
                  {group.items.map((m) => {
                    const Icon = PROVIDER_ICON[m.provider];
                    const selected = m.id === modelId;
                    return (
                      <button
                        key={m.id}
                        onClick={() => pickModel(m.id)}
                        className={selected ? 'selected' : ''}
                        role="menuitemradio"
                        aria-checked={selected}
                      >
                        <span className="prompt-dock-model-icon"><Icon /></span>
                        <span className="prompt-dock-model-row-name">{m.name}</span>
                        {selected && <span className="prompt-dock-model-check">{ICON_CHECK}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePickedFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={multiFileRef}
        type="file"
        multiple
        accept={ACCEPT_ANY}
        style={{ display: 'none' }}
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          for (const f of files) {
            // eslint-disable-next-line no-await-in-loop
            await handlePickedFile(f);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}

