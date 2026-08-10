import { mergeReferenceAppearances } from './reference-bank-ingest.js';
import { REVIEWED_PROMOTION_VERSION, sha256, stableStringify } from './reference-bank-promotion.js';
import { getReferenceTagPreset } from './reference-design-taxonomy.js';
import { referencePrivacy } from './reference-privacy.js';

export const USER_CALIBRATION_SOURCE = Object.freeze({
  id: 'user-calibration',
  name: 'User calibration',
  homepageUrl: null,
});

export const USER_CALIBRATION_GENERATED_AT = '2026-08-05T16:30:00.000Z';

export const USER_CALIBRATION_REFERENCES = Object.freeze([
  { url: 'https://fancy.design', title: 'FANCY', description: 'Design subscription service for digital products, branding, illustration, and motion.', thumbnailUrl: 'https://fancy.design/img/cover.en.jpg' },
  { url: 'https://www.biograph.com', title: 'Biograph', description: 'Preventive health and longevity through advanced diagnostics.', thumbnailUrl: 'https://framerusercontent.com/assets/oICpnNIL620fWUfoJiM3ozB4Ghw.png' },
  { url: 'https://bynar.io', title: 'Bynario', description: 'Autonomous vulnerability detection and remediation.', thumbnailUrl: 'https://framerusercontent.com/images/1LKAfHjrSxUeOoRzxxTDj3Xx4E.png' },
  { url: 'https://wonder.design', title: 'Wonder', description: 'A design canvas for generating and editing interfaces with code context.', thumbnailUrl: 'https://wonder.design/opengraph-image.jpg' },
  { url: 'https://reflect.app', title: 'Reflect Notes', description: 'A minimalist note-taking application with native AI.', thumbnailUrl: 'https://site.reflect.app/home/build/q-11289093.jpeg' },
  { url: 'https://stripe.com', title: 'Stripe', description: 'Financial infrastructure for payments, billing, and money movement.', thumbnailUrl: 'https://images.stripeassets.com/fzn2n1nzq965/XtX984S1GJVsVOXFC7kMu/01988281e867728dfb09aa7793a6e3b9/Stripe.jpg?q=80' },
  { url: 'https://retool.com', title: 'Retool', description: 'A platform for building and managing internal software.', thumbnailUrl: 'https://retool-dot-com.s3.us-west-2.amazonaws.com/page-assets/homepage/homepage-meta-image.png' },
  { url: 'https://neverhack.com', title: 'NEVERHACK', description: 'Sovereign AI infrastructure and cybersecurity expertise.', thumbnailUrl: 'https://neverhack.com/images/meta-image.png' },
  { url: 'https://www.langchain.com', title: 'LangChain', description: 'Engineering platform for building, testing, and deploying AI agents.', thumbnailUrl: 'https://cdn.prod.website-files.com/65b8cd72835ceeacd4449a53/69a1e9409d6b1c287c69da0d_Website%20preview.png' },
  { url: 'https://mosa-ai.nextjsshop-preview.workers.dev', title: 'Mosa AI', description: 'A personal AI assistant for knowledge work.', thumbnailUrl: null },
  { url: 'https://assetx-ivory.vercel.app', title: 'AssetX', description: 'Customer intelligence for sales teams.', thumbnailUrl: null },
  { url: 'https://brand.ai', title: 'brand.ai', description: 'AI that turns brand guidelines into operational brand intelligence.', thumbnailUrl: 'https://cdn.sanity.io/images/3zwn2ers/fullsite/1e9606e67a676cbdfd3d4d66f10f4184e9bf7c8f-1800x942.png?w=1200&auto=format' },
  { url: 'https://pt.squarespace.com', title: 'Squarespace', description: 'Website building, domains, templates, and business tools.', thumbnailUrl: 'http://static1.pt.squarespace.com/static/5134cbefe4b0c6fb04df8065/t/6a5677ad697cb96ab1e4da62/1784051629926/2025-homepage-thumbnail.png?format=1500w' },
  { url: 'https://io.net', title: 'io.net', description: 'Distributed GPU infrastructure for AI workloads.', thumbnailUrl: 'https://io.net/images/share-card.png' },
  { url: 'https://paperclip.ing', title: 'Paperclip', description: 'Management and governance for teams of AI agents.', thumbnailUrl: 'https://paperclip.ing/og-v4.jpg' },
  { url: 'https://lambda.ai', title: 'Lambda', description: 'Cloud GPU infrastructure for training and scaling AI.', thumbnailUrl: 'https://lambda.ai/hubfs/OPENGRAPH%20-%20Main-1.png' },
  { url: 'https://www.sanity.io', title: 'Sanity', description: 'Content infrastructure for web, mobile, and agentic applications.', thumbnailUrl: 'https://cdn.sanity.io/images/3do82whm/next/f21df064721ee7867372278bcbd0de4b512de556-1200x630.png' },
  { url: 'https://www.cantor8.io', title: 'Cantor8', description: 'Enterprise infrastructure for institutional digital asset operations.', thumbnailUrl: 'https://cdn.prod.website-files.com/697b3b78220c15e1a8ecaeb2/6a061a72b192c4393899d092_Home.avif' },
  { url: 'https://www.hartmanncapital.com', title: 'Hartmann Capital', description: 'Early-stage investment in frontier technology.', thumbnailUrl: 'https://cdn.prod.website-files.com/66c31377d57fee80e2d1cf4d/66d87a1557e3d03cc5123c8c_meta-image.webp' },
  { url: 'https://mindmarket.com', title: 'MindMarket', description: 'A qualitative consumer research agency.', thumbnailUrl: 'https://www.datocms-assets.com/166003/1761505974-meta_og.png?auto=format&fit=max&w=1200' },
  { url: 'https://mammothmurals.com', title: 'Mammoth Murals', description: 'A mural agency creating large-scale hand-painted brand work.', thumbnailUrl: 'https://cdn.prod.website-files.com/6870db6428fa0046e4e9dc88/6891bcd318dbac62ec34157c_Opengraph.jpg' },
  { url: 'https://litebox.ai', title: 'Litebox', description: 'Branding, engineering, and growth for technology startups.', thumbnailUrl: 'https://litebox.ai/assets/images/og/home.png' },
  { url: 'https://outfit.hellohello.is', title: 'OUTFIT', description: 'An apparel store and signature collection by hellohello.', thumbnailUrl: 'https://outfit.hellohello.is/opengraph-image.png' },
  { url: 'https://www.supersolid.agency', title: 'Supersolid', description: 'An independent creative agency in Sydney.', thumbnailUrl: 'https://cdn.prod.website-files.com/680244911c3d7d28354cb55b/687f338f12f9f5113124c508_Supersolid%20Social%20Share%20Image.jpg' },
  { url: 'https://artefakt.mov', title: 'Artefakt', description: 'A hybrid production company exploring unconventional commercial work.', thumbnailUrl: 'https://artefakt.mov/wp-content/uploads/2025/12/OG-Screen.jpg' },
  { url: 'https://mikkisindhunata.com', title: 'Mikki Sindhunata', description: 'Film direction and movement-led visual storytelling.', thumbnailUrl: 'https://mikkisindhunata.com/wp-content/uploads/2025/05/share-image.jpg' },
  { url: 'https://bymonolog.com', title: 'MONOLOG', description: 'Brand and web design for established creative companies.', thumbnailUrl: 'https://cdn.prod.website-files.com/68b652bbd6c64a44c8fe3e5e/6a4df8b2aef24dbe74b85600_OG.jpg' },
  { url: 'https://studiodialect.com', title: 'Studio Dialect', description: 'An interactive production studio intersecting culture and technology.', thumbnailUrl: 'https://cdn.sanity.io/images/z4rfkkmu/production/b8e40f674150cdb8b89a35bb3cc8150a8b60dead-1200x630.png?w=1200&h=630&fit=crop&auto=format&q=80' },
  { url: 'https://buckssauce.com', title: "Buck's Sauce", description: 'Small-batch barbecue sauce made with real ingredients.', thumbnailUrl: 'https://images.prismic.io/buckssauce/aaHgvcFoBIGEg8Hc_hf_20260227_163946_335a9ad0-a5cb-46d4-aa4f-f10aa97e0510.png?auto=format%2Ccompress&rect=0%2C118%2C2528%2C1327&w=2400&h=1260' },
  { url: 'https://www.quantumbody.io', title: 'Quantum Body', description: 'Wellness at the intersection of modern science and ancient wisdom.', thumbnailUrl: 'https://cdn.prod.website-files.com/65807f25030919fa712d502a/67af363bcb0b5e76511d4720_CoverQB.avif' },
  { url: 'https://www.farmminerals.com/products/croptab', title: 'CropTab — Farm Minerals', description: 'A low-carbon NPK fertilizer tablet.', thumbnailUrl: 'https://cdn.prod.website-files.com/68b5b8542c5c0a63b1d91b3b/692eea42f243abbe58327bf3_croptab_badge.png' },
  { url: 'https://www.palantir.com/platforms/foundry', title: 'Palantir Foundry', description: 'An ontology and AI-powered operating system for enterprise operations.', thumbnailUrl: 'https://www.palantir.com/assets/xrfr7uokpv1b/5MGQnj3IDJpURPzBDnXklZ/b7eed64a4f71a959250e19ec76bdf5de/Palantir_Chevron.png' },
  { url: 'https://ref.digital', title: 'REF Digital', description: 'A digital agency balancing quick wins and durable growth.', thumbnailUrl: 'https://a.storyblok.com/f/285561750510308/1200x639/961a9ae422/og-image-en.jpg' },
  { url: 'https://aptosnetwork.com', title: 'Aptos Network', description: 'A Layer 1 blockchain for builders, users, and enterprises.', thumbnailUrl: 'https://aptosnetwork.com/api/og-card.png' },
  { url: 'https://www.apollo.io/pt', title: 'Apollo', description: 'An AI sales platform for prospecting, lead generation, and automation.', thumbnailUrl: 'https://www.apollo.io/og-images/home.jpg' },
  { url: 'https://applace.io', title: 'Applace', description: 'A mobile-first company building and acquiring subscription applications.', thumbnailUrl: 'https://c-p.rmcdn.net/5ab177b8765f0500807e1497/2659259/Screenshot-99c2f3fa-5b46-4302-a0a9-22f23db52c8b_readyscr_1024.jpg' },
  { url: 'https://getanchor.co', title: 'Anchor', description: 'Infrastructure for building and scaling financial products.', thumbnailUrl: 'https://uploads-ssl.webflow.com/64fb1d435c8fcad199f146be/653fb963ca10da336ea9c4fb_anchor-opengraph.png' },
  { url: 'https://ideogram.ai', title: 'Ideogram', description: 'An open visual intelligence model for products, agents, and creative teams.', thumbnailUrl: 'https://storage.googleapis.com/ideogram-static/website/images/ba16d402d8d0b906.jpeg' },
  {
    url: 'https://agentflow.framer.ai',
    title: 'AgentFlow',
    description: 'AI agent and workflow automation platform.',
    thumbnailUrl: 'https://framerusercontent.com/images/pdk43ZuPcK5Ygz94pHnuw98ea0.png',
    templatePlatform: 'framer',
    templateListingUrl: 'https://www.framer.com/community/marketplace/templates/agentflow/',
  },
]);

export function buildUserCalibrationCatalog() {
  const merged = mergeReferenceAppearances(USER_CALIBRATION_REFERENCES.map((reference) => {
    const preset = getReferenceTagPreset(reference.url);
    return {
      ...reference,
      categories: preset?.productTypes || [],
      tags: [...(preset?.styleTags || []), ...(preset?.brandAttributes || [])],
      featured: false,
      source: {
        id: USER_CALIBRATION_SOURCE.id,
        name: USER_CALIBRATION_SOURCE.name,
        listingUrl: reference.templateListingUrl || reference.url,
        recordId: reference.url,
        taxonomy: {
          submittedBy: 'user',
          purpose: 'taste-calibration',
          submittedAt: '2026-08-05',
          ...(reference.templatePlatform ? {
            recordType: 'template',
            templatePlatform: reference.templatePlatform,
          } : {}),
        },
      },
    };
  }), USER_CALIBRATION_GENERATED_AT);

  const references = merged.map((reference) => {
    const privacy = referencePrivacy(reference);
    return {
      id: reference.id,
      canonicalUrl: reference.url,
      host: reference.host,
      title: reference.title,
      description: reference.description,
      thumbnailUrl: reference.thumbnailUrl || null,
      categories: reference.categories,
      tags: reference.tags,
      editorialConsensus: 1,
      curationWeight: '1',
      featured: false,
      isPrivate: privacy.isPrivate,
      privacyReason: privacy.privacyReason,
      templatePlatform: privacy.templatePlatform,
      publishedAt: null,
      generatedAt: USER_CALIBRATION_GENERATED_AT,
      availabilityStatus: 'available',
      lifecycleState: 'listed',
      analysisStatus: 'listed',
    };
  }).sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));

  const appearances = merged.map((reference) => ({
      referenceSiteId: reference.id,
      sourceId: USER_CALIBRATION_SOURCE.id,
      sourceName: USER_CALIBRATION_SOURCE.name,
      sourceRecordId: reference.url,
      listingUrl: reference.sources?.[0]?.taxonomy?.recordType === 'template'
        ? reference.sources[0].listingUrl
        : reference.url,
      detailUrl: reference.sources?.[0]?.detailUrl || null,
      thumbnailUrl: reference.thumbnailUrl || null,
      sourceTaxonomy: reference.sources?.[0]?.taxonomy || {
        submittedBy: 'user',
        purpose: 'taste-calibration',
        submittedAt: '2026-08-05',
      },
    })).sort((a, b) => a.referenceSiteId.localeCompare(b.referenceSiteId));

  const base = {
    version: REVIEWED_PROMOTION_VERSION,
    references,
    appearances,
    aggregators: [USER_CALIBRATION_SOURCE],
    expected: { references: USER_CALIBRATION_REFERENCES.length, appearances: USER_CALIBRATION_REFERENCES.length },
  };
  return { ...base, catalogSha256: sha256(stableStringify(base)) };
}
