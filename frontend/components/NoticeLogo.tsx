export function NoticeLogo({ className = 'w-5 h-5 text-black' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer target C-bracket */}
      <path
        d="M47.5 13.5A25 25 0 1 0 47.5 50.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Inner sensor circle */}
      <circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" strokeWidth="5" />
      {/* Reticle ticks */}
      <path
        d="M32 7v7M32 50v7M7 32h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Verification checkmark */}
      <path
        d="m23 32 7 7 15-15"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Signal dot */}
      <rect x="52" y="29" width="7" height="7" fill="currentColor" rx="1" />
    </svg>
  );
}
