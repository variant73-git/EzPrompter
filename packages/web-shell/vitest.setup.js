import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class MockEventSource {
  constructor(url) { this.url = url; this.listeners = {}; this.readyState = 0; }
  addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
  removeEventListener(type, cb) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((x) => x !== cb);
  }
  dispatch(type, data) { (this.listeners[type] || []).forEach((cb) => cb({ data: JSON.stringify(data), type })); }
  close() { this.readyState = 2; }
}
globalThis.MockEventSource = MockEventSource;
