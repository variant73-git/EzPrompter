import { chromium as chromiumPadrao } from 'playwright-core';

// Sessão EMPRESTADA (spec 2026-09-08 §4.4): quem chama recebe o contexto e a
// página onde a liberação da verificação vive — contexto novo a descartaria.
// Ao sair, só DESCONECTA o cliente; liberar a sessão no vendor é
// responsabilidade do job (REQUEST_RELEASE em todo estado terminal).
export async function withBorrowedSession(connectUrl, fn, { connect } = {}) {
  const conectar = connect || ((ws) => chromiumPadrao.connectOverCDP(ws));
  const browser = await conectar(connectUrl);
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    return await fn({ browser, context, page, owned: false });
  } finally {
    // Num navegador CONECTADO (não lançado), close() apenas desconecta.
    await browser.close().catch(() => {});
  }
}
