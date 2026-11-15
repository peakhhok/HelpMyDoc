import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import claudeCodeBridge from "./server/vite-plugin.mjs";

export default defineConfig({
  plugins: [react(), claudeCodeBridge()],
});
