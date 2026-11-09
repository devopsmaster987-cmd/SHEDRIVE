import { defineConfig } from "vite";

// The SPA talks to the API through the same origin.
// In dev Vite proxies to Express; in Docker nginx proxies to the backend.
export default defineConfig({
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        auth: "auth.html",
        book: "book.html",
        ride: "ride.html",
        summary: "summary.html",
        history: "history.html",
        profile: "profile.html",
        driver: "driver.html",
        driverRide: "driver-ride.html",
        admin: "admin.html",
        adminReview: "admin-review.html",
      },
      output: {
        // Keep the 3D engine and motion libraries cacheable and code-split.
        manualChunks: {
          three: ["three"],
          motion: ["gsap", "lenis"],
        },
      },
    },
  },
});
