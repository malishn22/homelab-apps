/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          body: '#09090b',
          surface: '#18181b',
          glass: 'rgba(24, 24, 27, 0.6)',
          hover: '#27272a',
          console: '#020617',
        },
        border: {
          main: '#27272a',
          highlight: '#3f3f46',
        },
        primary: {
          DEFAULT: '#8b5cf6',
          glow: 'rgba(139, 92, 246, 0.5)',
        },
        accent: {
          DEFAULT: '#06b6d4',
          glow: 'rgba(6, 182, 212, 0.5)',
        },
        text: {
          main: '#f4f4f5',
          muted: '#a1a1aa',
          dim: '#52525b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 20px -5px var(--tw-shadow-color)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'conic-gradient(from 180deg at 50% 50%, #2a2a2a 0deg, #1a1a1a 360deg)',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        blink: 'blink 1s infinite',
        fadeIn: 'fadeIn 0.5s ease-out',
      },
    },
  },
  plugins: [],
};
