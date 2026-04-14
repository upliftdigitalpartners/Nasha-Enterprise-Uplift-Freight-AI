import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isDemo = process.env.VITE_MODE === "demo";

// For GitHub Pages: set base to your repo name
// e.g. if your repo is github.com/nasha-enterprise/Nasha-Enterprise-Uplift-Freight-AI
// then base should be "/Nasha-Enterprise-Uplift-Freight-AI/"
// For custom domain or production: use "/"
const base = isDemo ? "/Nasha-Enterprise-Uplift-Freight-AI/" : "/";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5173,
    strictPort: true,
    // In production mode, proxy API calls to the in-house server
    ...(!isDemo && {
      proxy: {
        "/api": {
          target: process.env.VITE_API_BASE || "http://10.0.0.100:5000",
          changeOrigin: true,
        },
        "/hubs": {
          target: process.env.VITE_API_BASE || "http://10.0.0.100:5000",
          ws: true,
        },
      },
    }),
  },
  define: {
    __DEMO_MODE__: JSON.stringify(isDemo),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          signalr: ["@microsoft/signalr"],
        },
      },
    },
  },
  envPrefix: "VITE_",
});
