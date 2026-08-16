import Link from 'next/link';

export function NoticeLogo({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className={`notice-logo ${inverse ? 'is-inverse' : ''}`} aria-label="NOTICE home">
      <svg viewBox="0 0 48 48" role="img" aria-label="NOTICE verified signal mark">
        <path
          d="M38.25 8.75A20 20 0 1 0 38.25 39.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.25"
          strokeLinecap="round"
        />
        <circle cx="24" cy="24" r="12.25" fill="none" stroke="currentColor" strokeWidth="3.25" />
        <path d="M24 4v5M24 39v5M4 24h5" fill="none" stroke="currentColor" strokeWidth="3.25" strokeLinecap="round" />
        <path
          d="m16.75 24.25 5.25 5.5L34.25 17.5"
          fill="none"
          stroke={inverse ? '#171714' : '#FF5A36'}
          strokeWidth="4.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="40.5" y="21.5" width="5" height="5" fill={inverse ? '#FFFEFB' : '#FF5A36'} />
      </svg>
      {compact ? null : <span>NOTICE</span>}
    </Link>
  );
}
