/** Ash Gray / Ash Navy palette (Tailwind v4 also uses tokens in globals.css) */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ash: {
          navy: '#0B0F17',
          gray: '#161F2E',
          deep: '#0D131F',
        },
      },
      backgroundColor: {
        page: '#0B0F17',
        card: '#161F2E',
        drawer: '#0D131F',
      },
    },
  },
  plugins: [],
};
