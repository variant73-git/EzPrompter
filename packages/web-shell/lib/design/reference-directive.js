/**
 * O plano do banco de referências vira instrução de geração.
 *
 * O banco escolhe QUAIS referências e o papel de cada uma; o house-style diz
 * COMO absorver uma referência (bloco ABSORB) e o que nunca fazer (guardrails).
 * As duas fontes se encontram aqui, e é aqui que se declara quem manda em quê.
 *
 * ⚠️ DEIXAR O CONFLITO AMBÍGUO NÃO É NEUTRALIDADE. Uma referência pode
 * legitimamente usar uma fonte banida ou preto puro. Sem uma regra escrita, o
 * modelo resolve por conta — e de um jeito diferente a cada geração. Uma
 * comparação entre "com banco" e "sem banco" mediria esse sorteio em vez de
 * medir as duas fontes. Por isso a autoridade é declarada POR DIMENSÃO: a
 * referência manda na forma, os guardrails mandam no acabamento, e um pedido
 * explícito do usuário ganha dos dois (mesma regra que o verificador já usa).
 */

export const REFERENCE_AUTHORITY = [
  'AUTHORITY — when the reference and the design guardrails disagree, they do not compete for the same decision:',
  '- The reference is the authority for structure, scale, rhythm and proportion: section topology, reading order, type and media scale, spacing cadence, density, responsive behaviour.',
  '- The guardrails are the authority for typeface, colour and the banned details: which faces and palettes are allowed, and the specific treatments that are never used.',
  '- An explicit request from the user beats both. An instruction the user overrode was never a violation.',
  '- Borrow the reference\'s proportions; never borrow its brand. Identity, copy and imagery always come from the graph.',
].join('\n');

export const CURATOR_GUIDANCE_POLICY = [
  'SCOPE: apply this policy only when the user asked to build from a prompt and the product selected references implicitly from the curated bank. Do not apply it to a direct reference supplied by the user.',
  'CURATOR COMMENTS ARE SEMANTIC DESIGN INSTRUCTIONS, NOT A LITERAL DELETE LIST:',
  '- Read the complete comment before acting. A comment may combine rationale, conditions, exceptions, things to preserve, and several requested changes in natural language.',
  '- “Context for model” is semantically neutral free-form guidance. It may explain what works, what should change, why, conditions, exceptions, or several directions at once. Do not assume it means preserve.',
  '- “Avoid” is an organization hint for concerns, not a literal delete command. The semantic meaning of each clause decides whether to preserve, adapt, replace, or remove something.',
  '- Infer each instruction from the meaning of its clause in the context of the target brief, target evidence, and observed reference composition. Do not use exact-phrase, keyword, substring, or language-specific matching.',
  '- For each instruction, reason about: the referenced page role or treatment; the requested action; what purpose must survive; what implementation must change; why; and under which conditions. Keep this interpretation grounded in the original comment.',
  '- Unless the comment explicitly removes a section from the product narrative, preserve the section\'s job and required content capacity while replacing the rejected visual or structural treatment.',
  '- Therefore a contextual sentence that includes “use other hero” or “usar outro hero” means: keep a hero that performs the target\'s opening job, reject this reference\'s hero solution, and choose a materially different hero suited to the target. The surrounding explanation remains relevant to choosing that replacement.',
  '- Deleting the hero, merely recolouring it, lightly restyling the same composition, or ignoring the rest of the comment does not satisfy that instruction.',
  '- When an approved supporting reference is available, use only the bounded section named in its evidence and record that provenance. A supporting reference never becomes a second page-wide chassis.',
  '- When no supporting reference is supplied, create a different solution from the target\'s intent, truthful content, identity, media, and responsive needs. Never pretend that an unsupplied bank reference was consulted.',
].join('\n');

/** Está o banco valendo nesta execução? Serve para rotular uma comparação. */
export function referencesMode(env = process.env) {
  return String(env.UNCRAFT_REFERENCES || '').trim().toLowerCase() === 'off' ? 'off' : 'on';
}

export function referencesEnabled(env = process.env) {
  return referencesMode(env) === 'on';
}

function bloco(titulo, itens) {
  const lista = (itens || []).filter(Boolean);
  return lista.length ? `${titulo}\n${lista.map((i) => `- ${i}`).join('\n')}` : '';
}

/**
 * @param plan  o plano de `createReferencePlan` (schemaVersion 3)
 * @param opts  { evidence: { [referenceId]: { sections, typeScale, mediaRatios } } }
 *              medidas da referência capturada. Sem elas, a referência é só um
 *              nome — e o texto diz isso em vez de fingir orientação.
 */
export function buildReferenceDirective(plan, opts = {}) {
  const referencias = plan?.selectedReferences || [];
  if (!referencias.length) return '';
  const evidencia = opts.evidence || {};

  const partes = ['REFERENCE DIRECTION (from the curated reference bank)'];
  if (plan.rule) partes.push(plan.rule);

  referencias.forEach((referencia, indice) => {
    const papel = referencia.scaleOwner ? 'scale owner' : 'section source';
    const linhas = [
      `${indice + 1}. ${referencia.title} — ${papel}`,
      `   url: ${referencia.url}`,
      `   governs: ${referencia.owns}`,
    ];
    if (referencia.reasons?.length) linhas.push(`   chosen because: ${referencia.reasons.join('; ')}`);
    if (referencia.guidance?.worthBorrowing) linhas.push(`   curator comment — context for model: ${referencia.guidance.worthBorrowing}`);
    if (referencia.guidance?.avoid) linhas.push(`   curator comment — concerns or changes: ${referencia.guidance.avoid}`);
    const medida = evidencia[referencia.id];
    if (medida) {
      if (medida.sections?.length) linhas.push(`   measured sections: ${medida.sections.join(', ')}`);
      if (medida.typeScale?.length) linhas.push(`   measured type scale: ${medida.typeScale.join(' · ')}`);
      if (medida.mediaRatios?.length) linhas.push(`   measured media ratios: ${medida.mediaRatios.join(' · ')}`);
    } else {
      // Dizer que não há medida é orientação melhor do que silêncio: o modelo
      // fica sabendo que o nome não vem acompanhado de forma observada.
      linhas.push(`   no measured evidence for ${referencia.title} — treat the role above as the whole instruction, do not invent its look`);
    }
    partes.push(linhas.join('\n'));
  });

  partes.push(bloco('PRESERVE from the reference', plan.composition?.preserve));
  partes.push(bloco('ADAPT from the supporting references', plan.composition?.adapt));
  partes.push(bloco('REPLACE with the graph\'s own material', plan.composition?.replace));
  if (plan.selectionMode !== 'direct-url') partes.push(CURATOR_GUIDANCE_POLICY);
  partes.push(REFERENCE_AUTHORITY);
  partes.push(bloco('WARNINGS from the planner', plan.warnings));

  return partes.filter(Boolean).join('\n\n');
}
