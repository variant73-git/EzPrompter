/** @type {import('next').NextConfig} */
const nextConfig = {
  // Temporarily off while we debug the editor-core mount path. The mount
  // logic IS strict-mode-safe (deferred teardown) but we want to isolate
  // strict-mode interactions from the editor's own init bugs.
  reactStrictMode: false,
};

module.exports = nextConfig;
