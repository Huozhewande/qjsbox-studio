import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Library build: ESM bundle plus one stylesheet; React and React Flow stay external.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index", cssFileName: "qjsbox-studio" },
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime", "@xyflow/react"] },
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./test/setup.ts",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
