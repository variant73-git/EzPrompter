#!/usr/bin/env node
/**
 * Brand Contact Finder
 * Busca emails de CEOs e Marketing de grandes marcas via Hunter.io ou Apollo.io
 *
 * Uso:
 *   node brand-contacts.js --hunter YOUR_API_KEY
 *   node brand-contacts.js --apollo YOUR_API_KEY
 *   node brand-contacts.js --hunter KEY1 --apollo KEY2   (ambos)
 */

const fs = require('fs');
const path = require('path');

// ── Brands database with domains ──────────────────────────────────────────────
const BRANDS = [
  // Cervejas
  { brand: 'Heineken', domain: 'heineken.com.br', parent: 'Heineken Group' },
  { brand: 'Amstel', domain: 'amstel.com.br', parent: 'Heineken Group' },
  { brand: 'Eisenbahn', domain: 'eisenbahn.com.br', parent: 'Heineken Group' },
  { brand: 'Sol', domain: 'heineken.com.br', parent: 'Heineken Group' },
  { brand: 'Blue Moon', domain: 'bluemoonbrewingcompany.com', parent: 'Molson Coors' },
  { brand: 'Lagunitas', domain: 'lagunitas.com', parent: 'Heineken Group' },
  { brand: 'Budweiser', domain: 'budweiser.com.br', parent: 'Ambev' },
  { brand: 'Bud Zero', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Brahma', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Skol', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Spaten', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Stella Artois', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Corona', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Devassa', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Itaipava', domain: 'itaipava.com.br', parent: 'Grupo Petrópolis' },
  { brand: 'Bohemia', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Original', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Petra', domain: 'grupopetropolis.com.br', parent: 'Grupo Petrópolis' },

  // Energéticos e Refrigerantes
  { brand: 'Kuat', domain: 'coca-colabrasil.com.br', parent: 'Coca-Cola Brasil' },
  { brand: 'Red Bull', domain: 'redbull.com', parent: 'Red Bull GmbH' },
  { brand: 'Monster Energy', domain: 'monsterenergy.com', parent: 'Monster Beverage' },
  { brand: 'TNT Energy', domain: 'tnt.energy', parent: 'Grupo Petrópolis' },
  { brand: 'Reign', domain: 'reignbodyfuel.com', parent: 'Monster Beverage' },
  { brand: 'Fusion', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Coca-Cola', domain: 'coca-colabrasil.com.br', parent: 'Coca-Cola Brasil' },
  { brand: 'Pepsi', domain: 'pepsico.com.br', parent: 'PepsiCo Brasil' },
  { brand: 'Guaraná Antarctica', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'H2OH!', domain: 'ambev.com.br', parent: 'Ambev' },
  { brand: 'Lipton Ice Tea', domain: 'pepsico.com.br', parent: 'PepsiCo Brasil' },

  // Bancos
  { brand: 'Itaú', domain: 'itau.com.br', parent: 'Itaú Unibanco' },
  { brand: 'Bradesco', domain: 'bradesco.com.br', parent: 'Bradesco' },
  { brand: 'Santander', domain: 'santander.com.br', parent: 'Santander Brasil' },
  { brand: 'Nubank', domain: 'nubank.com.br', parent: 'Nu Holdings' },
  { brand: 'BTG Pactual', domain: 'btgpactual.com', parent: 'BTG Pactual' },
  { brand: 'Banco do Brasil', domain: 'bb.com.br', parent: 'Banco do Brasil' },
  { brand: 'Caixa Econômica Federal', domain: 'caixa.gov.br', parent: 'CEF' },
  { brand: 'Banco Inter', domain: 'inter.co', parent: 'Inter & Co' },
  { brand: 'C6 Bank', domain: 'c6bank.com.br', parent: 'C6 Bank' },
  { brand: 'XP Inc.', domain: 'xpinc.com', parent: 'XP Inc.' },

  // Telecom
  { brand: 'Vivo', domain: 'vivo.com.br', parent: 'Telefônica Brasil' },
  { brand: 'TIM', domain: 'tim.com.br', parent: 'TIM Brasil' },
  { brand: 'Claro', domain: 'claro.com.br', parent: 'América Móvil' },
  { brand: 'Oi', domain: 'oi.com.br', parent: 'Oi S.A.' },

  // Streaming
  { brand: 'Spotify', domain: 'spotify.com', parent: 'Spotify AB' },
  { brand: 'Deezer', domain: 'deezer.com', parent: 'Deezer' },
  { brand: 'Apple Music', domain: 'apple.com', parent: 'Apple Inc.' },
  { brand: 'Amazon Music', domain: 'amazon.com.br', parent: 'Amazon' },
  { brand: 'YouTube Music', domain: 'google.com', parent: 'Alphabet' },
  { brand: 'Globoplay', domain: 'globo.com', parent: 'Grupo Globo' },
  { brand: 'Netflix', domain: 'netflix.com', parent: 'Netflix Inc.' },
  { brand: 'Prime Video', domain: 'amazon.com.br', parent: 'Amazon' },
  { brand: 'Disney+', domain: 'disney.com', parent: 'The Walt Disney Company' },
  { brand: 'Paramount+', domain: 'paramount.com', parent: 'Paramount Global' },
  { brand: 'Max', domain: 'wbd.com', parent: 'Warner Bros. Discovery' },

  // Automotivo
  { brand: 'Volkswagen', domain: 'vw.com.br', parent: 'Volkswagen Brasil' },
  { brand: 'Fiat', domain: 'fiat.com.br', parent: 'Stellantis' },
  { brand: 'Chevrolet', domain: 'chevrolet.com.br', parent: 'General Motors Brasil' },
  { brand: 'Toyota', domain: 'toyota.com.br', parent: 'Toyota Brasil' },
  { brand: 'Renault', domain: 'renault.com.br', parent: 'Renault Brasil' },
  { brand: 'Jeep', domain: 'jeep.com.br', parent: 'Stellantis' },
  { brand: 'Land Rover', domain: 'landrover.com.br', parent: 'JLR' },
  { brand: 'Mitsubishi', domain: 'mitsubishimotors.com.br', parent: 'Mitsubishi Motors' },

  // Tech / Mobile
  { brand: 'Samsung', domain: 'samsung.com.br', parent: 'Samsung Electronics' },
  { brand: 'Apple', domain: 'apple.com', parent: 'Apple Inc.' },
  { brand: 'Motorola', domain: 'motorola.com.br', parent: 'Lenovo' },
  { brand: 'Xiaomi', domain: 'xiaomi.com.br', parent: 'Xiaomi' },
  { brand: 'LG', domain: 'lg.com.br', parent: 'LG Electronics' },

  // Fast Food
  { brand: "McDonald's", domain: 'mcdonalds.com.br', parent: "Arcos Dorados" },
  { brand: 'Burger King', domain: 'burgerking.com.br', parent: 'Zamp (BK Brasil)' },
  { brand: 'Giraffas', domain: 'giraffas.com.br', parent: 'Giraffas' },

  // Alimentos
  { brand: 'Sadia', domain: 'bfrisco.com.br', parent: 'BRF' },
  { brand: 'Perdigão', domain: 'bfrisco.com.br', parent: 'BRF' },
  { brand: 'Seara', domain: 'seara.com.br', parent: 'JBS' },

  // Moda / Esporte
  { brand: 'Nike', domain: 'nike.com.br', parent: 'Nike Inc.' },
  { brand: 'Adidas', domain: 'adidas.com.br', parent: 'Adidas AG' },
  { brand: 'Puma', domain: 'puma.com', parent: 'Puma SE' },
  { brand: 'New Balance', domain: 'newbalance.com.br', parent: 'New Balance' },
  { brand: 'Reserva', domain: 'reserva.com.br', parent: 'Arezzo&Co' },
  { brand: 'Farm', domain: 'farmrio.com.br', parent: 'Grupo Soma' },
  { brand: 'Riachuelo', domain: 'riachuelo.com.br', parent: 'Grupo Guararapes' },
  { brand: 'C&A', domain: 'cea.com.br', parent: 'C&A Brasil' },
  { brand: 'Renner', domain: 'lojasrenner.com.br', parent: 'Lojas Renner' },
  { brand: 'Chilli Beans', domain: 'chillibeans.com.br', parent: 'Chilli Beans' },

  // Delivery
  { brand: 'iFood', domain: 'ifood.com.br', parent: 'iFood' },
  { brand: 'Rappi', domain: 'rappi.com.br', parent: 'Rappi' },
  { brand: 'Uber Eats', domain: 'uber.com', parent: 'Uber' },
  { brand: '99Food', domain: '99app.com', parent: 'DiDi Global' },
  { brand: 'Keeta', domain: 'keeta.com', parent: 'Keeta' },

  // Whisky / Gin
  { brand: 'Johnnie Walker', domain: 'diageo.com', parent: 'Diageo' },
  { brand: "Jack Daniel's", domain: 'brown-forman.com', parent: 'Brown-Forman' },
  { brand: 'Jameson', domain: 'pernod-ricard.com', parent: 'Pernod Ricard' },
  { brand: "Ballantine's", domain: 'pernod-ricard.com', parent: 'Pernod Ricard' },
  { brand: 'Jim Beam', domain: 'beamsuntory.com', parent: 'Beam Suntory' },
  { brand: 'Tanqueray', domain: 'diageo.com', parent: 'Diageo' },
  { brand: "Hendrick's", domain: 'williamgrant.com', parent: 'William Grant & Sons' },
  { brand: 'Bulldog', domain: 'camparigroup.com', parent: 'Campari Group' },

  // Seguros / Saúde
  { brand: 'Porto Seguro', domain: 'portoseguro.com.br', parent: 'Porto Seguro' },
  { brand: 'Tokio Marine', domain: 'tokiomarine.com.br', parent: 'Tokio Marine' },
  { brand: 'SulAmérica', domain: 'sulamerica.com.br', parent: 'Rede D\'Or' },
  { brand: 'Prudential', domain: 'prudential.com.br', parent: 'Prudential Financial' },
  { brand: 'MetLife', domain: 'metlife.com.br', parent: 'MetLife Inc.' },
  { brand: 'Unimed', domain: 'unimed.coop.br', parent: 'Unimed' },
  { brand: 'Hapvida', domain: 'hapvida.com.br', parent: 'Hapvida NotreDame' },
  { brand: 'Amil', domain: 'amil.com.br', parent: 'UnitedHealth Group' },
  { brand: 'Prevent Senior', domain: 'preventsenior.com.br', parent: 'Prevent Senior' },

  // Combustível
  { brand: 'Ipiranga', domain: 'ipiranga.com.br', parent: 'Ultrapar' },
  { brand: 'Shell', domain: 'shell.com.br', parent: 'Shell Brasil' },
  { brand: 'Raízen', domain: 'raizen.com.br', parent: 'Raízen' },
  { brand: 'Petrobras', domain: 'petrobras.com.br', parent: 'Petrobras' },

  // Beleza
  { brand: 'Natura', domain: 'natura.com.br', parent: 'Natura &Co' },
  { brand: 'O Boticário', domain: 'grupoboticario.com.br', parent: 'Grupo Boticário' },
  { brand: 'Sallve', domain: 'sallve.com.br', parent: 'Sallve' },
  { brand: 'Grupo Boticário', domain: 'grupoboticario.com.br', parent: 'Grupo Boticário' },

  // Apostas
  { brand: 'Superbet', domain: 'superbet.com', parent: 'Superbet Group' },
  { brand: 'Betnacional', domain: 'betnacional.com', parent: 'NSX Group' },
  { brand: 'Betano', domain: 'betano.com', parent: 'Kaizen Gaming' },
  { brand: 'Esportes da Sorte', domain: 'esportesdasorte.com', parent: 'Esportes da Sorte' },
  { brand: 'Sportingbet', domain: 'sportingbet.com', parent: 'Entain' },
  { brand: 'H2Bet', domain: 'h2bet.com', parent: 'H2Bet' },
  { brand: 'VBet', domain: 'vbet.com', parent: 'BetConstruct' },
  { brand: 'Blaze', domain: 'blaze.com', parent: 'Prolific Trade' },
  { brand: 'Bet7k', domain: 'bet7k.com', parent: 'Bet7k' },
  { brand: 'Alfabet', domain: 'alfabet.com', parent: 'Alfabet' },
  { brand: 'Stake', domain: 'stake.com', parent: 'Medium Rare N.V.' },
  { brand: 'EstrelaBet', domain: 'estrelabet.com', parent: 'EstrelaBet' },
  { brand: 'KTO', domain: 'kto.com', parent: 'KTO Group' },
  { brand: 'bet365', domain: 'bet365.com', parent: 'bet365 Group' },
  { brand: 'Galera.bet', domain: 'galera.bet', parent: 'Galera.bet' },

  // Varejo / Snacks
  { brand: 'Havan', domain: 'havan.com.br', parent: 'Havan' },
  { brand: 'Doritos', domain: 'pepsico.com.br', parent: 'PepsiCo Brasil' },
  { brand: 'KitKat', domain: 'nestle.com.br', parent: 'Nestlé Brasil' },
  { brand: 'Trident', domain: 'mondelezinternational.com', parent: 'Mondelez' },
  { brand: 'Club Social', domain: 'mondelezinternational.com', parent: 'Mondelez' },
  { brand: 'Olla', domain: 'olla.com.br', parent: 'Reckitt' },

  // Mobilidade
  { brand: 'Localiza', domain: 'localiza.com', parent: 'Localiza' },
  { brand: 'Movida', domain: 'movida.com.br', parent: 'Movida' },
  { brand: 'LATAM', domain: 'latamairlines.com', parent: 'LATAM Airlines' },
  { brand: 'Gol', domain: 'voegol.com.br', parent: 'Gol Linhas Aéreas' },
  { brand: 'Azul', domain: 'voeazul.com.br', parent: 'Azul S.A.' },

  // Fintech / Pagamentos
  { brand: 'Cielo', domain: 'cielo.com.br', parent: 'Cielo' },
  { brand: 'Mercado Pago', domain: 'mercadopago.com.br', parent: 'Mercado Livre' },
  { brand: 'PicPay', domain: 'picpay.com', parent: 'PicPay' },
  { brand: 'iFood Benefícios', domain: 'ifood.com.br', parent: 'iFood' },

  // Tech / Social
  { brand: 'TikTok', domain: 'tiktok.com', parent: 'ByteDance' },
  { brand: 'Meta', domain: 'meta.com', parent: 'Meta Platforms' },
  { brand: 'OpenAI', domain: 'openai.com', parent: 'OpenAI' },

  // Diversos
  { brand: 'Correios', domain: 'correios.com.br', parent: 'Correios' },
  { brand: 'Colgate', domain: 'colgatepalmolive.com', parent: 'Colgate-Palmolive' },
  { brand: "Hellmann's", domain: 'unilever.com.br', parent: 'Unilever Brasil' },
  { brand: 'Unilever', domain: 'unilever.com.br', parent: 'Unilever Brasil' },
  { brand: 'Axe', domain: 'unilever.com.br', parent: 'Unilever Brasil' },
  { brand: 'Kibon', domain: 'unilever.com.br', parent: 'Unilever Brasil' },
  { brand: 'Estácio', domain: 'estacio.br', parent: 'Yduqs' },
  { brand: 'Braskem', domain: 'braskem.com.br', parent: 'Braskem' },
  { brand: 'Gerdau', domain: 'gerdau.com', parent: 'Gerdau' },
  { brand: 'Vale', domain: 'vale.com', parent: 'Vale S.A.' },
  { brand: 'Neoenergia', domain: 'neoenergia.com', parent: 'Neoenergia' },
  { brand: 'Enel', domain: 'enel.com.br', parent: 'Enel Brasil' },
  { brand: 'Via Mobilidade', domain: 'viamobilidade.com.br', parent: 'CCR' },
  { brand: 'CCR', domain: 'ccr.com.br', parent: 'CCR S.A.' },
];

// ── Deduplicate by domain (many brands share parent company domain) ───────────
function deduplicateByDomain(brands) {
  const seen = new Map();
  for (const b of brands) {
    if (!seen.has(b.domain)) {
      seen.set(b.domain, { ...b, allBrands: [b.brand] });
    } else {
      seen.get(b.domain).allBrands.push(b.brand);
    }
  }
  return Array.from(seen.values());
}

// ── Hunter.io API ─────────────────────────────────────────────────────────────
async function searchHunter(domain, apiKey) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${apiKey}&limit=10&department=executive,management,communication`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 429) return { error: 'rate_limit', emails: [] };
      if (res.status === 401) return { error: 'invalid_key', emails: [] };
      return { error: err.errors?.[0]?.details || res.statusText, emails: [] };
    }
    const data = await res.json();
    const emails = (data.data?.emails || []).map(e => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      position: e.position || '',
      department: e.department || '',
      confidence: e.confidence,
      source: 'hunter.io',
    }));
    const pattern = data.data?.pattern;
    return { emails, pattern, organization: data.data?.organization };
  } catch (err) {
    return { error: err.message, emails: [] };
  }
}

// ── Apollo.io API ─────────────────────────────────────────────────────────────
async function searchApollo(domain, apiKey) {
  const url = 'https://api.apollo.io/v1/mixed_people/search';
  const titles = [
    'CEO', 'CMO', 'Chief Marketing Officer', 'Chief Executive Officer',
    'VP Marketing', 'Head of Marketing', 'Marketing Director',
    'Diretor de Marketing', 'Diretor Executivo',
  ];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        api_key: apiKey,
        q_organization_domains: domain,
        person_titles: titles,
        page: 1,
        per_page: 10,
      }),
    });
    if (!res.ok) {
      if (res.status === 429) return { error: 'rate_limit', contacts: [] };
      if (res.status === 401) return { error: 'invalid_key', contacts: [] };
      return { error: res.statusText, contacts: [] };
    }
    const data = await res.json();
    const contacts = (data.people || []).map(p => ({
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      email: p.email || '',
      title: p.title || '',
      company: p.organization?.name || '',
      linkedin: p.linkedin_url || '',
      source: 'apollo.io',
    }));
    return { contacts };
  } catch (err) {
    return { error: err.message, contacts: [] };
  }
}

// ── CSV export ────────────────────────────────────────────────────────────────
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const hunterKey = args.includes('--hunter') ? args[args.indexOf('--hunter') + 1] : null;
  const apolloKey = args.includes('--apollo') ? args[args.indexOf('--apollo') + 1] : null;
  const dryRun = args.includes('--dry-run');

  if (!hunterKey && !apolloKey) {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║          Brand Contact Finder — Instruções               ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Uso:                                                    ║
║    node brand-contacts.js --hunter SUA_API_KEY           ║
║    node brand-contacts.js --apollo SUA_API_KEY           ║
║    node brand-contacts.js --hunter K1 --apollo K2        ║
║    node brand-contacts.js --dry-run  (lista domínios)    ║
║                                                          ║
║  Como obter API keys (grátis):                           ║
║                                                          ║
║  Hunter.io (25 buscas/mês free):                         ║
║    1. Acesse https://hunter.io/users/sign_up             ║
║    2. Crie conta grátis                                  ║
║    3. Vá em https://hunter.io/api-keys                   ║
║    4. Copie a API key                                    ║
║                                                          ║
║  Apollo.io (10K contatos free):                          ║
║    1. Acesse https://app.apollo.io/#/onboarding          ║
║    2. Crie conta grátis                                  ║
║    3. Vá em Settings → Integrations → API Keys           ║
║    4. Copie a API key                                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`);
    if (!dryRun) process.exit(1);
  }

  const unique = deduplicateByDomain(BRANDS);
  console.log(`\n📋 ${BRANDS.length} marcas → ${unique.length} domínios únicos\n`);

  if (dryRun) {
    console.log('Domínios que serão consultados:\n');
    for (const u of unique) {
      console.log(`  ${u.domain.padEnd(35)} → ${u.allBrands.join(', ')}`);
    }
    console.log(`\nTotal: ${unique.length} requests por API`);
    if (hunterKey) console.log(`⚠️  Hunter.io free = 25 buscas/mês. Serão usadas ${unique.length} buscas.`);
    return;
  }

  const allResults = [];
  let hunterQuota = 0;
  const HUNTER_DELAY = 2200; // ~27 req/min (free tier limit)
  const APOLLO_DELAY = 1100; // ~55 req/min

  for (let i = 0; i < unique.length; i++) {
    const entry = unique[i];
    const progress = `[${i + 1}/${unique.length}]`;
    console.log(`${progress} ${entry.domain} (${entry.allBrands.join(', ')})`);

    // Hunter.io
    if (hunterKey) {
      const h = await searchHunter(entry.domain, hunterKey);
      if (h.error === 'rate_limit') {
        console.log(`  ⚠️  Hunter rate limit — pulando restante do Hunter`);
        // continue with Apollo if available
      } else if (h.error === 'invalid_key') {
        console.log(`  ❌ Hunter API key inválida`);
        break;
      } else {
        hunterQuota++;
        if (h.pattern) console.log(`  🔍 Hunter: padrão = ${h.pattern} | ${h.emails.length} emails`);
        for (const e of h.emails) {
          allResults.push({
            brand: entry.allBrands.join(' / '),
            parent: entry.parent,
            domain: entry.domain,
            name: e.name,
            email: e.email,
            position: e.position,
            department: e.department,
            confidence: e.confidence,
            linkedin: '',
            source: 'hunter.io',
            emailPattern: h.pattern || '',
          });
        }
        if (h.emails.length === 0 && h.pattern) {
          allResults.push({
            brand: entry.allBrands.join(' / '),
            parent: entry.parent,
            domain: entry.domain,
            name: '',
            email: `(padrão: ${h.pattern})`,
            position: '',
            department: '',
            confidence: '',
            linkedin: '',
            source: 'hunter.io',
            emailPattern: h.pattern,
          });
        }
        await sleep(HUNTER_DELAY);
      }
    }

    // Apollo.io
    if (apolloKey) {
      const a = await searchApollo(entry.domain, apolloKey);
      if (a.error === 'rate_limit') {
        console.log(`  ⚠️  Apollo rate limit — esperando 60s...`);
        await sleep(60000);
        // retry once
        const retry = await searchApollo(entry.domain, apolloKey);
        if (!retry.error) {
          for (const c of retry.contacts) {
            allResults.push({
              brand: entry.allBrands.join(' / '),
              parent: entry.parent,
              domain: entry.domain,
              name: c.name,
              email: c.email,
              position: c.title,
              department: '',
              confidence: '',
              linkedin: c.linkedin,
              source: 'apollo.io',
              emailPattern: '',
            });
          }
        }
      } else if (a.error === 'invalid_key') {
        console.log(`  ❌ Apollo API key inválida`);
      } else {
        console.log(`  👤 Apollo: ${a.contacts.length} contatos`);
        for (const c of a.contacts) {
          allResults.push({
            brand: entry.allBrands.join(' / '),
            parent: entry.parent,
            domain: entry.domain,
            name: c.name,
            email: c.email,
            position: c.title,
            department: '',
            confidence: '',
            linkedin: c.linkedin,
            source: 'apollo.io',
            emailPattern: '',
          });
        }
        await sleep(APOLLO_DELAY);
      }
    }
  }

  // ── Save results ────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().slice(0, 10);
  const csvPath = path.join(__dirname, `brand-contacts-${timestamp}.csv`);
  const jsonPath = path.join(__dirname, `brand-contacts-${timestamp}.json`);

  fs.writeFileSync(csvPath, '\uFEFF' + toCSV(allResults), 'utf-8'); // BOM for Excel
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2), 'utf-8');

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                    ✅ Concluído!                         ║
╠══════════════════════════════════════════════════════════╣
║  Total de contatos encontrados: ${String(allResults.length).padEnd(24)}║
║  Domínios consultados:          ${String(unique.length).padEnd(24)}║
${hunterKey ? `║  Hunter.io buscas usadas:       ${String(hunterQuota).padEnd(24)}║\n` : ''}║                                                          ║
║  Arquivos salvos:                                        ║
║    📄 ${csvPath.split('/').pop().padEnd(50)}║
║    📄 ${jsonPath.split('/').pop().padEnd(50)}║
╚══════════════════════════════════════════════════════════╝
`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
