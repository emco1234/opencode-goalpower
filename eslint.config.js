// ESLint v9 flat config
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "*.cjs",
      "test/**",
      // server.ts is a single-file plugin implementation with intentionally
      // loose authoring (unused exports kept for future split into prompts.ts/
      // state.ts). Lint catches noise that isn't real signal here.
      "src/server.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
    },
  },
)
