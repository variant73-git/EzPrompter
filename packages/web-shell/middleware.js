import { NextResponse } from 'next/server';
import { decideHostRouting } from './lib/runtime-host-guard.js';

// Host guard do runtime por sessão (plano lease B, Task 10): request cujo host
// casa `<nonce>.<UNCRAFT_RUNTIME_HOST_SUFFIX>` só alcança rotas de runtime;
// em produção o host do app recusa as rotas exclusivas de runtime. Sem sufixo
// configurado o guard é inerte (dev de host único, comportamento atual).
//
// ⚠️ A verdade do host é o HEADER — em `next dev` o origin de `request.url`
// reporta sempre localhost (lição 167).
export function middleware(request) {
  const decision = decideHostRouting({
    host: request.headers.get('host') || '',
    pathname: request.nextUrl.pathname,
    suffix: process.env.UNCRAFT_RUNTIME_HOST_SUFFIX || '',
    production: process.env.NODE_ENV === 'production',
  });
  if (decision === 'block') return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}

export const config = {
  // Estáticos do Next ficam fora do guard (custo zero onde não há decisão).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
