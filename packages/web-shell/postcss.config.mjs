// Tailwind v4 uses a single PostCSS plugin — no separate tailwind.config
// for the basics. Theme tokens live inside globals.css via @theme blocks.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
