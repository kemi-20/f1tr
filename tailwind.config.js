/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // near-black motorsport canvas
        ink: {
          950: '#07090E',
          900: '#0B0F16',
          850: '#0E131C',
          800: '#121826',
          700: '#1A2233'
        },
        accent: {
          carbon: '#2DD4BF',
          papaya: '#FF6A00',
          racing: '#FF3B3B',
          ember: '#FFB020'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', 'sans-serif'],
        display: ['Oxanium', 'Rajdhani', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        glass: '0 8px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.05)'
      },
      backdropBlur: {
        xs: '2px'
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.8)', opacity: '0' }
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } }
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0,0,0.2,1) infinite',
        'fade-in': 'fade-in 0.4s ease-out',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.16,1,0.3,1)'
      }
    }
  },
  plugins: []
}
