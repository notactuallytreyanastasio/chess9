import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

// Hard ban on `any` and other escape hatches — enforces the "strong contracts"
// requirement at lint time, on top of strict tsconfig.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: 'Casting to any is forbidden.',
        },
        {
          selector: "TSTypeAssertion",
          message: 'Angle-bracket type assertions are forbidden; model the type instead.',
        },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
];
