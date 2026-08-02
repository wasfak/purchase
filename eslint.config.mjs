import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Loading data on mount via an effect (fetch → setState) is the app's
    // established pattern (orders, expiry, tasks, auto-tasfya). This React
    // Compiler-oriented rule flags it as an error; keep it as a warning so it
    // stays visible without failing the lint.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
