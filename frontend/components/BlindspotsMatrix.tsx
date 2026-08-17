interface SurfaceEntry {
  id: string;
  surface: string;
  category: string;
  answers: string;
  silent: string;
}

const SURFACES: SurfaceEntry[] = [
  {
    id: 'web_access',
    surface: 'Web Access Dashboard',
    category: 'TRAFFIC',
    answers: 'Requests delivered, bytes moved, credits spent.',
    silent: 'Which of those responses carried the wrong field.',
  },
  {
    id: 'event_log',
    surface: 'Event & Error Log',
    category: 'STATUS CODES',
    answers: 'A request that errored, timed out, or was blocked.',
    silent: 'A request that succeeded through a drifted selector.',
  },
  {
    id: 'scrapers_library',
    surface: 'Scrapers Library',
    category: 'RECIPES',
    answers: 'Domains Bright Data maintains for you.',
    silent: 'The custom collector you built, which is not on that list.',
  },
  {
    id: 'self_healing',
    surface: 'Self-Healing Engine',
    category: 'REPAIR',
    answers: 'Repairs an extraction template, once you trigger it.',
    silent: 'That it needed repairing in the first place.',
  },
  {
    id: 'discover_api',
    surface: 'Discover API',
    category: 'INDEXER',
    answers: 'Which URLs exist for a query.',
    silent: 'Whether what you extracted from one of them is true.',
  },
];

export function BlindspotsMatrix() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden font-mono text-[12px] shadow-sm">
      {/* Header Bar */}
      <div className="hidden lg:grid grid-cols-[1.1fr_1.4fr_1.5fr] bg-gray-50 border-b border-gray-200 px-5 py-2.5 text-[10.5px] font-neuebit uppercase tracking-[0.14em] text-gray-500 font-bold">
        <div>SURFACE</div>
        <div className="flex items-center gap-1.5 text-emerald-800">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          WHAT PASSES GREEN IN ACCOUNT
        </div>
        <div className="flex items-center gap-1.5 text-red-700">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          WHAT IT IS SILENT ON (CAUGHT BY NOTICE)
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-100">
        {SURFACES.map((row, idx) => (
          <div
            key={row.id}
            className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr_1.5fr] px-5 py-3 gap-2 lg:gap-4 items-center hover:bg-gray-50/60 transition-colors"
          >
            {/* Surface */}
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-[10px] select-none">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="font-semibold text-gray-900 text-[12.5px] whitespace-nowrap">
                {row.surface}
              </span>
              <span className="text-[9px] font-neuebit uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200 ml-auto lg:ml-0">
                {row.category}
              </span>
            </div>

            {/* What Passes Green */}
            <div className="flex items-center gap-2 text-gray-700">
              <span className="text-emerald-600 font-bold text-[11px] shrink-0">✓</span>
              <span className="leading-snug">{row.answers}</span>
            </div>

            {/* Silent Blindspot */}
            <div className="flex items-center gap-2 text-red-700 bg-red-50/50 lg:bg-transparent p-2 lg:p-0 rounded border border-red-100 lg:border-0">
              <span className="text-red-600 font-bold text-[11px] shrink-0">✕</span>
              <span className="font-medium leading-snug">{row.silent}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Compact Footer Strip */}
      <div className="px-5 py-2.5 bg-gray-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-neuebit text-[9.5px] uppercase tracking-[0.14em] px-1.5 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-500/40 rounded">
            ✦ DUAL SENSOR
          </span>
          <span className="text-gray-300">
            Holds selector results against Web Unlocker markdown ground-truth.
          </span>
        </div>
        <span className="text-gray-400 font-semibold text-[10.5px]">
          100% BLINDSPOT COVERAGE
        </span>
      </div>
    </div>
  );
}
