export function BrightDataLogo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Bright Data Blue Favicon Square */}
      <rect width="24" height="24" rx="5" fill="#4B77FA" />
      {/* White 'i' Dot */}
      <circle cx="12" cy="7" r="1.8" fill="white" />
      {/* White 'i' Stem with subtle classic serif details */}
      <path
        d="M10.8 11.2C10.8 10.7582 11.1582 10.4 11.6 10.4H12.4C12.8418 10.4 13.2 10.7582 13.2 11.2V17C13.2 17.4418 12.8418 17.8 12.4 17.8H11.6C11.1582 17.8 10.8 17.4418 10.8 17V11.2Z"
        fill="white"
      />
      <rect x="9.8" y="17.2" width="4.4" height="1" rx="0.5" fill="white" />
    </svg>
  );
}

export function BrightDataBadge({
  text = 'Built with Bright Data',
  href = 'https://brightdata.com/',
  className = '',
}: {
  text?: string;
  href?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-[11px] font-mono text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg shadow-sm transition-all group ${className}`}
    >
      <BrightDataLogo className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
      <span className="leading-none">
        {text.includes('Bright Data') ? (
          <>
            {text.replace('Bright Data', '')}
            <strong className="text-gray-900 group-hover:text-black">Bright Data</strong>
          </>
        ) : (
          text
        )}
      </span>
      <span className="text-gray-400 text-[10px] group-hover:text-gray-900 transition-colors">↗</span>
    </a>
  );
}
