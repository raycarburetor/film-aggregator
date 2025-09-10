import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}','./components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      container: { center: true, padding: '1rem' },
      // Bump Tailwind's text-xs from 12px to 13px (keep 16px line-height)
      fontSize: { xs: ['13px', { lineHeight: '1rem' }] },
    },
  },
  plugins: [],
} satisfies Config
