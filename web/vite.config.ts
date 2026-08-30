import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "WeAct Power Monitor",
        short_name: "PowerMonitor",
        description: "Web Bluetooth monitor and controller for WeAct PowerMonitorMiniV1.",
        theme_color: "#07111f",
        background_color: "#07111f",
        display: "standalone",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
      },
      workbox: {
        navigateFallback: "/index.html",
        // Plotly is intentionally bundled for offline charting and image export.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024
      }
    })
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"]
  }
});
