import { describe, expect, it, vi } from 'vitest';
import { analyzeTargetAuthority, targetEvidenceFromHtml } from './chassis-target-evidence.js';

const html = `<!doctype html><html lang="pt-BR"><head>
  <title>Amigo Secreto — o site oficial do sorteio</title>
  <meta name="description" content="Crie seu grupo e convide os amigos.">
  <meta name="theme-color" content="#d9382e">
  <link rel="icon" href="/favicon.png">
  <style>:root{--paper:#f7f1e8;--brand:#d9382e}body{font-family:Archivo,sans-serif}</style>
</head><body><main><section><h1>Agora sem papelzinho</h1><p>Crie seu grupo, convide os amigos e sorteie em um toque.</p><a>Começar grátis</a></section></main></body></html>`;

const chassisEvidence = {
  sections: [{
    text: {
      heading: { value: 'Agora sem papelzinho', typography: { family: 'Bricolage Grotesque, sans-serif' } },
      body: { value: 'Crie seu grupo', typography: { family: 'Archivo, sans-serif' } },
      visibleCharacters: 128,
    },
  }],
  mediaSlots: [],
};

describe('target authority evidence', () => {
  it('extracts compact content and identity evidence without retaining the full page', () => {
    const evidence = targetEvidenceFromHtml({
      html,
      title: 'Amigo Secreto',
      sourceUrl: 'https://amigosecreto.example/',
      chassisEvidence,
    });
    expect(evidence).toMatchObject({
      brand: 'Amigo Secreto', language: 'pt-BR',
      headings: ['Agora sem papelzinho'],
      callsToAction: ['Começar grátis'],
      colors: expect.arrayContaining(['#D9382E', '#F7F1E8']),
      fonts: ['Bricolage Grotesque', 'Archivo'],
      counts: { sections: 1, visibleCharacters: 128, media: 0 },
    });
    expect(evidence.hash).toHaveLength(64);
    expect(evidence).not.toHaveProperty('html');
  });

  it('validates and captures a URL once before producing evidence', async () => {
    const validate = vi.fn(async () => 'https://amigosecreto.example/');
    const capture = vi.fn(async () => ({ html, title: 'Amigo Secreto', chassisEvidence }));
    const evidence = await analyzeTargetAuthority({
      input: { authorityType: 'url', url: 'https://amigosecreto.example' },
      validate,
      capture,
    });
    expect(validate).toHaveBeenCalledWith('https://amigosecreto.example');
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('https://amigosecreto.example/', expect.objectContaining({
      includeChassisEvidence: true,
      publicNetworkOnly: true,
    }));
    expect(evidence.brand).toBe('Amigo Secreto');
  });
});
