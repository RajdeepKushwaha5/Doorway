/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Bright Data must be able to fetch these pages, and the collector must see
  // the current mode rather than a cached earlier one. Every DriftMart
  // response is explicitly uncacheable for that reason.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
