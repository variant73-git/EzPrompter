const path = require('path');

// Security response headers applied to every route. Defence-in-depth
// against XSS, clickjacking, MIME sniffing, and unwanted referrer/origin
// leakage. CSP is intentionally permissive in dev (Next.js needs eval +
// inline for HMR) and tightens in production.
const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // microphone=(self) — the chat docks' speech-to-text button records
    // via MediaRecorder on our own origin (PromptDock + canvas editor).
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  // Content-Security-Policy is the heavy hitter. We allow:
  //   - 'self' for almost everything (own origin + Next.js assets)
  //   - inline styles (Tailwind + dynamic Aeonik font + framer-motion)
  //   - data: URLs for images (we store assets as base64 dataUrls)
  //   - blob: for File objects (chat attachments)
  //   - https: for LLM provider streams + Stripe + analytics
  //   - 'unsafe-eval' is required for Next dev HMR but stripped in prod
  // Anything outside this list is blocked by the browser, including
  // injected <script src=//attacker.com>.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'") + ' https://js.stripe.com',
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.stripe.com https://*.upstash.io",
      "frame-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the isolated motion-editor dev server to run beside the main shell
  // without both Next processes invalidating the same development cache.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Force the workspace root to the monorepo root so Next doesn't pick up
  // a stray lockfile in $HOME and trace the whole home directory (which
  // hangs the dev server for minutes on first compile).
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
