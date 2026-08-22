'use client';

import React, { useEffect, useRef } from 'react';

interface GridTile {
  col: number;
  row: number;
  widthCols: number;
  symbol: string;
  baseBg: string;
  textColor: string;
  hoverIntensity: number; // 0 to 1
}

const SYMBOLS = [
  '-', '=', '+', ')', '/', '(', '>', '<', '_', '*', '~', '[', ']', '01', '::', '✦', '{', '}'
];

const THEME_COLORS = [
  { bg: '#0c0c0a', textColor: '#10b981' }, // Obsidian black with emerald glyph
  { bg: '#10b981', textColor: '#ffffff' }, // Vibrant emerald green with white glyph
  { bg: '#064e3b', textColor: '#86efac' }, // Deep forest emerald with mint glyph
  { bg: '#18181b', textColor: '#34d399' }, // Dark slate with bright green glyph
  { bg: '#047857', textColor: '#ffffff' }, // Classic emerald with white glyph
  { bg: '#022c22', textColor: '#10b981' }, // Deep obsidian-green with emerald glyph
  { bg: '#86efac', textColor: '#064e3b' }, // Bright mint green with deep emerald glyph
  { bg: '#059669', textColor: '#ffffff' }, // Jade green with white glyph
  { bg: '#14532d', textColor: '#86efac' }, // Pine green with mint glyph
  { bg: '#27272a', textColor: '#a7f3d0' }, // Charcoal with soft mint glyph
  { bg: '#34d399', textColor: '#064e3b' }, // Neon mint with dark green glyph
  { bg: '#052e16', textColor: '#4ade80' }, // Emerald black with bright lime-green glyph
];

// Deterministic pseudorandom generator for stable layout across renders
function pseudoRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

export function FooterGlyphGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesRef = useRef<GridTile[]>([]);
  const hoverCoordRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const CELL_SIZE = 32;

    function buildGrid() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const numCols = Math.ceil(rect.width / CELL_SIZE) + 1;
      const numRows = Math.ceil(rect.height / CELL_SIZE) + 1;

      const newTiles: GridTile[] = [];
      const occupied: boolean[][] = Array.from({ length: numRows }, () =>
        Array(numCols).fill(false)
      );

      let seed = 42;

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          if (occupied[r]?.[c]) continue;

          seed++;
          const randW = pseudoRandom(seed);
          const isWide = randW > 0.6 && c + 1 < numCols && !occupied[r]?.[c + 1];
          const widthCols = isWide ? 2 : 1;

          occupied[r]![c] = true;
          if (isWide && occupied[r]) {
            occupied[r]![c + 1] = true;
          }

          seed += 2;
          const colorIdx = Math.floor(pseudoRandom(seed) * THEME_COLORS.length);
          const colorPair = THEME_COLORS[colorIdx] || { bg: '#86efac', textColor: '#064e3b' };

          seed += 3;
          const symbolIdx = Math.floor(pseudoRandom(seed) * SYMBOLS.length);
          const symbol = SYMBOLS[symbolIdx] || '+';

          newTiles.push({
            col: c,
            row: r,
            widthCols,
            symbol,
            baseBg: colorPair.bg,
            textColor: colorPair.textColor,
            hoverIntensity: 0,
          });
        }
      }

      tilesRef.current = newTiles;
    }

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      buildGrid();
    }

    resize();
    window.addEventListener('resize', resize);

    function onMouseMove(e: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      hoverCoordRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    function onMouseLeave() {
      hoverCoordRef.current = null;
    }

    function onTouchMove(e: TouchEvent) {
      if (!canvas) return;
      const touch = e.touches[0];
      if (touch) {
        const rect = canvas.getBoundingClientRect();
        hoverCoordRef.current = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
    }

    const container = canvas.parentElement;
    container?.addEventListener('mousemove', onMouseMove);
    container?.addEventListener('mouseleave', onMouseLeave);
    container?.addEventListener('touchmove', onTouchMove);

    function render() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const hover = hoverCoordRef.current;
      const decay = 0.05;

      for (const tile of tilesRef.current) {
        const x = tile.col * CELL_SIZE;
        const y = tile.row * CELL_SIZE;
        const w = tile.widthCols * CELL_SIZE;
        const h = CELL_SIZE;

        // Check if mouse is hovering over or near this tile
        let targetIntensity = 0;
        if (hover) {
          const centerX = x + w / 2;
          const centerY = y + h / 2;
          const dist = Math.hypot(hover.x - centerX, hover.y - centerY);
          if (dist < 60) {
            targetIntensity = Math.max(0, 1 - dist / 60);
          }
        }

        if (targetIntensity > tile.hoverIntensity) {
          tile.hoverIntensity = targetIntensity;
        } else {
          tile.hoverIntensity = Math.max(0, tile.hoverIntensity - decay);
        }

        ctx.save();

        // Subtle scale / highlight when hovered
        if (tile.hoverIntensity > 0.05) {
          const scale = 1 + tile.hoverIntensity * 0.08;
          ctx.translate(x + w / 2, y + h / 2);
          ctx.scale(scale, scale);
          ctx.translate(-(x + w / 2), -(y + h / 2));
        }

        // Draw tile background with 1px border gap
        ctx.fillStyle = tile.baseBg;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

        // Draw symbol
        ctx.fillStyle = tile.textColor;
        ctx.fillText(tile.symbol, x + w / 2, y + h / 2 + 1);

        // Bright outline on hover
        if (tile.hoverIntensity > 0.1) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      container?.removeEventListener('mousemove', onMouseMove);
      container?.removeEventListener('mouseleave', onMouseLeave);
      container?.removeEventListener('touchmove', onTouchMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      style={{ display: 'block' }}
    />
  );
}
