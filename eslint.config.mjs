import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/out/**', '**/release/**', '**/node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
