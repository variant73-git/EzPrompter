import { describe, expect, it } from 'vitest';
import {
  createMockSiteHtml,
  defaultStudioDrafts,
  suggestStudioProjectName,
  validateStudioInput,
} from './studio-mock.js';

describe('studio mock flow', () => {
  it('validates the distinct material required by each mode', () => {
    const drafts = defaultStudioDrafts();
    expect(validateStudioInput('builder', drafts.builder)).toMatch(/describe/i);
    expect(validateStudioInput('clone', drafts.clone)).toMatch(/URL/i);
    expect(validateStudioInput('style', drafts.style)).toMatch(/target/i);

    expect(validateStudioInput('builder', { ...drafts.builder, brief: 'A complete editorial portfolio website' })).toBeNull();
    expect(validateStudioInput('clone', { ...drafts.clone, url: 'https://example.com' })).toBeNull();
    expect(validateStudioInput('style', { ...drafts.style, targetUrl: 'https://target.com', styleUrl: 'https://reference.com' })).toBeNull();
  });

  it('creates safe, mode-specific website output', () => {
    const html = createMockSiteHtml('builder', { brief: '<script>alert(1)</script> editorial archive' });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(createMockSiteHtml('clone', { fidelity: 'Exact' })).toContain('exact recreation');
    expect(createMockSiteHtml('style', { preservation: 'Content only' })).toContain('Content only');
  });

  it('suggests useful visible project names instead of board terminology', () => {
    expect(suggestStudioProjectName('builder', { brief: 'A portfolio for a type designer' })).toBe('portfolio for a type designer');
    expect(suggestStudioProjectName('clone', { url: 'https://www.example.com/work' })).toBe('Recreate example.com');
    expect(suggestStudioProjectName('style', { targetUrl: 'https://target.test' })).toBe('Restyle target.test');
  });
});
