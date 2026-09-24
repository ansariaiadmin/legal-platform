/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

const nextConfig = {
  output: 'standalone',
  // Public CLIENT surface lives on its OWN server (ADR-015) — the lawyer's
  // office dashboard (apps/web) is a different origin entirely. Same-origin
  // /api rewrites keep the mobile preview host working with zero localhost.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` }];
  },
};

module.exports = nextConfig;
