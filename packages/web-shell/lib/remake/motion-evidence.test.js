import { describe, it, expect } from 'vitest';
import { descreverMovimento } from './motion-evidence.js';

describe('o movimento medido vira instrucao escrita', () => {
  // Sem evidencia, DIZER que nao ha' e' melhor orientacao que silencio: o
  // modelo fica sabendo que nao deve inventar. Foi assim que o experimento de
  // 20/08 acabou com identidade visual inventada.
  it('nunca finge: sem medida, manda construir parado', () => {
    expect(descreverMovimento(null)).toMatch(/none was measured[\s\S]*Do not invent motion/i);
    expect(descreverMovimento({ animacoes: [], rolagem: [], css: [] }))
      .toMatch(/NOTHING animates[\s\S]*do not add motion/i);
  });

  it('nomeia alvo, propriedades, tempo e curva de cada animacao', () => {
    const texto = descreverMovimento({
      animacoes: [{ alvos: ['#hero h1'], quantosAlvos: 1, propriedades: ['y', 'opacity'],
        duracaoMs: 800, atrasoMs: 200, curva: 'power2.out', repete: 0, porRolagem: true }],
      rolagem: [], css: [], motores: { gsap: true },
    });
    expect(texto).toContain('#hero h1');
    expect(texto).toContain('props: y -> UNKNOWN, opacity -> UNKNOWN');
    expect(texto).toContain('800ms');
    expect(texto).toContain('delay 200ms');
    expect(texto).toContain('ease power2.out');
    expect(texto).toContain('driven by scroll');
  });

  it('diz o que a rolagem PRENDE e o que ela ACOMPANHA', () => {
    const texto = descreverMovimento({
      animacoes: [], css: [], motores: { scrollTrigger: true },
      rolagem: [{ gatilho: '.water', inicio: 'top top', fim: '+=1200', preso: true, acompanha: true }],
    });
    expect(texto).toMatch(/\.water — start top top · end \+=1200 · PINS the section/);
    expect(texto).toContain('scrubbed');
  });

  it('conta animacao CSS tambem — nem todo site usa biblioteca', () => {
    const texto = descreverMovimento({
      animacoes: [], rolagem: [], motores: {},
      css: [{ alvo: '.marquee', nome: 'slide', duracao: '20s', repete: 'infinite', curva: 'linear' }],
    });
    expect(texto).toContain('.marquee — slide · 20s · infinite · linear');
  });

  // A instrucao separa O QUE se move (medido) de COMO reproduzir (escolha de
  // quem constroi) — senao viraria um pedido de clonar a biblioteca.
  it('separa o que se move de como reproduzir', () => {
    const texto = descreverMovimento({ animacoes: [{ alvos: ['#a'], quantosAlvos: 1, propriedades: ['x'], duracaoMs: 1 }], rolagem: [], css: [] });
    expect(texto).toMatch(/Reproduce WHAT moves; you choose HOW/i);
    expect(texto).toMatch(/measured on the live page, not inferred from stills/i);
  });
});

describe('o que NAO entra na instrucao', () => {
  // Medido no farmminerals: sem filtro, o texto dizia que a pagina anima
  // `lazy`, `force3D`, `parent` e `callbackScope` — campos internos do GSAP.
  // O reconstrutor tentaria reproduzir a biblioteca em vez do movimento.
  it('descarta campos de configuracao da biblioteca', async () => {
    const { coletorNaPagina } = await import('./motion-evidence.js');
    const alvo = document.createElement('div');
    alvo.id = 'hero';
    document.body.appendChild(alvo);
    window.gsap = {
      globalTimeline: {
        getChildren: () => [{
          targets: () => [alvo],
          duration: () => 0.8,
          vars: { y: 40, opacity: 0, duration: 0.8, ease: 'power2.out',
            lazy: false, force3D: true, parent: {}, callbackScope: {}, onCompleteParams: [], inherit: true },
        }],
      },
    };
    try {
      const ev = coletorNaPagina()();
      expect(ev.animacoes).toHaveLength(1);
      // So' o que de fato se MOVE sobrevive.
      expect(ev.animacoes[0].propriedades.sort()).toEqual(['opacity', 'y']);
      expect(ev.animacoes[0].alvos).toEqual(['#hero']);
      expect(ev.animacoes[0].duracaoMs).toBe(800);
      expect(ev.animacoes[0].curva).toBe('power2.out');
    } finally { delete window.gsap; alvo.remove(); }
  });

  // Alvo que nao e' elemento (proxy de scroll suave, contador interno) nao
  // descreve movimento de pagina — no site real isso enchia o texto com
  // "0 element(s) — props: frame, totalProgress".
  it('ignora animacao sem elemento nenhum', async () => {
    const { coletorNaPagina } = await import('./motion-evidence.js');
    window.gsap = { globalTimeline: { getChildren: () => [
      { targets: () => [{ frame: 0 }], duration: () => 1, vars: { frame: 10 } },
    ] } };
    try { expect(coletorNaPagina()().animacoes).toHaveLength(0); } finally { delete window.gsap; }
  });

  it('a instrucao nunca repete o mesmo alvo', () => {
    const texto = descreverMovimento({
      animacoes: [{ alvos: ['.a', '.a', '.b'], quantosAlvos: 3, propriedades: ['y'], duracaoMs: 500 }],
      rolagem: [], css: [],
    });
    // O de-dupe acontece na coleta; aqui prendemos que a formatacao nao volta a
    // duplicar. Um alvo repetido so' gasta a atencao de quem le.
    const linha = texto.split('\n').find((l) => l.startsWith('- '));
    expect(linha).toBe('- .a, .a, .b — props: y -> UNKNOWN · 500ms');
  });
});

describe('o que o modelo NAO precisa inventar (achados do Sol)', () => {
  // Nome de propriedade sozinho faz o modelo saber QUE algo se move e inventar
  // QUANTO. O valor autoral estava em `vars` o tempo todo.
  it('cada propriedade vai com o valor que a pagina pediu', () => {
    const texto = descreverMovimento({
      animacoes: [{ alvos: ['#a'], quantosAlvos: 1, propriedades: ['y', 'opacity'],
        valores: { y: '130%', opacity: 1 }, duracaoMs: 800, escalonado: true, escalonamentoS: 0.05 }],
      rolagem: [], css: [],
    });
    expect(texto).toContain('props: y -> 130%, opacity -> 1');
    expect(texto).toContain('staggered 0.05s apart');
  });

  // Valor nao medido vira UNKNOWN e a diretiva PROIBE chutar magnitude — em vez
  // de o modelo escolher um numero e ninguem saber que foi escolha.
  it('valor ausente vira UNKNOWN, nao um numero escolhido', async () => {
    const texto = descreverMovimento({
      animacoes: [{ alvos: ['#a'], quantosAlvos: 1, propriedades: ['x'], valores: { x: null }, duracaoMs: 300 }],
      rolagem: [], css: [],
    });
    expect(texto).toContain('x -> UNKNOWN');
    expect(texto).toMatch(/UNKNOWN was NOT measured[\s\S]*never guess a magnitude/i);
    const { MOTION_DIRECTIVE } = await import('./motion-directive.js');
    expect(MOTION_DIRECTIVE).toMatch(/UNKNOWN had no measured value[\s\S]*Do not guess a magnitude/i);
  });

  // Corte silencioso faria "40 animacoes" parecer a lista completa de 75.
  it('declara o que ficou de fora da lista', () => {
    const muitas = Array.from({ length: 75 }, (_, i) => ({ alvos: ['#a' + i], quantosAlvos: 1, propriedades: ['y'], valores: { y: 1 }, duracaoMs: 1 }));
    const texto = descreverMovimento({ animacoes: muitas, rolagem: [], css: [] });
    expect(texto).toMatch(/TIMED ANIMATIONS \(75, showing the first 40 . 35 MORE were measured and are not listed\)/);
    const listadas = texto.split('\n').filter((l) => l.startsWith('- ')).length;
    expect(listadas).toBe(40);
  });

  // `start`/`end` do ScrollTrigger aceitam FUNCAO: String(fn) despejaria o
  // codigo-fonte do site dentro do prompt.
  it('nunca deixa codigo do site virar prompt', async () => {
    const { coletorNaPagina } = await import('./motion-evidence.js');
    const el = document.createElement('div'); el.id = 'trig'; document.body.appendChild(el);
    window.ScrollTrigger = { getAll: () => [{ trigger: el, vars: { start: () => 'segredo interno', end: 'bottom' + String.fromCharCode(9) + ' top' } }] };
    try {
      const ev = coletorNaPagina()();
      expect(ev.rolagem[0].inicio).toBe('(dynamic)');
      expect(ev.rolagem[0].inicio).not.toMatch(/segredo/);
      // Caractere de controle sai fora: ele quebra a leitura do prompt.
      expect(ev.rolagem[0].fim).toBe('bottom top');
    } finally { delete window.ScrollTrigger; el.remove(); }
  });
});

describe('a limpeza e mitigacao, e o codigo diz isso', () => {
  it('restringe o alfabeto ao que seletor e tempo precisam', async () => {
    const { coletorNaPagina } = await import('./motion-evidence.js');
    const el = document.createElement('div');
    el.id = 'a\u0000b\u2028c';
    document.body.appendChild(el);
    window.ScrollTrigger = { getAll: () => [{ trigger: el, vars: { start: 'top top', end: 'bottom+=200' } }] };
    try {
      const ev = coletorNaPagina()();
      expect(ev.rolagem[0].gatilho).toBe('#a b c');
      // O que um seletor real precisa continua atravessando intacto.
      expect(ev.rolagem[0].fim).toBe('bottom+=200');
    } finally { delete window.ScrollTrigger; el.remove(); }
  });
});
