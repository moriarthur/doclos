const withNextIntl = require('next-intl/plugin');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        // P2-11 (audit): no longer hardcoded — deployable via BACKEND_ORIGIN
        destination: `${process.env.BACKEND_ORIGIN || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = withNextIntl('./src/i18n/request.ts')(nextConfig);
