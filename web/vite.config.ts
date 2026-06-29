import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 단일 HTML 산출물: JS·CSS·폰트를 전부 인라인해 백엔드가 /admin에서 한 파일로 서빙한다.
// 개발 시에는 /api 요청을 백엔드(기본 localhost:8080, VITE_API_PROXY로 변경)로 프록시한다.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
