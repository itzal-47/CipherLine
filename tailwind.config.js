/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: 'rgb(var(--cyber-bg) / <alpha-value>)',
          panel: 'rgb(var(--cyber-panel) / <alpha-value>)',
          'panel-2': 'rgb(var(--cyber-panel-2) / <alpha-value>)',
          border: 'rgb(var(--cyber-border) / <alpha-value>)',
          green: 'rgb(var(--cyber-green) / <alpha-value>)',
          'green-dim': 'rgb(var(--cyber-green-dim) / <alpha-value>)',
          'green-glow': 'var(--cyber-green-glow)',
          cyan: 'rgb(var(--cyber-cyan) / <alpha-value>)',
          'cyan-dim': 'rgb(var(--cyber-cyan-dim) / <alpha-value>)',
          'cyan-glow': 'var(--cyber-cyan-glow)',
          magenta: 'rgb(var(--cyber-magenta) / <alpha-value>)',
          red: 'rgb(var(--cyber-red) / <alpha-value>)',
          'red-dim': 'rgb(var(--cyber-red-dim) / <alpha-value>)',
          amber: 'rgb(var(--cyber-amber) / <alpha-value>)',
          text: 'rgb(var(--cyber-text) / <alpha-value>)',
          'text-dim': 'rgb(var(--cyber-text-dim) / <alpha-value>)',
          'text-faint': 'rgb(var(--cyber-text-faint) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Space Mono"', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
        'glitch': 'glitch 0.3s steps(2) infinite',
        'radar': 'radar 2s linear infinite',
        'flicker': 'flicker 3s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        radar: {
          '0%': { transform: 'rotate(0deg) scale(0.8)', opacity: '0.8' },
          '50%': { transform: 'rotate(180deg) scale(1.2)', opacity: '0.3' },
          '100%': { transform: 'rotate(360deg) scale(0.8)', opacity: '0.8' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '48%': { opacity: '1' },
          '49%': { opacity: '0.4' },
          '50%': { opacity: '1' },
          '52%': { opacity: '0.6' },
          '53%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
