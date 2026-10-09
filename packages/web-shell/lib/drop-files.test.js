import { describe, it, expect } from 'vitest';
import { classifyDropFile, formatDropRejectMessage } from './drop-files.js';

describe('classifyDropFile', () => {
  it('classifies images by MIME type', () => {
    expect(classifyDropFile({ name: 'photo', type: 'image/png' })).toBe('image');
    expect(classifyDropFile({ name: 'photo', type: 'image/webp' })).toBe('image');
  });

  it('classifies images by extension when MIME is missing', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp']) {
      expect(classifyDropFile({ name: `pic.${ext}`, type: '' })).toBe('image');
    }
  });

  it('classifies videos as media by MIME or extension', () => {
    expect(classifyDropFile({ name: 'clip', type: 'video/mp4' })).toBe('media');
    expect(classifyDropFile({ name: 'clip.webm', type: '' })).toBe('media');
    expect(classifyDropFile({ name: 'clip.MOV', type: '' })).toBe('media');
  });

  it('classifies markdown by extension or MIME', () => {
    expect(classifyDropFile({ name: 'notes.md', type: '' })).toBe('md');
    expect(classifyDropFile({ name: 'notes.markdown', type: '' })).toBe('md');
    expect(classifyDropFile({ name: 'notes', type: 'text/markdown' })).toBe('md');
  });

  it('classifies html by extension or MIME', () => {
    expect(classifyDropFile({ name: 'page.html', type: '' })).toBe('html');
    expect(classifyDropFile({ name: 'page.htm', type: '' })).toBe('html');
    expect(classifyDropFile({ name: 'page', type: 'text/html' })).toBe('html');
  });

  it('is case-insensitive on the filename', () => {
    expect(classifyDropFile({ name: 'PHOTO.PNG', type: '' })).toBe('image');
    expect(classifyDropFile({ name: 'README.MD', type: '' })).toBe('md');
  });

  it('rejects unsupported formats', () => {
    expect(classifyDropFile({ name: 'archive.zip', type: 'application/zip' })).toBeNull();
    expect(classifyDropFile({ name: 'doc.pdf', type: 'application/pdf' })).toBeNull();
    expect(classifyDropFile({ name: 'noext', type: '' })).toBeNull();
  });

  it('survives missing fields', () => {
    expect(classifyDropFile({})).toBeNull();
    expect(classifyDropFile(null)).toBeNull();
  });
});

describe('formatDropRejectMessage', () => {
  it('names a single rejected file with singular phrasing', () => {
    const msg = formatDropRejectMessage(['archive.zip']);
    expect(msg).toContain('"archive.zip"');
    expect(msg).toContain("isn't a supported format");
    expect(msg).toContain('.md');
    expect(msg).toContain('.html');
  });

  it('lists multiple rejected files with plural phrasing', () => {
    const msg = formatDropRejectMessage(['a.zip', 'b.pdf']);
    expect(msg).toContain('"a.zip", "b.pdf"');
    expect(msg).toContain("aren't supported formats");
  });

  it('falls back to untitled for nameless files', () => {
    expect(formatDropRejectMessage([''])).toContain('"untitled"');
  });
});
