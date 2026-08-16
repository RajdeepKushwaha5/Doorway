import type { Config } from 'tailwindcss';

/** One neutral canvas, one ink colour, and one signal colour. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#F6F1E8',
          raised: '#FFFEFB',
          soft: '#F0EADF',
          border: '#D8D0C3',
        },
        verified: '#171714',
        suspect: '#FF5A36',
        blocked: '#FF5A36',
        ember: '#FF5A36',
        ivory: '#171714',
        muted: '#716B61',
        coralSoft: '#FFE1D6',
      },
      fontFamily: {
        sans: ['var(--font-geist, ui-sans-serif)', 'system-ui', 'sans-serif'],
        display: ['var(--font-geist, ui-sans-serif)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono, ui-monospace)', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
