function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fold(value) {
  return clean(value, 12000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function option(id, label, description) {
  return { id, label, description };
}

function selectedOption(question, selections) {
  const requested = clean(selections?.[question.id], 80);
  return question.options.some((candidate) => candidate.id === requested) ? requested : question.recommended;
}

function requestedPalette(prompt) {
  return [...new Set(String(prompt || '').match(/#[0-9a-fA-F]{6}\b/g) || [])].map((color) => color.toUpperCase()).slice(0, 8);
}

export function inferTargetStrategy({ prompt = '', evidence = {}, manifest = {}, selections = {} } = {}) {
  const sourceText = fold([
    prompt,
    evidence.brand,
    evidence.title,
    evidence.description,
    ...(evidence.headings || []),
    ...(evidence.callsToAction || []),
  ].join(' '));
  const signals = {
    modernize: /modern|melhor|atualiz|refresh|releit|antig|velh|trend|contempor/.test(sourceText),
    seasonal: /natal|christmas|fim de ano|final de ano|holiday|season|festiv/.test(sourceText),
    social: /amig|friend|grupo|group|convite|invite|comunidade|community|famil|equipe|team|pessoa|people|user|usuario/.test(sourceText),
    playful: /brinc|jogo|game|play|divertid|fun|alegr|joy|presente|gift/.test(sourceText),
    analogToDigital: /papel|paper|online|digital|site|app|um toque|one click/.test(sourceText),
    commerce: /compr|buy|produto|product|preco|price|vitrine|market|loja|store/.test(sourceText),
  };

  const questions = [{
    id: 'identityDistance',
    label: 'How far should the refresh move from the current identity?',
    why: 'This decides whether detected colors and typography are inherited, evolved, or replaced.',
    recommended: signals.modernize ? 'evolve' : 'preserve',
    options: [
      option('evolve', 'Evolve it', 'Keep recognition, reinterpret the visual system.'),
      option('preserve', 'Stay familiar', 'Modernize layout while retaining the current identity.'),
      option('reinvent', 'Reimagine it', 'Keep semantic truth but establish a new visual identity.'),
    ],
  }];

  if (signals.seasonal) {
    questions.push({
      id: 'seasonality',
      label: 'How literal should the seasonal association feel?',
      why: 'A familiar ritual can feel warm without repeating the category’s most obvious symbols.',
      recommended: 'translated',
      options: [
        option('translated', 'Translated', 'Keep warmth and recognition through indirect cues.'),
        option('literal', 'Recognizable', 'Use clearer seasonal color and imagery.'),
        option('evergreen', 'Evergreen', 'Remove seasonal cues from the core identity.'),
      ],
    });
  } else {
    questions.push({
      id: 'energy',
      label: 'How expressive should the new surface feel?',
      why: 'The answer controls color range, density, and the prominence of interface metaphors.',
      recommended: signals.playful ? 'controlled' : 'quiet',
      options: [
        option('controlled', 'Controlled play', 'Expressive moments inside a trustworthy system.'),
        option('quiet', 'Quiet confidence', 'Restrained color and low visual noise.'),
        option('expressive', 'Highly expressive', 'A bold palette and more graphic presence.'),
      ],
    });
  }

  if (signals.social) {
    questions.push({
      id: 'representation',
      label: 'What should make the people behind the experience visible?',
      why: 'This determines whether community is represented through real people, identity tokens, or product UI.',
      recommended: 'people-system',
      options: [
        option('people-system', 'People as a system', 'Portraits or avatars combined with circles, names, and relationships.'),
        option('identity-tokens', 'Identity tokens', 'Initials, pills, and abstract avatars without photography.'),
        option('interface-first', 'Interface first', 'Show the workflow and keep people mostly implicit.'),
      ],
    });
  }

  const selected = Object.fromEntries(questions.map((question) => [question.id, selectedOption(question, selections)]));
  const palette = requestedPalette(prompt);
  const hypotheses = [];
  if (signals.modernize) hypotheses.push({
    id: 'recognizable-modernization',
    conclusion: 'Modernize the reading, not the product’s identity.',
    because: ['The target is the semantic authority.', 'The prompt asks for improvement rather than a different product.'],
  });
  if (signals.seasonal) hypotheses.push({
    id: 'seasonal-translation',
    conclusion: 'Translate the seasonal warmth instead of illustrating it literally.',
    because: ['The occasion is part of the product context.', 'A contemporary refresh should avoid the category’s default visual shorthand.'],
  });
  if (signals.playful) hypotheses.push({
    id: 'controlled-play',
    conclusion: 'Use play as punctuation, not as the entire tone.',
    because: ['The experience is a game or ritual.', 'Trust and broad usability rule out an overly childish treatment.'],
  });
  if (signals.social) hypotheses.push({
    id: 'visible-participation',
    conclusion: 'Make participation visible through a repeatable identity system.',
    because: ['Groups and people are central to the target content.', 'Reusable tokens can represent changing participants without fixing the design to one group.'],
  });
  if (signals.analogToDigital) hypotheses.push({
    id: 'digital-ritual',
    conclusion: 'Express the analog ritual with native digital grammar.',
    because: ['The target explicitly moves an offline action online.', 'Pills, tags, links, and directional controls can carry meaning rather than decoration.'],
  });

  const identity = selected.identityDistance;
  const seasonal = selected.seasonality;
  const representation = selected.representation;
  const suggestions = [
    {
      id: 'color',
      label: 'Color strategy',
      proposal: palette.length
        ? `Use the supplied palette ${palette.join(', ')} as the exact starting system.`
        : seasonal === 'translated'
          ? 'Evolve the inherited brand hue into a broader, nonliteral seasonal palette with one warm and one fresh counterpoint.'
          : identity === 'preserve'
            ? 'Keep the detected target colors and improve hierarchy through proportion and contrast.'
            : 'Build a new palette from the target’s most recognizable inherited hue rather than category defaults.',
      because: palette.length ? 'The user supplied explicit color tokens.' : 'The target remains recognizable while the visual reading becomes current.',
    },
    {
      id: 'typography',
      label: 'Typography strategy',
      proposal: signals.seasonal || signals.playful
        ? 'Pair a warm, familiar display voice with a neutral interface face for tasks and data.'
        : 'Retain a clear interface face and introduce contrast only where it strengthens hierarchy.',
      because: 'Warmth belongs in expressive moments; operational clarity belongs in the product layer.',
    },
    {
      id: 'visual-language',
      label: 'Visual language',
      proposal: representation === 'people-system'
        ? 'Use people in circular identity frames, name pills, and directional circle controls to show who is connected to whom.'
        : representation === 'identity-tokens'
          ? 'Use initials, pills, tags, and directional controls as a flexible identity grammar.'
          : signals.analogToDigital
            ? 'Use interface states and directional controls to make the digital workflow visible.'
            : 'Let the selected chassis carry composition while target-specific elements remain functional.',
      because: signals.analogToDigital
        ? 'The visual system explains how a formerly analog exchange now travels through a digital product.'
        : 'The metaphor stays tied to the product rather than becoming decoration.',
    },
  ];

  const directives = suggestions.map((suggestion) => `${suggestion.label}: ${suggestion.proposal}`);
  const mediaPlan = representation === 'people-system'
    ? { mode: 'original-people', status: 'planned', label: 'Original people or avatars will be sourced or generated during the separately quoted execution.' }
    : representation === 'identity-tokens'
      ? { mode: 'graphic-identities', status: 'planned', label: 'Graphic identity tokens are an approved substitute for photography.' }
      : { mode: evidence.counts?.media > 0 ? 'target-media' : 'interface-only', status: 'planned', label: evidence.counts?.media > 0 ? 'Use compatible media already present in the target.' : 'The approved direction does not require new photography.' };

  return {
    schemaVersion: 1,
    prompt: clean(prompt, 2000),
    signals,
    hypotheses,
    questions: questions.map((question) => ({ ...question, selected: selected[question.id] })),
    selected,
    suggestions,
    directives,
    mediaPlan,
    suppliedPalette: palette,
    referenceBoundary: {
      source: manifest.reference?.url || null,
      rule: 'The selected bank reference supplies the chassis only. Target truth and this approved strategy supply identity and treatment.',
    },
  };
}
