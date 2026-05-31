const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Force the workspace root to the monorepo root so Next doesn't pick up
  // a stray lockfile in $HOME and trace the whole home directory (which
  // hangs the dev server for minutes on first compile).
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

module.exports = nextConfig;
