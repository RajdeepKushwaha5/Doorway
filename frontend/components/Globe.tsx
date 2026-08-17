'use client';

import { useEffect, useRef } from 'react';

/**
 * A slowly turning globe, shaded with an ordered dither.
 *
 * Two earlier versions were wrong in instructive ways. The first animated the
 * widths of SVG ellipses to suggest rotation, which produces a tangle rather
 * than a sphere: on a real globe every point of a meridian moves in depth, and
 * only the near half should be drawn at all. The second fixed the geometry but
 * shaded with random jitter, which reads as noise. Print halftones are not
 * random; they are a regular grid whose cells cross a threshold at different
 * points, and that regularity is the entire reason the texture looks drawn
 * rather than dirty.
 *
 * So shading here is a Bayer 8x8 ordered dither. Each cell of a fixed grid
 * carries a threshold, the sphere's brightness at that point is compared
 * against it, and a dot is either placed or not. The pattern is stable across
 * frames in screen space, so rotating the globe moves the geometry through a
 * fixed screen texture, exactly as a printed halftone would behave.
 *
 * Decorative, so it is hidden from assistive technology and stops entirely
 * when a reader has asked for reduced motion.
 */

interface Marker {
  /** Degrees, positive north. */
  lat: number;
  /** Degrees, positive east. */
  lon: number;
  label: string;
  /** Draws a tick before the label, in the verified green. */
  ok?: boolean;
}

const TILT = (16 * Math.PI) / 180;
const MERIDIANS = 12;
const PARALLELS = 7;

const INK = '#0C0C0A';
const PAPER = '#FCFCFA';
const VERIFIED = '#16794A';

/**
 * Bayer 8x8 threshold matrix, the classic ordered-dither kernel.
 *
 * Values spread evenly across 0..63 so that as brightness falls, dots appear in
 * a dispersed pattern rather than clumping. Divided by 64 at use to give a
 * threshold in 0..1.
 */
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

export function Globe({ markers = [] }: { markers?: Marker[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let spin = 0;

    /** Rotate by longitude, tilt, then project orthographically. */
    const project = (
      latDeg: number,
      lonDeg: number,
      radius: number,
      cx: number,
      cy: number,
    ): { x: number; y: number; z: number } => {
      const lat = (latDeg * Math.PI) / 180;
      const lon = (lonDeg * Math.PI) / 180 + spin;

      const x = Math.cos(lat) * Math.sin(lon);
      const yUp = Math.sin(lat);
      const zDepth = Math.cos(lat) * Math.cos(lon);

      // Tilt about the horizontal axis so the poles are not dead centre.
      const y = yUp * Math.cos(TILT) - zDepth * Math.sin(TILT);
      const z = yUp * Math.sin(TILT) + zDepth * Math.cos(TILT);

      return { x: cx + radius * x, y: cy - radius * y, z };
    };

    /**
     * Draw a line of constant latitude or longitude.
     *
     * Broken wherever it crosses the horizon, so the far half is never drawn
     * over the near half. Continuing through would produce exactly the tangle
     * this replaced.
     */
    const strokeArc = (
      points: { latDeg: number; lonDeg: number }[],
      radius: number,
      cx: number,
      cy: number,
    ): void => {
      let drawing = false;
      context.beginPath();
      for (const point of points) {
        const projected = project(point.latDeg, point.lonDeg, radius, cx, cy);
        if (projected.z <= 0.015) {
          drawing = false;
          continue;
        }
        if (drawing) context.lineTo(projected.x, projected.y);
        else {
          context.moveTo(projected.x, projected.y);
          drawing = true;
        }
      }
      context.stroke();
    };

    const render = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth;
      if (size === 0) return;
      if (canvas.width !== Math.round(size * ratio)) {
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.4;

      // ---------------------------------------------------------- dither
      // A fixed screen-space grid. `cell` is the halftone pitch: smaller
      // reads as a finer paper stock, larger as a coarser print.
      const cell = 3;
      const dot = 1.6;
      context.fillStyle = INK;

      const columns = Math.ceil((radius * 2) / cell) + 2;
      for (let row = 0; row <= columns; row++) {
        for (let column = 0; column <= columns; column++) {
          const px = cx - radius + column * cell;
          const py = cy - radius + row * cell;

          const dx = (px - cx) / radius;
          const dy = (py - cy) / radius;
          const rr = dx * dx + dy * dy;
          if (rr > 1) continue;

          // Surface normal at this pixel, for a directional light.
          const depth = Math.sqrt(1 - rr);

          // Light from the upper left, plus limb darkening so the silhouette
          // stays dense and the sphere reads as round rather than as a disc.
          //
          // Capped below 1 on purpose. Letting the darkest region reach full
          // coverage fills every cell of the dither and the texture collapses
          // into a solid blob, which is the one thing a halftone must not do:
          // the dots have to stay legible as dots even where they are densest.
          const lambert = Math.max(0, -dx * 0.52 - dy * 0.52 + depth * 0.72);
          const limb = Math.pow(1 - depth, 1.7);
          const darkness = Math.min(
            0.93,
            0.22 + limb * 0.72 + (1 - lambert) * 0.45,
          );
          if (darkness <= 0) continue;

          const threshold =
            (BAYER[row % 8]?.[column % 8] ?? 0) / 64 + 1 / 128;
          if (darkness < threshold) continue;

          context.fillRect(px - dot / 2, py - dot / 2, dot, dot);
        }
      }

      // ----------------------------------------------------------- wires
      context.strokeStyle = INK;
      context.lineJoin = 'round';

      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.stroke();

      context.lineWidth = 1.35;

      for (let m = 0; m < MERIDIANS; m++) {
        const lonDeg = (360 / MERIDIANS) * m;
        const points = [];
        for (let latDeg = -90; latDeg <= 90; latDeg += 2) points.push({ latDeg, lonDeg });
        strokeArc(points, radius, cx, cy);
      }

      for (let p = 1; p < PARALLELS; p++) {
        const latDeg = -90 + (180 / PARALLELS) * p;
        const points = [];
        for (let lonDeg = 0; lonDeg <= 360; lonDeg += 2) points.push({ latDeg, lonDeg });
        strokeArc(points, radius, cx, cy);
      }

      // --------------------------------------------------------- markers
      context.font =
        '11px ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace';
      context.textBaseline = 'middle';

      for (const marker of markers) {
        const point = project(marker.lat, marker.lon, radius, cx, cy);
        if (point.z <= 0.14) continue;

        // Anchor: a small open ring, so the dither reads through it.
        context.beginPath();
        context.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
        context.fillStyle = PAPER;
        context.fill();
        context.strokeStyle = INK;
        context.lineWidth = 1.4;
        context.stroke();

        const toRight = point.x >= cx - radius * 0.25;
        const legX = toRight ? point.x + 30 : point.x - 30;
        const legY = point.y - 18;

        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(legX, legY);
        context.lineWidth = 1;
        context.stroke();

        const tick = marker.ok === true ? '✓ ' : '';
        const text = `${tick}${marker.label}`;
        const width = context.measureText(text).width + 16;
        const height = 21;
        const boxX = toRight ? legX : legX - width;
        const boxY = legY - height / 2;

        context.fillStyle = PAPER;
        context.fillRect(boxX, boxY, width, height);
        context.lineWidth = 1.2;
        context.strokeRect(boxX, boxY, width, height);

        context.fillStyle = marker.ok === true ? VERIFIED : INK;
        context.fillText(text, boxX + 8, legY + 0.5);
      }
    };

    const tick = (): void => {
      spin += 0.0018;
      render();
      frame = window.requestAnimationFrame(tick);
    };

    if (reduced) render();
    else frame = window.requestAnimationFrame(tick);

    const onResize = (): void => void render();
    window.addEventListener('resize', onResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [markers]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      // Sized by CSS; the backing store follows devicePixelRatio so both the
      // hairlines and the halftone stay crisp on a retina display.
      style={{ width: '100%', maxWidth: 520, aspectRatio: '1' }}
    />
  );
}
