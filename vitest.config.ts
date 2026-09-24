import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // lib/env.ts requires the NEXT_PUBLIC_* vars even when the modules under
  // test never use them, so the suite runs with dev endpoints.
  define: {
    "process.env.NEXT_PUBLIC_FLOW_API_BASE": '"http://localhost:5004/api"',
    "process.env.NEXT_PUBLIC_FLOW_EMBED_BASE": '"http://localhost:3004/embed"',
    "process.env.NEXT_PUBLIC_FORGE_BASE": '"http://localhost:5000/api"',
    "process.env.NEXT_PUBLIC_AUTH_BASE": '"http://localhost:3002"',
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["lib/**/*.test.ts", "hooks/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
