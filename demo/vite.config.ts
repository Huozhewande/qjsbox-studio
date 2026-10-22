import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The demo imports the library from source, so `npm run dev` reflects edits immediately.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^qjsbox-studio\/styles\.css$/, replacement: fileURLToPath(new URL("../src/styles.css", import.meta.url)) },
      { find: /^qjsbox-studio$/, replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    ],
  },
  server: { host: "127.0.0.1", port: 5179 },
  build: { outDir: "dist", emptyOutDir: true },
});
