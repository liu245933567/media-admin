import { defineConfig } from 'orval'

const openApiTarget = './openapi.json'

export default defineConfig({
  api: {
    input: {
      target: openApiTarget,
    },
    output: {
      target: './src/api/generated.ts',
      client: 'react-query',
      httpClient: 'axios',
      override: {
        enumGenerationType: 'union',
        mutator: {
          path: './src/api/axios-instance.ts',
          name: 'axiosInstance',
        },
      },
    },
    hooks: {
      afterAllFilesWrite: 'eslint --fix',
    },
  },
  apiSchemas: {
    input: {
      target: openApiTarget,
    },
    output: {
      target: './src/api/generated.schemas.ts',
      client: 'zod',
      override: {
        enumGenerationType: 'union',
      },
    },
    hooks: {
      afterAllFilesWrite: 'eslint --fix',
    },
  },
})
