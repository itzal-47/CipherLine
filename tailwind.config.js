/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#0a0a0f',
          panel: '#0f0f17',
          'panel-2': '#12121d',
          border: '#1a1a2e',
          green: '#00ff9d',
          'green-dim': '#00cc7d',
          'green-glow': 'rgba(0, 255, 157, 0.15)',
          cyan: '#00e5ff',
          'cyan-dim': '#00b8cc',
          'cyan-glow': 'rgba(0, 229, 255, 0.15)',
          red: '#ff3366',
          'red-dim': '#cc2952',
          amber: '#ffaa00',
          text: '#c8ffd9',
          'text-dim': '#5a8a6e',
          'text-faint': '#2a4a36',
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
