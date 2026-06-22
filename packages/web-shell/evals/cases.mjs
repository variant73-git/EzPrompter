// Eval cases for the BOARD_AGENT operator, generated from a compact behaviour
// spec. Promptfoo loads this via `tests: file://./cases.mjs`.
//
// WHY a generator instead of inline YAML: robustness comes from testing each
// expected DECISION across many PHRASINGS (paraphrase robustness) — a real user
// never phrases things the canonical way. Here a behaviour is declared once with
// its phrasings; the loop expands it into one promptfoo case per phrasing. Add a
// phrasing → one line. Add a behaviour → one block.
//
// Run 4×/case for stable rates (promptfoo --repeat 4); temp-0 is not fully
// deterministic for these models. This tests the FIRST move only (single-shot
// harness). Full-chain sequencing + the no-loop/memory behaviour need a
// multi-turn harness (not built yet).

// Reusable context prefixes (active selection / board state), mirroring what the
// real route injects (board summary + active-node hint).
const CTX = {
  selSite:     '[The user SELECTED this node: site "landing" nodeId=l1, has result.]',
  selFintech:  '[The user SELECTED this node: site "fintech" nodeId=f1, has result.]',
  selImg:      '[Active node: image asset "ref" nodeId=i1 assetId=A1.]',
  selPrompt:   '[Active node: prompt "tom de voz" nodeId=p1.]',
  twoSites:    '[Board has 2 nodes: "Site A" (site, has result) id=a1; "Site B" (site, has result) id=b1.]',
  threeSites:  '[Board has 3 nodes: "Loja" (site, has result) id=x1; "Blog" (site, has result) id=x2; "Portfolio" (site, has result) id=x3.]',
  twoImgs:     '[Board has 2 nodes: image "base" nodeId=i1 assetId=A1; image "ref" nodeId=i2 assetId=A2.]',
  workflowTerm:'[Active workflow: "img flow" — 3 nodes.]\n[Terminal of this workflow: nodeId=t1 assetId=AX prompt="warmer palette".]',
  empty:       '',
};

// Assertion shorthands.
const any = (...v) => ({ type: 'icontains-any', value: v });
const has = (v)    => ({ type: 'icontains', value: v });
const not = (v)    => ({ type: 'not-icontains', value: v });

// Each behaviour = one expected decision, tested across several phrasings.
const BEHAVIOURS = [
  // ── Type vocabulary: design-spec artifacts → design-system node, NEVER prompt ──
  {
    id: 'type-vocab-designmd',
    ctx: 'selSite',
    assert: [any('extractDesign', 'design-system', 'designmd'), not('type: "prompt"')],
    phrasings: [
      'crie um design system a partir desse site',
      'extrai o design system desse site',
      'gera o .md de design desse site',
      'quero o style guide desse site',
      'salva os design tokens desse site',
    ],
  },
  {
    id: 'type-vocab-designmd-en',
    ctx: 'selSite',
    assert: [any('extractDesign', 'design-system', 'designmd'), not('type: "prompt"')],
    phrasings: [
      'create a design system from this site',
      "extract this site's design tokens",
    ],
  },

  // ── Style transfer (Site → .md → Site): extract/apply, not raw editSite ──
  {
    id: 'style-transfer',
    ctx: 'twoSites',
    assert: [any('extractDesign', 'applyDesign'), not('editSite')],
    phrasings: [
      'transfira o estilo do site A pro site B',
      'deixa o site B com a cara do site A',
      'aplica o visual do A no B',
      'copia o estilo do A pro B',
    ],
  },

  // ── Skeleton edits (add/remove elements) → editSite, not a node ──
  {
    id: 'skeleton-editsite',
    ctx: 'selSite',
    assert: [has('editSite'), not('createNode')],
    phrasings: [
      'adiciona uma seção de pricing depois do hero',
      'remove o rodapé',
      'adiciona um botão de contato no topo',
      'tira a terceira seção',
    ],
  },

  // ── Qualitative direction → prompt node (variable), not editSite ──
  {
    id: 'qualitative-prompt-node',
    ctx: 'selSite',
    assert: [any('createNode', 'prompt', 'variável'), not('editSite')],
    phrasings: [
      'deixa a comunicação mais sofisticada e premium',
      'deixa o tom mais divertido e jovem',
      'quero uma vibe mais minimalista e elegante',
    ],
  },

  // ── Ambiguity (nothing selected, multiple sites, vague) → ASK ──
  {
    id: 'ask-ambiguous',
    ctx: 'threeSites',
    assert: [any('ASK', 'qual')],
    phrasings: ['deixa mais escura', 'muda a cor principal', 'aumenta o título'],
  },
  {
    id: 'ask-ambiguous-en',
    ctx: 'threeSites',
    assert: [any('ASK', 'which', 'qual')],
    phrasings: ['make it darker', 'change the main color'],
  },

  // ── Selected + referential → ACT, don't ask (the no-loop case) ──
  {
    id: 'act-when-selected',
    ctx: 'selSite',
    assert: [not('ASK'), any('editSite', 'updateNode', 'createNode')],
    phrasings: ['deixa mais escura', 'muda a cor principal pra azul', 'aumenta o título do hero'],
  },

  // ── New-vs-continue trap (selected site + new-scope build) → ASK ──
  {
    id: 'new-vs-continue',
    ctx: 'selFintech',
    assert: [any('ASK', 'adiciona', 'nova', 'separ', 'outro')],
    phrasings: [
      'crie uma página de pricing',
      'agora faz uma página de contato',
      'monta uma página de planos',
    ],
  },

  // ── Build from an image: take a build step, don't stall ──
  {
    id: 'build-from-image',
    ctx: 'selImg',
    assert: [not('ASK'), any('createNode', 'blank-website', 'runFlow', 'editSite', 'extractDesign', 'applyDesign', 'captureUrl')],
    phrasings: [
      'crie um site a partir dessa imagem',
      'monta um site com essa imagem de referência',
      'transforma essa imagem num site',
    ],
  },

  // ── Clone / capture a live URL → captureUrl ──
  {
    id: 'clone-url',
    ctx: 'empty',
    assert: [has('captureUrl')],
    phrasings: ['clona o site stripe.com', 'captura https://linear.app', 'recria o site apple.com'],
  },

  // ── Generate an image → createImage ──
  {
    id: 'generate-image',
    ctx: 'empty',
    assert: [has('createImage')],
    phrasings: [
      'crie uma imagem de um gato astronauta',
      'gera uma ilustração de uma montanha ao pôr do sol',
      'faz uma foto de um café aconchegante',
    ],
  },

  // ── Image-to-image / style on an image → createImage (with base) / applyDesign ──
  {
    id: 'image-to-image',
    ctx: 'twoImgs',
    assert: [any('createImage', 'applyDesign'), not('editSite')],
    phrasings: ['aplica o estilo da ref na base', 'deixa a imagem base com o visual da ref'],
  },

  // ── Vague spatial pointing resolves via exploration, don't ask ──
  {
    id: 'vague-pointing',
    ctx: 'twoImgs',
    assert: [not('qual imagem'), any('findNearest', 'listBoard', 'viewNode', 'createImage', 'applyDesign')],
    phrasings: ['aplica o estilo dessa imagem na outra'],
  },

  // ── Don't refuse — find the multi-step sequence ──
  {
    id: 'dont-refuse-sequence',
    ctx: 'empty',
    assert: [not('desculpe'), not('não consigo'), any('captureUrl', 'extractDesign', 'createNode', 'applyDesign')],
    phrasings: ['pega o estilo do site stripe.com e aplica numa landing nova minha'],
  },

  // ── Delete the selected node, no question ──
  {
    id: 'delete-selected',
    ctx: 'selPrompt',
    assert: [has('deleteNode'), has('p1'), not('qual node')],
    phrasings: ['apaga esse node', 'deleta esse node', 'remove esse node'],
  },

  // ── Re-run a workflow terminal in place → replaceAssetId ──
  {
    id: 'rerun-in-place',
    ctx: 'workflowTerm',
    assert: [has('replaceAssetId'), not('createNode')],
    phrasings: ['refaz com o mesmo prompt', 'roda de novo igual', 'gera de novo nesse mesmo node'],
  },
];

const tests = [];
for (const b of BEHAVIOURS) {
  for (const [i, msg] of b.phrasings.entries()) {
    const ctx = CTX[b.ctx] ?? '';
    const user = ctx ? `${ctx}\n\n${msg}` : msg;
    tests.push({
      description: `${b.id} [${i + 1}/${b.phrasings.length}] — ${msg.slice(0, 48)}`,
      vars: { user },
      assert: b.assert,
    });
  }
}

export default tests;
