import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // PocketBase JSVM migrations/hooks run inside PocketBase's embedded JS
    // runtime (globals like `migrate`, `onRecordCreate`, `$app`, `$security`),
    // not in the app bundle or Node, so they are not linted with the app rules.
    "pocketbase/**",
  ]),
]);

export default eslintConfig;
