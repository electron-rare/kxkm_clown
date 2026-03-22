/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4174,
    proxy: {
      "/api": {
        target: "http://localhost:4180",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:4180",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 15000,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
