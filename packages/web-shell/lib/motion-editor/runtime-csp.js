// UMA política estruturada gerando o HEADER e a META injetada no HTML do
// clone. Antes eram duas listas à mão (route.js × native-clone-gateway.js) e
// elas DIVERGIRAM — o header tinha `worker-src`, a meta não (spec 2026-08-25
// §5). Políticas múltiplas se INTERSECTAM: uma meta mais frouxa não relaxa o
// header, mas a fonte dupla é como a divergência nasce. Aqui a divergência
// morre por construção: as duas formas serializam do MESMO objeto.
//
// `frame-ancestors` existe SÓ no header — a diretiva não tem efeito em meta
// (CSP3) e listá-la lá seria ruído com cara de proteção.

const RUNTIME_POLICY = Object.freeze([
  ['default-src', "'self' data: blob:"],
  ['script-src', "'self' 'unsafe-inline' 'unsafe-eval' blob:"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
  ['media-src', "'self' data: blob:"],
  ['connect-src', "'self'"],
  ['worker-src', "'self' blob:"],
  ['form-action', "'none'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
]);

function serialize(extra = []) {
  return [...RUNTIME_POLICY, ...extra].map(([directive, value]) => `${directive} ${value}`).join('; ');
}

export function runtimeCspHeader({ frameAncestor } = {}) {
  if (typeof frameAncestor !== 'string' || !frameAncestor) {
    throw new TypeError('runtimeCspHeader requires a frameAncestor source');
  }
  return serialize([['frame-ancestors', frameAncestor]]);
}

export function runtimeCspMeta() {
  return serialize();
}

// DETECÇÃO, nunca mutação: uma meta CSP AUTORAL no HTML servido intersecta com
// a nossa política e pode bloquear o bridge (CSPs múltiplas nunca se relaxam).
// Regex aqui só ACENDE UM AVISO — falso positivo num comentário custa uma
// linha de log; reescrever o HTML por regex é a classe proibida (lições
// 163/164). A neutralização real espera a lane do tokenizer HTML.
const AUTHORED_CSP_META = /<meta(?![^>]*\bdata-uncraft-runtime-policy\b)[^>]*http-equiv\s*=\s*["']?content-security-policy\b/i;

export function htmlCarriesAuthoredCspMeta(html) {
  return AUTHORED_CSP_META.test(String(html || ''));
}
