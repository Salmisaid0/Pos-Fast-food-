const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const prettier = require("eslint-config-prettier");

const sharedPackageImportRestrictions = [
  {
    group: ["../../apps/*", "../../../apps/*"],
    message: "Shared packages must not import app-layer code.",
  },
  {
    group: ["../../shared-types/src", "../shared-types/src", "../../packages/shared-types/src"],
    message: "Use the @packages/shared-types workspace import instead of relative package paths.",
  },
];

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", ".turbo/**", "coverage/**", "**/*.tsbuildinfo"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-restricted-imports": ["error", { patterns: sharedPackageImportRestrictions }],
    },
  },
  {
    files: ["apps/pos-desktop/**/*.ts", "apps/pos-desktop/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../api/*",
                "../api/*",
                "../../workers/*",
                "../workers/*",
                "@apps/api",
                "@apps/workers",
              ],
              message: "The POS desktop client must not import API or worker implementation code.",
            },
          ],
        },
      ],
    },
  },
  prettier,
];
