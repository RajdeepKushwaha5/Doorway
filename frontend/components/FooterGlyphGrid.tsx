'use client';

import React, { useEffect, useRef } from 'react';

interface Block {
  col: number;
  row: number;
  widthCols: number;
  symbol: string;
  bg: string;
  textColor: string;
  born: number;
  duration: number;
}

const SYMBOLS = ['-', '=', '+', ')', '/', '(', '>', '<', '_', '*', '~', '[', ']', '01', '::'];

// Palette matching GitHub Universe & Doorway theme (mint, lavender, rose, emerald, cobalt, ochre, obsidian)
const THEME_COLORS = [
  { bg: '#86efac', textColor: '#064e3b' }, // Bright mint green
  { bg: '#a78bfa', textColor: '#2e1065' }, // Lavender purple
  { bg: '#fb7185', textColor: '#881337' }, // Rose pink
  { bg: '#10b981', textColor: '#ffffff' }, // Emerald green
  { bg: '#3b82f6', textColor: '#ffffff' }, // Cobalt blue
  { bg: '#b45309', textColor: '#ffffff' }, // Warm ochre
  { bg: '#0c0c0a', textColor: '#34d399' }, // Obsidian with emerald glyph
  { bg: '#6ee7b7', textColor: '#064e3b' }, // Soft green
];

export function FooterGlyphGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blocksRef = useRef<Map<string, Block>>(new Map());
  const lastSpawnRef = useRef<{ col: number; row: number }>({ col: -999, row: -999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const CELL_SIZE = 28;

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    resize();
    window.addEventListener('resize', resize);

    function spawnAt(clientX: number, clientY: number) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

      const col = Math.floor(x / CELL_SIZE);
      const row = Math.floor(y / CELL_SIZE);

      if (col === lastSpawnRef.current.col && row === lastSpawnRef.current.row) {
        return;
      }
      lastSpawnRef.current = { col, row };

      const now = performance.now();
      // Spawn a small cluster of 1-3 colorful glyph rectangles like GitHub Universe
      const count = Math.random() > 0.3 ? 2 : 1;
      
      for (let i = 0; i < count; i++) {
        const offsetCol = i === 0 ? col : (Math.random() > 0.5 ? col + 1 : col - 1);
        const offsetRow = row;
        const key = `${offsetCol},${offsetRow}`;

        const isWide = Math.random() > 0.6;
        const colorPair = THEME_COLORS[Math.floor(Math.random() * THEME_COLORS.length)] || {
          bg: '#86efac',
          textColor: '#064e3b',
        };
        const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)] || '+';

        blocksRef.current.set(key, {
          col: offsetCol,
          row: offsetRow,
          widthCols: isWide ? 2 : 1,
          symbol,
          bg: colorPair.bg,
          textColor: colorPair.textColor,
          born: now,
          duration: 1400 + Math.random() * 600, // 1.4s - 2.0s fade
        });
      }
    }

    function onMouseMove(e: MouseEvent) {
      spawnAt(e.clientX, e.clientY);
    }

    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0];
      if (touch) {
        spawnAt(touch.clientX, touch.clientY);
      }
    }

    const container = canvas.parentElement;
    container?.addEventListener('mousemove', onMouseMove);
    container?.addEventListener('touchmove', onTouchMove);

    function render(time: number) {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.font = '600 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const toDelete: string[] = [];

      blocksRef.current.forEach((block, key) => {
        const age = time - block.born;
        if (age >= block.duration) {
          toDelete.push(key);
          return;
        }

        const progress = age / block.duration;
        const alpha = progress < 0.15 ? progress / 0.15 : Math.max(0, 1 - (progress - 0.15) / 0.85);

        const x = block.col * CELL_SIZE;
        const y = block.row * CELL_SIZE;
        const w = block.widthCols * CELL_SIZE;
        const h = CELL_SIZE;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Draw colored block rectangle
        ctx.fillStyle = block.bg;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

        // Draw symbol
        ctx.fillStyle = block.textColor;
        ctx.fillText(block.symbol, x + w / 2, y + h / 2 + 1);

        ctx.restore();
      });

      toDelete.forEach((k) => blocksRef.current.delete(k));

      animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      container?.removeEventListener('mousemove', onMouseMove);
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
