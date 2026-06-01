import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  ignores: [
    'src/api/generated.schemas.ts',
    'src/api/generated.ts',
    'src/routeTree.gen.ts',
  ],
  rules: {
    'react-refresh/only-export-components': 'off',
  },
})
