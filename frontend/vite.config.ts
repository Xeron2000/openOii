/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  server: {
    port: 15173,
    strictPort: true,
  },
  preview: {
    port: 15173,
    strictPort: true,
    host: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./app/setupTests.ts",
    css: true,
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/main.tsx",
        "app/vite-env.d.ts",
        "app/types/index.ts",
        "app/mocks",
      ],
    },
  },
});
