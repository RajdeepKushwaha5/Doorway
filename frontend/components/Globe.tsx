'use client';

import { useEffect, useRef } from 'react';

/**
 * A slowly turning wireframe globe with stippled shading.
 *
 * Drawn on a canvas with a real orthographic projection, because the shortcut
 * does not work. An earlier version animated the widths of SVG ellipses to
 * suggest rotation, which produces a tangle of overlapping arcs rather than a
 * sphere: on a real globe a meridian is a curve whose every point moves in
 * depth, and only the near half of it should be drawn at all.
 *
 * So each line is sampled in three dimensions, rotated, tilted, projected, and
 * clipped to the visible hemisphere. Shading is stippled rather than a
 * gradient, which suits an interface built out of hairlines and keeps the
 * whole thing one colour.
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
}

const TILT = (18 * Math.PI) / 180;
const MERIDIANS = 12;
const PARALLELS = 7;

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
     * Sampled and broken wherever it crosses the horizon, so the far half is
     * never drawn over the near half. Continuing through would produce exactly
     * the tangle this replaced.
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
        if (projected.z <= 0.02) {
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
      if (canvas.width !== size * ratio) {
        canvas.width = size * ratio;
        canvas.height = size * ratio;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.42;

      context.strokeStyle = '#0C0C0A';
      context.fillStyle = '#0C0C0A';
      context.lineWidth = 0.7;

      // Stipple. Density rises toward the lower right, which reads as a light
      // source without introducing a second colour or a gradient.
      const step = 5;
      for (let py = cy - radius; py <= cy + radius; py += step) {
        for (let px = cx - radius; px <= cx + radius; px += step) {
          const dx = (px - cx) / radius;
          const dy = (py - cy) / radius;
          const rr = dx * dx + dy * dy;
          if (rr > 0.995) continue;

          // Depth of the sphere surface at this pixel, used as shading.
          const depth = Math.sqrt(1 - rr);
          const shade = 0.55 * (dx * 0.6 + dy * 0.6) + (1 - depth) * 0.5;
          if (shade < 0.12) continue;

          const jitter = (Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) % 1;
          if (Math.abs(jitter) > shade) continue;

          context.fillRect(px, py, 1, 1);
        }
      }

      // Outline.
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.stroke();

      context.lineWidth = 0.7;

      // Meridians: constant longitude, sampled pole to pole.
      for (let m = 0; m < MERIDIANS; m++) {
        const lonDeg = (360 / MERIDIANS) * m;
        const points = [];
        for (let latDeg = -90; latDeg <= 90; latDeg += 3) points.push({ latDeg, lonDeg });
        strokeArc(points, radius, cx, cy);
      }

      // Parallels: constant latitude, sampled all the way round.
      for (let p = 1; p < PARALLELS; p++) {
        const latDeg = -90 + (180 / PARALLELS) * p;
        const points = [];
        for (let lonDeg = 0; lonDeg <= 360; lonDeg += 3) points.push({ latDeg, lonDeg });
        strokeArc(points, radius, cx, cy);
      }

      // Markers, drawn only while on the near side and labelled outward.
      context.font = '11px ui-monospace, monospace';
      for (const marker of markers) {
        const point = project(marker.lat, marker.lon, radius, cx, cy);
        if (point.z <= 0.12) continue;

        context.beginPath();
        context.arc(point.x, point.y, 3, 0, Math.PI * 2);
        context.fillStyle = '#FCFCFA';
        context.fill();
        context.strokeStyle = '#0C0C0A';
        context.lineWidth = 1.2;
        context.stroke();

        const toRight = point.x >= cx;
        const endX = toRight ? point.x + 26 : point.x - 26;

        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(endX, point.y - 14);
        context.lineWidth = 0.7;
        context.stroke();

        const width = context.measureText(marker.label).width + 14;
        const boxX = toRight ? endX : endX - width;
        context.fillStyle = '#FCFCFA';
        context.fillRect(boxX, point.y - 25, width, 20);
        context.strokeRect(boxX, point.y - 25, width, 20);
        context.fillStyle = '#0C0C0A';
        context.fillText(marker.label, boxX + 7, point.y - 11);
      }
    };

    const tick = (): void => {
      spin += 0.0022;
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
      className="globe"
      aria-hidden
      // Sized by CSS; the backing store is set from devicePixelRatio so the
      // hairlines stay crisp on a retina display.
      style={{ width: '100%', maxWidth: 460, aspectRatio: '1' }}
    />
  );
}
