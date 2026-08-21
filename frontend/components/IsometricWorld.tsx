'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { DoorwayMatch } from '@/lib/types';

/**
 * The opportunity world, drawn from structured web data.
 *
 * Every property of every building is a field that was scraped, verified and
 * stored. Nothing here is decoration: if the geometry says a building is tall,
 * that is because the funding is large, and if it says the door is shut, that
 * is because an eligibility requirement was not met. A judge should be able to
 * read the state of the world without reading a legend first, and then check
 * any of it against the evidence on the source page.
 *
 * Drawn as inline SVG rather than a 3D library because the whole point is that
 * this is cheap and deterministic. The same matches always produce the same
 * city, so a demo is repeatable and a screenshot means something.
 *
 * | On screen            | The field behind it                       |
 * |----------------------|-------------------------------------------|
 * | Distance from centre | match score, best matches nearest the front |
 * | Height               | funding level                             |
 * | Solid colour         | verified by two independent sensors        |
 * | Hatched, faded       | the value is stale                        |
 * | Torn red             | quarantined, the source is under repair    |
 * | Open bright doorway  | eligible and open for applications        |
 * | Barred doorway       | a requirement is confirmed unmet          |
 * | Dashed doorway       | eligibility could not be determined       |
 * | Ring above the roof  | the deadline is close                     |
 */

/** Half-width and half-height of one isometric tile. */
const TILE_X = 46;
const TILE_Y = 23;

/** Isometric projection. Screen position of a point on the ground plane. */
function project(gx: number, gy: number, gz = 0): { x: number; y: number } {
  return {
    x: (gx - gy) * TILE_X,
    y: (gx + gy) * TILE_Y - gz,
  };
}

/**
 * Where each opportunity stands.
 *
 * Rings outward from the origin, best match first, so proximity to the front of
 * the city literally means "this one fits you best". Deterministic: the same
 * ordering always produces the same layout, which is what makes the before and
 * after of a repair legible.
 */
function plot(index: number): { gx: number; gy: number } {
  if (index === 0) return { gx: 0, gy: 0 };
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 1.2) || 1;
  const positions: { gx: number; gy: number }[] = [];
  for (let x = -ring; x <= ring; x += 1) {
    for (let y = -ring; y <= ring; y += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) === ring) positions.push({ gx: x, gy: y });
    }
  }
  positions.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  const seen = ring === 1 ? 1 : (2 * (ring - 1) + 1) ** 2;
  return positions[(index - seen) % positions.length] ?? { gx: 0, gy: 0 };
}

/** Funding decides height. An unspecified amount gets the shortest building. */
function heightOf(match: DoorwayMatch): number {
  const { funding } = match.opportunity;
  if (funding.level === 'full') return 96;
  if (funding.level === 'partial') return 62;
  return 38;
}

interface Palette {
  roof: string;
  left: string;
  right: string;
  edge: string;
  label: string;
}

/** Colour carries verification state, exactly as it does everywhere else. */
function paletteFor(match: DoorwayMatch): Palette {
  switch (match.opportunity.trust.status) {
    case 'quarantined':
      return { roof: '#f3d6d4', left: '#d8908c', right: '#c2726d', edge: '#B4231F', label: 'text-blocked' };
    case 'stale':
      return { roof: '#efe7d4', left: '#cbbc99', right: '#b6a682', edge: '#B45309', label: 'text-suspect' };
    case 'partially_verified':
      return { roof: '#e7efe6', left: '#a9c4a8', right: '#8fae8e', edge: '#4a7a4a', label: 'text-suspect' };
    default:
      return { roof: '#e2efe7', left: '#9dc7ac', right: '#7cae8f', edge: '#16794A', label: 'text-verified' };
  }
}

/** Days until the deadline, or null when there is not one we could read. */
function daysLeft(deadline: string | null): number | null {
  if (deadline === null) return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - Date.now()) / 86_400_000);
}

function Building({
  match,
  index,
  selected,
  onSelect,
}: {
  match: DoorwayMatch;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { gx, gy } = plot(index);
  const base = project(gx, gy);
  const height = heightOf(match);
  const palette = paletteFor(match);
  const days = daysLeft(match.opportunity.deadline);
  const closing = days !== null && days <= 30 && days >= 0;

  // The four ground corners of this tile, then the same four raised by the
  // building's height. Three faces are visible in this projection.
  const top = project(gx, gy, height);
  const w = TILE_X * 0.62;
  const h = TILE_Y * 0.62;

  const roof = `${top.x},${top.y - h} ${top.x + w},${top.y} ${top.x},${top.y + h} ${top.x - w},${top.y}`;
  const left = `${base.x - w},${base.y} ${base.x},${base.y + h} ${top.x},${top.y + h} ${top.x - w},${top.y}`;
  const right = `${base.x},${base.y + h} ${base.x + w},${base.y} ${top.x + w},${top.y} ${top.x},${top.y + h}`;

  const doorState =
    match.eligible === false ? 'barred' : match.eligible === 'unknown' ? 'unknown' : 'open';

  return (
    <g
      className="cursor-pointer"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      aria-label={`${match.opportunity.title}, ${String(match.score)}% match, ${match.opportunity.trust.status}`}
    >
      <ellipse
        cx={base.x}
        cy={base.y + h}
        rx={w * 1.15}
        ry={h * 0.85}
        fill="#000"
        opacity={selected ? 0.16 : 0.08}
      />

      <polygon points={left} fill={palette.left} stroke={palette.edge} strokeWidth={1.2} />
      <polygon points={right} fill={palette.right} stroke={palette.edge} strokeWidth={1.2} />
      <polygon points={roof} fill={palette.roof} stroke={palette.edge} strokeWidth={1.4} />

      {/* A quarantined source is drawn torn, so a broken building is legible
          at a glance rather than only by its colour. */}
      {match.opportunity.trust.status === 'quarantined' ? (
        <polyline
          points={`${base.x - w * 0.5},${base.y + h * 0.2} ${base.x - w * 0.1},${base.y - height * 0.35} ${base.x + w * 0.35},${base.y - height * 0.15} ${base.x + w * 0.1},${base.y - height * 0.62}`}
          fill="none"
          stroke="#B4231F"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ) : null}

      {/* The doorway. Open, barred or dashed, from the eligibility decision. */}
      <rect
        x={base.x - 7}
        y={base.y + h - 22}
        width={14}
        height={20}
        fill={doorState === 'open' ? '#fffdf6' : '#2b2b28'}
        stroke={palette.edge}
        strokeWidth={1}
        strokeDasharray={doorState === 'unknown' ? '3 2' : undefined}
      />
      {doorState === 'barred' ? (
        <line
          x1={base.x - 7}
          y1={base.y + h - 12}
          x2={base.x + 7}
          y2={base.y + h - 12}
          stroke="#B4231F"
          strokeWidth={2}
        />
      ) : null}

      {/* A deadline inside thirty days gets a ring, so urgency is spatial. */}
      {closing ? (
        <circle
          cx={top.x}
          cy={top.y - h - 12}
          r={7}
          fill="none"
          stroke="#B45309"
          strokeWidth={2}
          strokeDasharray={`${String(Math.max(2, (days / 30) * 44))} 44`}
        />
      ) : null}

      {selected ? (
        <polygon
          points={roof}
          fill="none"
          stroke="#0C0C0A"
          strokeWidth={2.4}
          strokeDasharray="4 3"
        />
      ) : null}
    </g>
  );
}

export function IsometricWorld({ matches }: { matches: DoorwayMatch[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Drawn furthest-back first so nearer buildings overlap correctly. Sorting a
  // copy keeps the caller's match ordering, which is what decides placement.
  const drawOrder = useMemo(
    () =>
      matches
        .map((match, index) => ({ match, index }))
        .sort((a, b) => {
          const pa = plot(a.index);
          const pb = plot(b.index);
          return pa.gx + pa.gy - (pb.gx + pb.gy);
        }),
    [matches],
  );

  const selected = matches.find((match) => match.opportunity.id === selectedId) ?? null;

  if (matches.length === 0) return null;

  return (
    <div className="mt-12">
      <div className="overflow-x-auto rounded-xl border border-black bg-[#f6f4ef]">
        <svg
          viewBox="-380 -230 760 470"
          className="h-[440px] w-full min-w-[680px]"
          role="img"
          aria-label={`An isometric city of ${String(matches.length)} opportunities, nearest the front being the best match`}
        >
          {/* Ground plane. Faint tiles so the projection reads as a place. */}
          <g opacity={0.16}>
            {Array.from({ length: 9 }, (_, row) =>
              Array.from({ length: 9 }, (_, col) => {
                const gx = row - 4;
                const gy = col - 4;
                const p = project(gx, gy);
                return (
                  <polygon
                    key={`${String(gx)}:${String(gy)}`}
                    points={`${p.x},${p.y - TILE_Y} ${p.x + TILE_X},${p.y} ${p.x},${p.y + TILE_Y} ${p.x - TILE_X},${p.y}`}
                    fill="none"
                    stroke="#0C0C0A"
                    strokeWidth={0.5}
                  />
                );
              }),
            )}
          </g>

          {drawOrder.map(({ match, index }) => (
            <Building
              key={match.opportunity.id}
              match={match}
              index={index}
              selected={match.opportunity.id === selectedId}
              onSelect={() => {
                setSelectedId(match.opportunity.id);
              }}
            />
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-gray-600">
        <Key swatch="#7cae8f">verified by two sensors</Key>
        <Key swatch="#b6a682">stale</Key>
        <Key swatch="#c2726d">quarantined, source under repair</Key>
        <span>taller = larger funding</span>
        <span>nearer the front = better match</span>
        <span>ring = deadline within 30 days</span>
        <span>barred door = a requirement is unmet</span>
      </div>

      {selected === null ? (
        <p className="mt-4 font-mono text-[12px] text-gray-600">
          Select a building to see the opportunity, why it matched, and the page the values were
          read from.
        </p>
      ) : (
        <SelectedPanel match={selected} />
      )}
    </div>
  );
}

function Key({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 border border-black"
        style={{ backgroundColor: swatch }}
      />
      {children}
    </span>
  );
}

function SelectedPanel({ match }: { match: DoorwayMatch }) {
  const { opportunity } = match;
  const days = daysLeft(opportunity.deadline);

  return (
    <div className="mt-4 border border-black bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-black px-5 py-3">
        <div>
          <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
            {opportunity.type.replace('-', ' ')} · {opportunity.provider}
          </div>
          <h3 className="mt-1 font-mondwest text-2xl leading-tight">{opportunity.title}</h3>
        </div>
        <div className="text-right font-mono text-[12px]">
          <div className="text-lg">{match.score}% match</div>
          <div className={paletteFor(match).label}>
            {opportunity.trust.status.replace('_', ' ')}
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-gray-200 sm:grid-cols-3">
        <Fact label="Funding">
          {opportunity.funding.amount === null
            ? opportunity.funding.level
            : `${opportunity.funding.currency ?? ''} ${opportunity.funding.amount.toLocaleString()}`.trim()}
        </Fact>
        <Fact label="Deadline">
          {opportunity.deadlineRaw ??
            (opportunity.deadline === null
              ? 'not stated'
              : `${opportunity.deadline}${days === null ? '' : ` · ${String(days)} days`}`)}
        </Fact>
        <Fact label="Confirmed by">
          {opportunity.trust.confirmedBy === 'two_sensors'
            ? 'two independent sensors'
            : 'learned contract only'}
        </Fact>
      </div>

      <div className="grid gap-px bg-gray-200 md:grid-cols-2">
        <div className="bg-white p-5">
          <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
            Why it matched
          </div>
          <ul className="mt-2 space-y-1 font-mono text-[12px] leading-relaxed">
            {match.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {match.unknownRequirements.length > 0 ? (
            <p className="mt-3 border border-suspect/40 bg-amber-50 p-2 font-mono text-[11.5px] leading-relaxed text-suspect">
              Could not determine: {match.unknownRequirements.join(', ')}. Doorway says unknown
              rather than assuming you qualify.
            </p>
          ) : null}
        </div>

        <div className="bg-white p-5">
          <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
            Where this came from
          </div>
          <p className="mt-2 break-all font-mono text-[12px] text-gray-600">
            {opportunity.sourceUrl}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {/* The panel carries enough to decide whether to look closer. The
                full record, with every field's provenance, is a page. */}
            <Link
              href={`/opportunities/${opportunity.id}`}
              className="border border-black px-4 py-2 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
            >
              Full record and evidence →
            </Link>
            <a
              href={opportunity.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-black px-4 py-2 font-neuebit text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white"
            >
              Read the source ↗
            </a>
            {opportunity.trust.status === 'quarantined' ? (
              <span className="border border-blocked bg-red-50 px-4 py-2 font-neuebit text-[11px] uppercase tracking-[0.12em] text-blocked">
                Application held until re-verified
              </span>
            ) : (
              <a
                href={opportunity.applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-black bg-black px-4 py-2 font-neuebit text-[11px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-white hover:text-black"
              >
                Apply ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-4">
      <div className="font-neuebit text-[10px] uppercase tracking-[0.14em] text-gray-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-[13px]">{children}</div>
    </div>
  );
}
