/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep local demo recordings visually identical to production. Build and
  // runtime failures still surface in the terminal and error boundary.
  devIndicators: false,

  // The dashboard is a pure client of the backend API. Keeping the base URL in
  // an env var lets the same build point at a local worker or a deployed one,
  // and keeps every Bright Data credential on the server side where it belongs.
  // A hosting dashboard stores a blank field as an empty string rather than
  // leaving the variable unset, and `??` does not fall back on an empty
  // string. Normalise here so the inlined value is never blank.
  env: {
    NEXT_PUBLIC_NOTICE_API_BASE:
      process.env.NEXT_PUBLIC_NOTICE_API_BASE?.trim() || 'http://localhost:4000',
  },

  // Security headers live here rather than in a host config file so they apply
  // identically in local development, in CI and on whatever host runs this.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
