import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: path.join(root, "scripts"),
  base: "./",
  publicDir: path.join(root, "public"),
  plugins: [react()],
  build: {
    outDir: path.join(root, "dist/standalone"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.join(root, "scripts/standalone-index.html"),
    },
  },
});
