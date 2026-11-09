/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./pages/**/*.html", "./js/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Space Grotesk", "Segoe UI", "sans-serif"],
        body: ["Inter", "Segoe UI", "sans-serif"],
      },
      colors: {
        ink: "var(--bg-0)",
        magenta: "var(--magenta)",
        pink: "var(--pink)",
        violet: "var(--violet)",
        cyan: "var(--cyan)",
        lavender: "var(--lavender)",
      },
    },
  },
  plugins: [],
};
