// UI del Studio. En producción `npm run build` deja ui/dist y lo sirve el servidor.
// En desarrollo (`npm run dev:ui`) Vite hace de proxy al servidor arrancado por `ai studio`;
// arranca el servidor con STUDIO_DEV_UI_PORT=5173 para que acepte ese origen.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// El puerto del servidor sale de config.env (única fuente de configuración del repo).
const configEnv = readFileSync(new URL("../../config.env", import.meta.url), "utf8");
const studioPort = /^STUDIO_PORT=(\d+)/m.exec(configEnv)?.[1];
const server = `http://127.0.0.1:${studioPort}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: server, changeOrigin: true },
      "/auth": { target: server, changeOrigin: true },
      "/ws": { target: server, changeOrigin: true, ws: true },
    },
  },
});
