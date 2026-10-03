// Validação da ficha do programa de movimento v0 (o tocador roda no navegador; aqui só a parte pura).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const fonte = readFileSync(path.resolve(process.cwd(), 'lib/motion-program/uncraft-motion.js'), 'utf8');
const ctx = { __uncraftMotionSemAuto: true }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fonte, ctx);
const { validar } = ctx.UncraftMotion;
const base = (f) => ({ versao: 0, fichas: [f] });
const ok = { id: 'm-a', alvo: '#u-a', motor: { tipo: 'carga' }, de: { opacity: 0 }, para: { opacity: 1 }, duracao: 0.5 };

describe('validar ficha', () => {
  it('ficha valida passa', () => {
    expect(validar(base(ok)).erros).toEqual([]);
    expect(validar(base(ok)).fichas.length).toBe(1);
  });
  it('alvo precisa ser #id (nunca seletor de classe do site)', () => {
    expect(validar(base({ ...ok, alvo: '.w-1a2b' })).fichas.length).toBe(0);
    expect(validar(base({ ...ok, alvo: ['#u-a', '#u-b'] })).fichas.length).toBe(1);
  });
  it('motor desconhecido, numeros invalidos e divisao invalida sao recusados com motivo', () => {
    const r = validar(base({ ...ok, motor: { tipo: 'mouse' }, duracao: 'rapido', dividir: 'silabas' }));
    expect(r.fichas.length).toBe(0);
    expect(r.erros[0].erros.join(' ')).toMatch(/motor.tipo invalido.*duracao nao numerico.*dividir invalido|motor|duracao|dividir/);
  });
  it('id repetido: a segunda e recusada, a primeira fica', () => {
    const r = validar({ versao: 0, fichas: [ok, { ...ok }] });
    expect(r.fichas.length).toBe(1);
    expect(r.erros[0].erros[0]).toMatch(/repetido/);
  });
  it('quadros precisa de >= 2 estados; lottie precisa de src', () => {
    expect(validar(base({ id: 'm-q', alvo: '#u-a', motor: { tipo: 'tempo' }, quadros: [{ x: 0 }] })).fichas.length).toBe(0);
    expect(validar(base({ id: 'm-q', alvo: '#u-a', motor: { tipo: 'tempo' }, quadros: [{ x: 0 }, { x: 10 }] })).fichas.length).toBe(1);
    expect(validar(base({ id: 'm-l', tipo: 'lottie', alvo: '#u-l', motor: { tipo: 'carga' } })).fichas.length).toBe(0);
  });
  it('sequencia: >= 1 imagem, ajuste conhecido, pontos crescentes, sem hover', () => {
    const seq = (x) => base({ id: 'm-s', tipo: 'sequencia', alvo: '#u-c', motor: { tipo: 'rolagem', inicio: 0, fim: 900, arrasto: 1 }, imagens: ['a.avif', 'b.avif'], ...x });
    expect(validar(seq({})).fichas.length).toBe(1);
    expect(validar(seq({ imagens: ['a.avif'] })).fichas.length).toBe(1);   // quadro fixo
    expect(validar(seq({ imagens: [] })).fichas.length).toBe(0);
    expect(validar(seq({ imagens: ['a.avif', ''] })).fichas.length).toBe(0);
    expect(validar(seq({ ajuste: 'esticar' })).fichas.length).toBe(0);
    expect(validar(seq({ pontos: [[0, 0], [1, 1]] })).fichas.length).toBe(1);
    expect(validar(seq({ pontos: [[0.5, 0], [0.2, 1]] })).fichas.length).toBe(0);
    expect(validar(seq({ motor: { tipo: 'hover' } })).fichas.length).toBe(0);
  });
  it('versao diferente de 0 e programa invalido sao reportados', () => {
    expect(validar({ versao: 1, fichas: [] }).erros.length).toBe(1);
    expect(validar(null).erros.length).toBe(1);
  });
  it('so propriedades animaveis entram em de/para/quadros (chaves de controle do GSAP sao recusadas)', () => {
    expect(validar(base({ ...ok, para: { opacity: 1, scrollTrigger: '.x' } })).fichas.length).toBe(0);
    expect(validar(base({ ...ok, para: { opacity: 1, onComplete: 'alert(1)' } })).fichas.length).toBe(0);
    expect(validar(base({ ...ok, para: { opacity: 1, y: -10, rotate: 5 } })).fichas.length).toBe(1);
  });
  it('quadros e de/para juntos: recusado (antes um dos dois sumia calado)', () => {
    expect(validar(base({ id: 'm-q', alvo: '#u-a', motor: { tipo: 'tempo' }, de: { x: 0 }, quadros: [{ x: 0 }, { x: 10 }] })).fichas.length).toBe(0);
  });
  it('gatilho precisa ser #id', () => {
    expect(validar(base({ ...ok, motor: { tipo: 'hover', gatilho: 'u-botao' } })).fichas.length).toBe(0);
    expect(validar(base({ ...ok, motor: { tipo: 'hover', gatilho: '#u-botao' } })).fichas.length).toBe(1);
  });
  it('um elemento so pode ser dividido por UMA ficha', () => {
    const r = validar({ versao: 0, fichas: [{ ...ok, dividir: 'chars' }, { ...ok, id: 'm-b', dividir: 'words' }] });
    expect(r.fichas.map((f) => f.id)).toEqual(['m-a']);
    expect(r.erros[0].erros[0]).toMatch(/ja dividido/);
  });
});

