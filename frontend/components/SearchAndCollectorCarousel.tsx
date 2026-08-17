'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface CollectorCardData {
  domain: string;
  subDomain: string;
  icon: string;
  endpointCount: string;
  description: string;
  endpoints: string[];
  tags: string[];
}

const COLLECTORS_DATA: CollectorCardData[] = [
  {
    domain: 'driftmart.com',
    subDomain: 'driftmart-3ut8.onrender.com',
    icon: 'store',
    endpointCount: '03',
    description: 'E-commerce testbed with live price drift, shifted layouts, and deposit mutation fixtures.',
    endpoints: ['get_product_price', 'get_stock_status', 'verify_layout_hash'],
    tags: ['driftmart', 'genuine_price_change', 'shifted_layout', 'deposit'],
  },
  {
    domain: 'books.toscrape.com',
    subDomain: 'books.toscrape.com',
    icon: 'book',
    endpointCount: '04',
    description: 'Bookstore catalog monitoring pricing excl/incl tax, stock counts, and rating changes.',
    endpoints: ['get_book_details', 'get_price_excl_tax', 'get_availability', 'list_categories'],
    tags: ['books.toscrape.com', 'books', 'price', 'stock'],
  },
  {
    domain: 'zillow.com',
    subDomain: 'zillow.com',
    icon: 'home',
    endpointCount: '08',
    description: 'Search for homes for sale, rent, or recently sold listings on Zillow with verified data truth.',
    endpoints: ['search_listings', 'get_property_detail', 'get_price_history'],
    tags: ['zillow', 'real_estate', 'homes', 'pricing'],
  },
  {
    domain: 'fred.stlouisfed.org',
    subDomain: 'fred.stlouisfed.org',
    icon: 'chart',
    endpointCount: '09',
    description: 'Access economic time-series data, interest rates, inflation metrics, and Fed balance sheets.',
    endpoints: ['get_cpi_inflation', 'get_fed_funds_rate', 'get_gdp_growth'],
    tags: ['fred', 'finance', 'rates', 'inflation'],
  },
  {
    domain: 'cmegroup.com',
    subDomain: 'cmegroup.com',
    icon: 'globe',
    endpointCount: '07',
    description: 'Get CME Group market data including FedWatch interest-rate probabilities and futures volume.',
    endpoints: ['get_fedwatch_probabilities', 'get_futures_quotes', 'get_settlement_prices'],
    tags: ['cmegroup', 'derivatives', 'futures', 'markets'],
  },
  {
    domain: 'opentable.com',
    subDomain: 'opentable.com',
    icon: 'dining',
    endpointCount: '05',
    description: 'Search for restaurants across the US with ratings, reviews, seating times, and menu prices.',
    endpoints: ['search_restaurants', 'get_reservation_slots', 'get_menu_pricing'],
    tags: ['opentable', 'resy', 'restaurants', 'reservations'],
  },
  {
    domain: 'maersk.com',
    subDomain: 'maersk.com',
    icon: 'ship',
    endpointCount: '06',
    description: 'Track global ocean cargo containers, vessel routes, estimated port arrival, and customs.',
    endpoints: ['track_container', 'get_vessel_schedule', 'get_port_delays'],
    tags: ['maersk', 'logistics', 'shipping', 'containers'],
  },
  {
    domain: 'dnb.com',
    subDomain: 'dnb.com',
    icon: 'building',
    endpointCount: '03',
    description: "Search millions of companies in Dun & Bradstreet's global business directory.",
    endpoints: ['search_companies', 'get_company_profile', 'lookup_duns_number'],
    tags: ['dnb', 'companies', 'business', 'credit'],
  },
  {
    domain: '5e.tools',
    subDomain: '5e.tools',
    icon: 'cube',
    endpointCount: '04',
    description: 'Search and retrieve D&D 5e game data like races, classes, and spells to power character builders.',
    endpoints: ['get_races', 'get_classes', 'get_spells'],
    tags: ['5e.tools', 'gaming', 'rpg', 'spells'],
  },
];

const POPULAR_TAGS = [
  'driftmart',
  'books.toscrape.com',
  'genuine_price_change',
  'shifted_layout',
  'zillow',
  'resy',
  'amazon reviews',
  'flight prices',
];

export function SearchAndCollectorCarousel() {
  const [query, setQuery] = useState('');

  const filteredCollectors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return COLLECTORS_DATA.filter((item) => {
      return (
        item.domain.toLowerCase().includes(q) ||
        item.subDomain.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.endpoints.some((e) => e.toLowerCase().includes(q))
      );
    });
  }, [query]);

  const isSearching = query.trim().length > 0;

  return (
    <div className="mt-2 space-y-6">
      {/* Live Search Input Form */}
      <div className="relative">
        <div className="flex items-center gap-3 px-4 md:px-5 py-3.5 md:py-4 border border-gray-300 bg-white rounded-[6px] focus-within:border-gray-900 focus-within:ring-1 focus-within:ring-gray-900 transition-all shadow-sm">
          <span className="font-mono text-[18px] text-parse-accent select-none shrink-0">
            ▶
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collectors: domain, endpoint, description, use case..."
            className="flex-1 min-w-0 bg-transparent text-[15px] md:text-[16px] outline-none placeholder:text-gray-400 font-mono py-0.5 text-gray-900"
          />

          {isSearching ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="font-mono text-[11px] uppercase tracking-wider text-gray-400 hover:text-gray-800 font-bold px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              CLEAR ×
            </button>
          ) : (
            <span className="hidden md:inline font-mono text-[10px] text-gray-500 px-1.5 py-0.5 border border-gray-200 rounded-[3px] select-none shrink-0">
              ↵
            </span>
          )}
        </div>

        {/* Quick Tag Pills */}
        <div className="mt-2.5 flex items-center gap-2.5 flex-wrap text-[11px] font-mono">
          <span className="font-neuebit tracking-[0.14em] uppercase text-gray-400">TRY ▸</span>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setQuery(tag)}
              className="text-gray-500 hover:text-emerald-700 hover:underline underline-offset-2 decoration-dotted transition-colors"
            >
              {tag}
            </button>
          ))}

          <span className="ml-auto text-gray-400 hidden md:flex items-center gap-2.5">
            <Link className="text-gray-700 hover:text-emerald-700 underline underline-offset-2" href="/verified">
              Browse all in Verified Feed ▸
            </Link>
            <span className="text-gray-300 select-none">·</span>
            <span>
              not here?{' '}
              <Link className="text-gray-700 hover:text-emerald-700 underline underline-offset-2" href="#control-room">
                register collector ▸
              </Link>
            </span>
          </span>
        </div>
      </div>

      {/* When Searching: Show Real Filtered Cards Grid */}
      {isSearching ? (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="font-neuebit uppercase tracking-[0.16em] text-gray-400 font-bold">
              RELEVANT COLLECTORS FOR &quot;{query}&quot; ({filteredCollectors.length})
            </span>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-gray-500 hover:text-black font-semibold"
            >
              SHOW ALL CAROUSEL →
            </button>
          </div>

          {filteredCollectors.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCollectors.map((item) => (
                <CollectorCard key={item.domain} item={item} showMatchBadge />
              ))}
            </div>
          ) : (
            <div className="p-8 border border-dashed border-gray-300 rounded-xl text-center font-mono text-gray-500 bg-gray-50/50">
              No collectors found matching &quot;{query}&quot;. Try searching for &quot;driftmart&quot;, &quot;books&quot;, or &quot;zillow&quot;.
            </div>
          )}
        </div>
      ) : (
        /* When NOT Searching: Show Smooth Infinite Marquee Carousel */
        <div className="space-y-3 pt-2">
          <div className="font-neuebit text-[11px] uppercase tracking-[0.16em] text-gray-400 flex items-center gap-1.5">
            <span>✦ POPULAR RIGHT NOW</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400 font-normal">HOVER TO PEEK ENDPOINTS, OR SEARCH ABOVE</span>
          </div>

          {/* Marquee Viewport with Edge Fade Mask */}
          <div className="relative overflow-hidden w-full py-1">
            <div className="animate-marquee gap-4 flex items-stretch">
              {/* First Set of Cards */}
              {COLLECTORS_DATA.map((item, idx) => (
                <div key={`c1-${item.domain}-${idx}`} className="w-[320px] sm:w-[350px] shrink-0">
                  <CollectorCard item={item} />
                </div>
              ))}

              {/* Duplicate Set for Seamless Infinite Loop */}
              {COLLECTORS_DATA.map((item, idx) => (
                <div key={`c2-${item.domain}-${idx}`} className="w-[320px] sm:w-[350px] shrink-0">
                  <CollectorCard item={item} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectorCard({
  item,
  showMatchBadge = false,
}: {
  item: CollectorCardData;
  showMatchBadge?: boolean;
}) {
  return (
    <div className="h-full border border-gray-200 hover:border-gray-400 bg-white rounded-xl p-5 flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
      <div className="space-y-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700 shrink-0 border border-gray-200">
              <CollectorIcon icon={item.icon} />
            </span>
            <div className="min-w-0">
              <h4 className="font-mono font-bold text-[14px] text-gray-900 truncate">
                {item.domain}
              </h4>
              <p className="font-mono text-[11px] text-gray-400 truncate">
                {item.subDomain}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="font-mondwest text-[24px] font-bold text-gray-900 leading-none">
              {item.endpointCount}
            </div>
            <div className="font-neuebit text-[8px] uppercase tracking-[0.14em] text-gray-400">
              ENDPOINTS
            </div>
          </div>
        </div>

        {/* Match Tag Badge */}
        {showMatchBadge ? (
          <div className="font-mono text-[9px] uppercase tracking-wider text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded w-fit">
            MATCHED BY DESCRIPTION + ENDPOINT
          </div>
        ) : null}

        {/* Description */}
        <p className="font-mono text-[12px] text-gray-600 leading-relaxed line-clamp-2">
          {item.description}
        </p>
      </div>

      {/* Endpoints Snippet List */}
      <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 font-mono text-[11px]">
        {item.endpoints.slice(0, 3).map((ep) => (
          <Link
            key={ep}
            href="#control-room"
            className="flex items-center justify-between p-1.5 px-2 rounded bg-gray-50/80 hover:bg-gray-100 text-gray-700 group transition-colors"
          >
            <span className="truncate">
              <span className="text-gray-400 text-[10px] uppercase font-bold mr-1">GET</span>{' '}
              {ep}
            </span>
            <span className="font-neuebit text-[9px] uppercase tracking-wider text-gray-400 group-hover:text-emerald-700 shrink-0 ml-2">
              JUMP ▸
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CollectorIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'store':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case 'book':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'home':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'chart':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 'globe':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'dining':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'ship':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 20a6 6 0 0 0 6 0 6 6 0 0 1 6 0 6 6 0 0 0 6 0" />
          <path d="M12 4v12" />
          <path d="M4 16l8-12 8 12" />
        </svg>
      );
    case 'building':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="9" y1="6" x2="9" y2="6.01" />
          <line x1="15" y1="6" x2="15" y2="6.01" />
          <line x1="9" y1="10" x2="9" y2="10.01" />
          <line x1="15" y1="10" x2="15" y2="10.01" />
          <line x1="9" y1="14" x2="9" y2="14.01" />
          <line x1="15" y1="14" x2="15" y2="14.01" />
          <line x1="9" y1="18" x2="15" y2="18" />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      );
  }
}

