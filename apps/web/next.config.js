/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // Browser only ever sees SAME-ORIGIN /api/* on the Next host; the remote
    // preview proxy therefore works without any localhost coupling. The live
    // SSE dashboard feed goes through /stream/events (a route handler, NOT
    // under /api, so it never collides with this rewrite) because EventSource
    // cannot set Authorization headers — the handler injects the token.
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
