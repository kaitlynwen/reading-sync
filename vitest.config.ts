import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  // Transform `.tsx` with the automatic JSX runtime so React component tests
  // (e.g. the ThemeToggle UI test) need no extra Babel/Vite plugin. The default
  // test environment stays `node`; component tests opt into jsdom per-file via a
  // `// @vitest-environment jsdom` directive, so node-only tests are unaffected.
  esbuild: {
    jsx: "automatic",
    jsxDev: true,
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", "out/**", ".next/**", "src-tauri/**"],
  },
});
