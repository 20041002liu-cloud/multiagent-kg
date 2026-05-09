import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ui/agent-run/",
  plugins: [react()],
  build: {
    outDir: "../frontend/agent-run",
    emptyOutDir: true,
  },
});
