/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

// The client portal is served under /portal on the same domain as the office
// dashboard; nginx routes /portal to this app and /api to the API.
const nextConfig = {
  output: 'standalone',
  basePath: '/portal',
  // Canonical URLs end in "/" so the service worker scope (/portal/) and the
  // manifest start_url cover the home page.
  trailingSlash: true,
  async rewrites() {
    // Development only: in production nginx sends /api to the API directly.
    return [{ source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*`, basePath: false }];
  },
};

module.exports = nextConfig;
