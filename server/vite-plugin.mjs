import { claudeCodeBridge } from "./bridge.mjs";

/** `npm run dev` / `vite preview` 에서도 로컬 Claude Code 브리지를 함께 띄운다. */
export default function claudeCodeBridgePlugin() {
  return {
    name: "helpmydoc-claude-code-bridge",
    configureServer(server) {
      server.middlewares.use(claudeCodeBridge);
    },
    configurePreviewServer(server) {
      server.middlewares.use(claudeCodeBridge);
    },
  };
}
