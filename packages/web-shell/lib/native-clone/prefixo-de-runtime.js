// Que diretorio do pacote o gateway sabe TRADUZIR para o prefixo da sessao (/api/rt/<id>, /api/runtime/<token>).
// Regra UNICA: o gateway (rewriteRuntimePaths) filtra por ela, e o produtor so preserva uma referencia na forma
// da raiz quando o diretorio passa por ela — senao a referencia escaparia do prefixo (Astra, 2026-10-05:
// `/static.v1/app.js` sairia na raiz e o gateway, que nao traduz nome com ponto, a deixaria dar 404).
export function prefixoTraduzivel(nome) { return /^[a-zA-Z0-9_-]+$/.test(String(nome)); }
