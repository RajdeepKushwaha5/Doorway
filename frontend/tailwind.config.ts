import type { Config } from 'tailwindcss';

/**
 * A near-white page, hairline borders, and colour reserved for verdicts.
 *
 * The palette is deliberately almost monochrome. This interface exists to say
 * whether a value can be trusted, so colour has to mean something: green is
 * verified, amber is stale or suspect, red is withheld. Decorating anything
 * else in those colours spends the only vocabulary the page has.
 *
 * Type pairs a high-contrast serif for display with monospace everywhere else.
 * The serif gives the page a voice; the mono keeps every number, field name
 * and status reading as data rather than prose, which is what most of this
 * interface actually shows.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#FCFCFA',
          raised: '#FFFFFF',
          soft: '#F5F5F2',
          border: '#E4E4DE',
        },
        /** Ink. Named `ivory` for continuity with existing markup. */
        ivory: '#0C0C0A',
        muted: '#6E6E68',

        /** Two sensors agree right now. */
        verified: '#16794A',
        /** Agreed once, not now. Also a witness that could not read a field. */
        suspect: '#B45309',
        /** Withheld from the feed. */
        blocked: '#B4231F',
        /** Accent, used sparingly and never decoratively. */
        ember: '#16794A',
        coralSoft: '#E8F2EC',
        ink: '#0C0C0A',
      },
      fontFamily: {
        display: ['var(--font-display, ui-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-mono, ui-monospace)', 'ui-monospace', 'monospace'],
        mono: ['var(--font-mono, ui-monospace)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        eyebrow: '0.18em',
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
};

export default config;
