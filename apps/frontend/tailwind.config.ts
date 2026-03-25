import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Anthropic-inspired warm, earthy palette
        background: {
          DEFAULT: '#FAF9F7', // Warm cream
          dark: '#1A1915',
        },
        foreground: {
          DEFAULT: '#1C1917', // Warm charcoal
          dark: '#FAF9F7',
        },
        card: {
          DEFAULT: '#FFFFFF',
          dark: '#24231E',
        },
        cardForeground: {
          DEFAULT: '#1C1917',
          dark: '#FAF9F7',
        },
        primary: {
          DEFAULT: '#D9775F', // Terracotta/coral
          light: '#E8A490',
          dark: '#B8563E',
        },
        brand: {
          DEFAULT: '#884F40', // Warm brown
        },
        accent: {
          DEFAULT: '#C4A77D', // Warm beige/gold
          light: '#D4BFA0',
          dark: '#A48D5D',
        },
        muted: {
          DEFAULT: '#E8E4DD',
          dark: '#2D2B26',
        },
        border: {
          DEFAULT: '#E5E2DA',
          dark: '#3A3832',
        },
      },
      fontFamily: {
        // Elegant serif for headings, clean sans for body - Anthropic style
        serif: ['"Source Serif 4"', '"Noto Serif"', 'Georgia', 'serif'],
        sans: ['"Inter"', '"SF Pro Display"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"SF Mono"', 'Monaco', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
