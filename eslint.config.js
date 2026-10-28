import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default [
  { ignores: ["dist/**"] },
  ...svelte.configs["flat/recommended"],
  js.configs.recommended,
  {
    files: ["src/**/*.{js,svelte}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
