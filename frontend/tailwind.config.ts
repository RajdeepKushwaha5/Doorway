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
          dark: '#0A0A09',
          darkRaised: '#121210',
          darkBorder: '#242422',
        },
        /** Ink. Named `ivory` for continuity with existing markup. */
        ivory: '#0C0C0A',
        muted: '#6E6E68',

        /** Parse.bot inspired tokens */
        parse: {
          accent: '#16794A',
          accentHover: '#13633C',
          accentBg: '#E8F2EC',
          accentBgSoft: '#F2F8F4',
          warn: '#D97706',
          info: '#2563EB',
          danger: '#DC2626',
        },

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
        mondwest: ['var(--font-mondwest)', 'serif'],
        neuebit: ['var(--font-neuebit)', 'monospace'],
        display: ['var(--font-mondwest)', 'serif'],
        sans: ['var(--font-mono)', 'monospace'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      letterSpacing: {
        eyebrow: '0.18em',
        pixel: '0.12em',
      },
      borderRadius: {
        card: '10px',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        blink: 'blink 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
    },
  },
  plugins: [],
};

export default config;
