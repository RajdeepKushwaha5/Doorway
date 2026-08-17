'use client';

import { useEffect, useRef } from 'react';

interface Marker {
  lat: number;
  lon: number;
  label: string;
  ok?: boolean;
}

/**
 * What the globe says when no fleet has loaded.
 *
 * Every line is a true statement about this system rather than a plausible one
 * about somebody else's. An earlier version carried invented site names left
 * over from a reference design, which put a claim on the most visible surface
 * of the project that nothing behind it could support. On a page whose entire
 * argument is that unverifiable data should not be published, decorative
 * fiction in the hero is the one thing it cannot afford.
 */
const FALLBACK_CALLOUTS = [
  { text: 'scraper-studio → collector', kind: 'build' },
  { text: 'web-unlocker → witness', kind: 'heal' },
  { text: 'mcp-server ✓ gated', kind: 'add' },
  { text: 'deploy-gate ✓ armed', kind: 'build' },
];

/** Turn the real fleet into callouts, so the globe reports rather than decorates. */
function calloutsFor(markers: Marker[]): { text: string; kind: string }[] {
  if (markers.length === 0) return FALLBACK_CALLOUTS;
  return [
    ...markers.map((marker) => ({
      text: marker.ok === false ? `${marker.label} withheld` : `${marker.label} ✓ verified`,
      kind: marker.ok === false ? 'add' : 'heal',
    })),
    ...FALLBACK_CALLOUTS.slice(0, 2),
  ];
}

const DEG_TO_RAD = Math.PI / 180;
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function spherePoint(latDeg: number, lonDeg: number) {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: cosLat * Math.sin(lon),
  };
}

export function Globe({
  size = 480,
  className = '',
  markers = [],
}: {
  size?: number;
  className?: string;
  markers?: Marker[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Serialised so the effect re-runs when the fleet actually changes rather
  // than on every render, which a fresh array literal would otherwise cause.
  const calloutKey = JSON.stringify(markers);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Offscreen 200x200 pixel canvas for Bayer dither shading
    const offscreen = document.createElement('canvas');
    offscreen.width = 200;
    offscreen.height = 200;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!offCtx) return;

    const scaleRadius = 0.34 * size;
    const tiltPitch = -24 * DEG_TO_RAD;
    const tiltYaw = 11 * DEG_TO_RAD;
    const cosPitch = Math.cos(tiltPitch);
    const sinPitch = Math.sin(tiltPitch);
    const cosYaw = Math.cos(tiltYaw);
    const sinYaw = Math.sin(tiltYaw);

    // Build sphere wireframe geometry & particles
    const { lines, particles } = (() => {
      const lineList: { x: number; y: number; z: number }[][] = [];

      // Parallels (latitudes)
      for (let lat = -66; lat <= 66; lat += 22) {
        const row: { x: number; y: number; z: number }[] = [];
        for (let lon = 0; lon <= 360; lon += 4) {
          row.push(spherePoint(lat, lon));
        }
        lineList.push(row);
      }

      // Meridians (longitudes)
      for (let lon = 0; lon < 360; lon += 22.5) {
        const col: { x: number; y: number; z: number }[] = [];
        for (let lat = -88; lat <= 88; lat += 4) {
          col.push(spherePoint(lat, lon));
        }
        lineList.push(col);
      }

      // Random surface particles
      const particleList: { v: { x: number; y: number; z: number }; r: number }[] = [];
      for (let i = 0; i < 150; i++) {
        particleList.push({
          v: spherePoint(160 * Math.random() - 80, 360 * Math.random()),
          r: Math.random(),
        });
      }

      return { lines: lineList, particles: particleList };
    })();

    interface ActiveCallout {
      v: { x: number; y: number; z: number };
      born: number;
      text: string;
      kind: string;
    }

    const activeCallouts: ActiveCallout[] = [];
    // Names the fleet actually under watch. Falls back to this system's own
    // surfaces, never to invented sites.
    const callouts = calloutsFor(markers);
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    let rotY = 0;
    let spinSpeed = 0.0018;
    let isDragging = false;
    let dragStartX = 0;
    let animFrame = 0;
    let startTime = 0;
    let currentTime = 0;
    let frameCount = 0;
    let lastSpawnTime = 0;
    let glitchEndTime = 0;

    function rotatePoint(p: { x: number; y: number; z: number }) {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const nx = p.x * cosR + p.z * sinR;
      const nz = -p.x * sinR + p.z * cosR;
      const ny = p.y * cosPitch - nz * sinPitch;
      return {
        x: nx * cosYaw - ny * sinYaw,
        y: nx * sinYaw + ny * cosYaw,
        z: p.y * sinPitch + nz * cosPitch,
      };
    }

    function projectPoint(p: { x: number; y: number; z: number }, center: number, r: number) {
      const persp = 2.8 / (2.8 - p.z);
      return {
        sx: center + p.x * r * persp,
        sy: center + p.y * r * persp,
        persp,
        z: p.z,
      };
    }

    function drawWireframeLines(isFront: boolean) {
      for (const line of lines) {
        offCtx!.beginPath();
        let active = false;
        for (const pt of line) {
          const rot = rotatePoint(pt);
          if (rot.z > 0 !== isFront) {
            active = false;
            continue;
          }
          const { sx, sy } = projectPoint(rot, 100, 68);
          if (active) {
            offCtx!.lineTo(sx, sy);
          } else {
            offCtx!.moveTo(sx, sy);
            active = true;
          }
        }
        offCtx!.stroke();
      }
    }

    function renderScene(progress: number, glitch: number) {
      // 1. Clear offscreen canvas
      offCtx!.setTransform(1, 0, 0, 1, 0, 0);
      offCtx!.fillStyle = '#ffffff';
      offCtx!.fillRect(0, 0, 200, 200);

      // Spherical radial highlight shading
      const grad = offCtx!.createRadialGradient(76.2, 72.8, 10.2, 100, 100, 76.16);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.62, '#fbfbfb');
      grad.addColorStop(0.9, '#ececec');
      grad.addColorStop(1, '#dcdcdc');
      offCtx!.fillStyle = grad;
      offCtx!.beginPath();
      offCtx!.arc(100, 100, 73.44, 0, 2 * Math.PI);
      offCtx!.fill();

      // Draw Wireframe
      offCtx!.lineJoin = 'round';
      offCtx!.lineCap = 'round';

      // Back hemisphere (dim)
      offCtx!.globalAlpha = 0.28;
      offCtx!.lineWidth = 0.9;
      offCtx!.strokeStyle = '#000000';
      drawWireframeLines(false);

      // Front hemisphere (crisp)
      offCtx!.globalAlpha = 1;
      offCtx!.lineWidth = 1.8;
      drawWireframeLines(true);

      // Orbiting Surface Particle Dither
      if (progress > 0.02 && progress < 0.92) {
        const invP = 1 - progress;
        for (const p of particles) {
          if (p.r > progress + 0.15) {
            const rot = rotatePoint(p.v);
            if (rot.z <= 0) continue;
            const { sx, sy, persp } = projectPoint(rot, 100, 68);
            const dotSize = (3 + 9 * invP) * persp;
            offCtx!.fillStyle = `rgba(16, 16, 16, ${0.85 * invP})`;
            offCtx!.fillRect(
              Math.round(sx - dotSize / 2),
              Math.round(sy - dotSize / 2),
              Math.round(dotSize),
              Math.round(dotSize),
            );
          }
        }
      }

      // Action Marker Bursts on Sphere
      offCtx!.globalAlpha = 1;
      for (const callout of activeCallouts) {
        const age = currentTime - callout.born;
        const rot = rotatePoint(callout.v);
        if (rot.z < 0.12) continue;

        const { sx, sy, persp } = projectPoint(rot, 100, 68);

        // Burst rings for first 420ms
        if (age < 420 && Math.floor(currentTime / 70) % 2 === 0) {
          const burstRatio = age / 420;
          const burstDist = (3 + 7 * burstRatio) * persp;
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + burstRatio;
            const size = Math.max(1, (3 - 2 * burstRatio) * persp);
            offCtx!.fillStyle = '#101010';
            offCtx!.fillRect(
              Math.round(sx + Math.cos(angle) * burstDist - size / 2),
              Math.round(sy + Math.sin(angle) * burstDist - size / 2),
              Math.round(size),
              Math.round(size),
            );
          }
        }

        // Anchor pixel
        offCtx!.fillStyle = '#101010';
        const anchorSize = 2.4 * persp;
        offCtx!.fillRect(
          Math.round(sx - anchorSize / 2),
          Math.round(sy - anchorSize / 2),
          Math.round(anchorSize),
          Math.round(anchorSize),
        );
      }

      // 2. Bayer 4x4 Dither Threshold Matrix Filter
      const imgData = offCtx!.getImageData(0, 0, 200, 200);
      const data = imgData.data;
      const offsetX = glitch > 0.01 ? (frameCount >> 1) & 3 : 1;
      const offsetY = glitch > 0.01 ? frameCount & 3 : 2;

      for (let y = 0; y < 200; y++) {
        const bayerRow = BAYER_4X4[(y + offsetY) & 3]!;
        for (let x = 0; x < 200; x++) {
          const idx = (y * 200 + x) << 2;
          const lum = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
          const threshold = (bayerRow[(x + offsetX) & 3]! + 0.5) * 16;
          const val = lum < threshold ? 0 : 255;
          data[idx] = val;
          data[idx + 1] = val;
          data[idx + 2] = val;
          data[idx + 3] = 255;
        }
      }
      offCtx!.putImageData(imgData, 0, 0);

      // 3. Draw to main canvas with optional glitch slice scanline displacement
      ctx!.clearRect(0, 0, size, size);
      if (glitch <= 0.01) {
        ctx!.drawImage(offscreen, 0, 0, 200, 200, 0, 0, size, size);
      } else {
        const sliceH = size / 10;
        for (let s = 0; s < 10; s++) {
          const jitter = Math.random() < 0.5 ? (2 * Math.random() - 1) * 7 * glitch : 0;
          ctx!.drawImage(offscreen, 0, s * 20, 200, 20, jitter, s * sliceH, size, sliceH + 0.5);
        }
      }

      // 4. Draw Interactive 3D Callout Tags & Leader Lines
      for (const callout of activeCallouts) {
        const age = currentTime - callout.born;
        const rot = rotatePoint(callout.v);
        if (rot.z < 0.12) continue;

        const { sx, sy } = projectPoint(rot, size / 2, scaleRadius);
        const tagColor = callout.kind === 'build' ? '#0a0a0a' : '#16794A';
        const fadeOut = age > 2700 ? Math.min(1, (age - 2700) / 420) : 0;
        if (fadeOut >= 1) continue;

        const isBlinking = fadeOut > 0.45 && Math.floor(currentTime / 80) % 2 === 0;
        const pulse = 1 + 0.3 * Math.sin(age / 130);

        // Marker concentric rings
        ctx!.fillStyle = '#ffffff';
        ctx!.beginPath();
        ctx!.arc(sx, sy, 4.5, 0, 2 * Math.PI);
        ctx!.fill();

        ctx!.strokeStyle = tagColor;
        ctx!.lineWidth = 1.2;
        ctx!.beginPath();
        ctx!.arc(sx, sy, 4.5, 0, 2 * Math.PI);
        ctx!.stroke();

        ctx!.fillStyle = tagColor;
        ctx!.beginPath();
        ctx!.arc(sx, sy, 2.4 * pulse, 0, 2 * Math.PI);
        ctx!.fill();

        if (age < 90 || isBlinking) continue;

        // Leader line & Box Tag
        ctx!.font = '600 12px ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace';
        const textWidth = ctx!.measureText(callout.text).width + 14;
        let boxX = sx + 18;
        let boxY = sy - 34;
        boxX = Math.min(Math.max(2, boxX), size - textWidth - 2);
        boxY = Math.min(Math.max(2, boxY), size - 21 - 2);

        const leaderProgress = Math.min(1, (age - 90) / 170);
        const endX = sx + (boxX - sx) * leaderProgress;
        const endY = sy + (boxY + 21 - sy) * leaderProgress;

        ctx!.strokeStyle = '#0a0a0a';
        ctx!.lineWidth = 1.4;
        ctx!.beginPath();
        ctx!.moveTo(Math.round(sx) + 0.5, Math.round(sy) + 0.5);
        ctx!.lineTo(Math.round(endX) + 0.5, Math.round(endY) + 0.5);
        ctx!.stroke();

        if (leaderProgress < 1) continue;

        // Elastic scale bounce pop-in
        const ease = (tVal: number) => {
          const t = Math.min(1, Math.max(0, tVal)) - 1;
          return 1 + 3.2 * t * t * t + 2.2 * t * t;
        };
        const scale = ease((age - 250) / 360) * (1 - fadeOut);

        if (scale > 0.03) {
          ctx!.save();
          ctx!.translate(boxX, boxY + 21);
          ctx!.scale(scale, scale);

          // Tag Box
          ctx!.fillStyle = '#ffffff';
          ctx!.fillRect(0, -21, Math.round(textWidth), 21);

          ctx!.lineWidth = 1.4;
          ctx!.strokeStyle = '#0a0a0a';
          ctx!.strokeRect(0.5, -20.5, Math.round(textWidth), 21);

          // Tag Text
          ctx!.fillStyle = tagColor;
          ctx!.textBaseline = 'middle';
          ctx!.fillText(callout.text, 7, -10.5);
          ctx!.restore();
        }
      }
    }

    function loop(timestamp: number) {
      if (!startTime) startTime = timestamp;
      currentTime = timestamp;
      frameCount++;

      const introProgress = prefersReducedMotion ? 1 : Math.min(1, (timestamp - startTime) / 1000);
      rotY += spinSpeed;

      if (!isDragging) {
        spinSpeed += (0.0018 - spinSpeed) * 0.03;
      }

      let glitch = 0;
      if (introProgress < 1) {
        glitch = 1 - introProgress;
      } else if (timestamp < glitchEndTime) {
        glitch = Math.min(1, (glitchEndTime - timestamp) / 280);
      }

      // Periodically spawn live callouts (every ~1050ms)
      if (timestamp - lastSpawnTime > 1050) {
        if (activeCallouts.length <= 4) {
          const lat = (100 * Math.random() - 50) * DEG_TO_RAD;
          const lon = -rotY + (120 * Math.random() - 60) * DEG_TO_RAD;
          const cosLat = Math.cos(lat);
          const preset = callouts[Math.floor(Math.random() * callouts.length)]!;
          activeCallouts.push({
            v: {
              x: cosLat * Math.cos(lon),
              y: Math.sin(lat),
              z: cosLat * Math.sin(lon),
            },
            born: currentTime,
            text: preset.text,
            kind: preset.kind,
          });
        }
        lastSpawnTime = timestamp;
      }

      // Prune expired callouts (older than 3.3s)
      for (let i = activeCallouts.length - 1; i >= 0; i--) {
        if (currentTime - activeCallouts[i]!.born > 3300) {
          activeCallouts.splice(i, 1);
        }
      }

      renderScene(introProgress, glitch);

      if (!prefersReducedMotion) {
        animFrame = requestAnimationFrame(loop);
      }
    }

    if (prefersReducedMotion) {
      renderScene(1, 0);
      return;
    }

    animFrame = requestAnimationFrame(loop);

    // Interactive pointer drag controls
    function onPointerDown(e: PointerEvent) {
      isDragging = true;
      dragStartX = e.clientX;
      glitchEndTime = currentTime + 320;
      canvas?.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      dragStartX = e.clientX;
      spinSpeed = deltaX * 0.005;
      rotY += spinSpeed;
      glitchEndTime = currentTime + 220;
    }

    function onPointerUp(e: PointerEvent) {
      isDragging = false;
      canvas?.releasePointerCapture?.(e.pointerId);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [size, calloutKey]);

  return (
    <canvas
      ref={canvasRef}
      className={`select-none cursor-grab active:cursor-grabbing ${className}`}
      style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1' }}
      aria-label="Interactive 3D Dithered Globe"
    />
  );
}
