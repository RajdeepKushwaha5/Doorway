import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DriftMart',
  description:
    'A controlled fault-injection target used to demonstrate NOTICE. Not a real store, and not a real product.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem' }}>
        {/* Stated on every page, deliberately. A judge opening this URL should
            never be able to mistake it for a real storefront, and neither
            should anyone who finds it later. */}
        <p
          style={{
            background: '#fff3cd',
            border: '1px solid #ffe69c',
            padding: '0.75rem 1rem',
            borderRadius: 6,
            fontSize: 14,
            marginBottom: '1.5rem',
          }}
        >
          <strong>Test fixture.</strong> DriftMart is a controlled fault-injection target built to
          demonstrate the NOTICE project. It is not a real store, nothing here is for sale, and its
          failures are deliberately injected rather than spontaneous.
        </p>
        {children}
      </body>
    </html>
  );
}
