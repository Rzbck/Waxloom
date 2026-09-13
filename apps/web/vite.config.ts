import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiHost = process.env.WAXLOOM_API_HOST ?? "127.0.0.1";
const devHost = process.env.WAXLOOM_DEV_HOST ?? "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: 5173,
    proxy: {
      "/api": {
        target: `http://${apiHost}:8787`,
        changeOrigin: true,
      },
    },
  },
});
