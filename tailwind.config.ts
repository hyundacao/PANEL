import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg-0)',
        surface: 'var(--surface-1)',
        surface2: 'var(--surface-2)',
        border: 'var(--border)',
        borderStrong: 'var(--border-strong)',
        innerHighlight: 'var(--inner-highlight)',
        title: 'var(--t-title)',
        body: 'var(--t-body)',
        muted: 'var(--t-muted)',
        dim: 'var(--t-dim)',
        disabled: 'var(--t-disabled)',
        brand: 'var(--brand)',
        brandHover: 'var(--brand-hover)',
        brandSoft: 'var(--brand-soft)',
        ring: 'var(--ring)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)'
      },
      borderRadius: {
        xl: '14px',
        '2xl': '16px'
      },
      boxShadow: {
        card: '0 0 0 1px rgb(var(--border) / 0.6)'
      },
      keyframes: {
        fade: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        fade: 'fade 0.2s ease-out',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

export default config;
