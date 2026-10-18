import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        configure(proxy) {
          // The browser reaches Vite from a phone's LAN address. Normalize the
          // forwarded Origin to the local web origin so the API's strict
          // development origin check still works without opening CORS broadly.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "http://localhost:5173");
          });
        }
      },
      "/health": {
        target: "http://localhost:3001",
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "http://localhost:5173");
          });
        }
      }
    }
  }
});
