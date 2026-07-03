import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 5173,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/api"),
      },
      "/encrypt": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/decrypt": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/download": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/metadata": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
