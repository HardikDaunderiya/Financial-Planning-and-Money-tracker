const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const tseslint = require("typescript-eslint");
const react = require("eslint-plugin-react");

module.exports = defineConfig([
  expoConfig,
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ["**/*.ts", "**/*.tsx"] })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["src/features/x/*.ts"] },
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { react },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "react/jsx-no-leaked-render": ["error", { validStrategies: ["ternary", "coerce"] }],
    },
  },
  {
    files: ["*.js"],
    languageOptions: { globals: { __dirname: "readonly", module: "writable", require: "readonly" } },
  },
  {
    files: ["src/lib/log.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    ignores: ["node_modules/", ".expo/", "dist/", "scripts/**/*.mjs", "e2e/scripts/*.js"],
  },
]);
