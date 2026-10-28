/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", cssMinify: true, sourcemap: false, chunkSizeWarningLimit: 300 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
