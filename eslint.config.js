import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  ignores: ['src/types/api.ts'],
  rules: {
    'react-refresh/only-export-components': 'off',
  },
})
