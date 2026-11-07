/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#102b4e',
        'soft-blue': '#eaf3ff',
        'fee-green': '#198754',
        'fee-orange': '#d97706',
        'fee-red': '#dc3545'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
