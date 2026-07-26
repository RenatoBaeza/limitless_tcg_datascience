import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the client calls /api/* and Vite forwards it to the FastAPI service,
// so the browser only ever sees one origin and CORS never enters into it.
// Point VITE_API_URL at the deployed API to talk to it directly instead.
const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
