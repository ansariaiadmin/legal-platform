import tsParser from "@typescript-eslint/parser";
export default [
  {
    ignores: ["dist", "node_modules", ".next", "coverage", "apps/web", "packages"]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {}
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {}
  }
];
