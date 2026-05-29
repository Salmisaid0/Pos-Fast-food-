module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: ["dist", "node_modules", ".turbo", "coverage", "*.tsbuildinfo"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../../apps/*", "../../../apps/*"],
            message: "Shared packages must not import app-layer code.",
          },
          {
            group: [
              "../../shared-types/src",
              "../shared-types/src",
              "../../packages/shared-types/src",
            ],
            message:
              "Use the @packages/shared-types workspace import instead of relative package paths.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["apps/pos-desktop/**/*.ts"],
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
                message:
                  "The POS desktop client must not import API or worker implementation code.",
              },
            ],
          },
        ],
      },
    },
  ],
};
