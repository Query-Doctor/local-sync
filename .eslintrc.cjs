module.exports = {
  plugins: ["import"],
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  overrides: [
    {
      files: ["**/__tests__/**/*"],
      env: {
        jest: true,
      },
    },
  ],
  rules: {
    "import/order": [
      1,
      {
        alphabetize: {
          caseInsensitive: true,
          order: "asc",
        },
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
        ],
        "newlines-between": "never",
        pathGroups: [
          {
            group: "external",
            pattern: "@nestjs/*",
            position: "before",
          },
          {
            group: "external",
            pattern: "nest*",
            position: "before",
          },
          {
            group: "internal",
            pattern: "config/**",
          },
          {
            group: "internal",
            pattern: "antlr/**",
          },
          {
            group: "internal",
            pattern: "db/**",
          },
          {
            group: "internal",
            pattern: "sql-parser/**",
          },
          {
            group: "internal",
            pattern: "versionning/**",
          },
          {
            group: "internal",
            pattern: "common",
          },
          {
            group: "internal",
            pattern: "types",
          },
        ],
        pathGroupsExcludedImportTypes: ["react*", "next*", "external, builtin"],
      },
    ],
  },
};
