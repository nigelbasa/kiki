/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './admin/**/*.{js,jsx,html}',
    './public-portal/**/*.{js,jsx,html}',
    './shared/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'rwendo-bg': '#ffffff',
        'signal-green': '#4ade80',
        'signal-amber': '#fb923c',
        'signal-red': '#f87171',
        'congestion-clear': '#86efac',
        'congestion-moderate': '#fde68a',
        'congestion-heavy': '#fca5a5',
        'rwendo-accent': '#f97316',
      },
    },
  },
  plugins: [],
};
