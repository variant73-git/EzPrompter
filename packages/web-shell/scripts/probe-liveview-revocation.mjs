// PORTÃO DE LANÇAMENTO (spec 2026-09-08 §4.6): antes de expor o modo humano,
// PROVAR se o Browserbase revoga o controle de um visualizador JÁ ABERTO.
// Sem revogação real, UNCRAFT_CHALLENGE_HUMAN fica 0 em produção — o modo
// humano é uma capacidade de controle remoto, não só um iframe.
//
// Roda SÓ com BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID no ambiente.
// Uso: node scripts/probe-liveview-revocation.mjs
import { chromium } from 'playwright-core';
import { challengeVendorFromEnv } from '../lib/challenge/vendor.js';

// Funciona com qualquer fornecedor (UNCRAFT_CHALLENGE_VENDOR=browserbase|steel).
const client = challengeVendorFromEnv(process.env);
if (!client) { console.error('BLOQUEADO: nenhum fornecedor configurado (defina UNCRAFT_CHALLENGE_VENDOR + a chave: STEEL_API_KEY, ou BROWSERBASE_API_KEY+PROJECT_ID).'); process.exit(2); }
const log = (...a) => console.log(...a);

const session = await client.createSession({ targetUrl: 'https://example.com/', jobId: 'probe-revocation' });
log('sessão criada:', session.id, 'expira', session.expiresAt);

// 1) O produtor conecta e navega (o "dono").
const owner = await chromium.connectOverCDP(session.connectUrl);
const ctx = owner.contexts()[0] || await owner.newContext();
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://example.com/', { waitUntil: 'load' });

// 2) O visualizador (o que a pessoa veria no iframe) — abrimos num Chromium
//    local para MEDIR se ele controla a sessão.
const live = await client.liveUrls(session.id);
const viewerUrl = live.pages[0]?.debuggerFullscreenUrl;
log('visualizador:', viewerUrl ? 'obtido' : 'AUSENTE');
const local = await chromium.launch({ headless: true });
const viewer = await (await local.newContext()).newPage();
await viewer.goto(viewerUrl, { waitUntil: 'load' }).catch((e) => log('viewer goto falhou:', e.message));

async function ownerUrl() { try { return await page.evaluate(() => location.href); } catch { return '(sem contexto)'; } }

// CONTROLE POSITIVO: o visualizador consegue navegar a sessão?
log('\n[controle] url do dono antes:', await ownerUrl());
// (Interação real exigiria dirigir o iframe do viewer; aqui registramos que o
//  viewer CARREGOU. O passo manual — clicar dentro do viewer e ver a sessão
//  mover — deve ser feito por quem roda o probe e anotado no finding.)

// 3) TESTE A: depois de uma checagem NOSSA (reconecta + desconecta), o viewer
//    ainda controla?
log('\n[A] reconectando como servidor (check) e desconectando…');
const checker = await chromium.connectOverCDP(session.connectUrl);
await checker.close();
log('[A] viewer ainda aberto — anote manualmente se ainda controla a sessão.');

// 4) TESTE B: depois de REQUEST_RELEASE, o viewer ainda controla?
log('\n[B] REQUEST_RELEASE na sessão…');
await client.releaseSession(session.id);
await new Promise((r) => setTimeout(r, 3000));
log('[B] url do dono após release:', await ownerUrl());
log('[B] viewer: anote se a URL do visualizador ainda responde/controla.');

await local.close().catch(() => {});
await owner.close().catch(() => {});
log('\nVEREDITO: preencher no finding. Se o viewer controla após (A) ou (B),');
log('não há revogação real → UNCRAFT_CHALLENGE_HUMAN permanece 0 em produção.');
