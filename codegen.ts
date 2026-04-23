import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: './apps/api/src/schema.graphql',
  documents: ['apps/web/src/operations/**/*.graphql'],
  generates: {
    'packages/shared/src/generated.ts': {
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-apollo',
      ],
      config: {
        withHooks: true,
        withComponent: false,
        withHOC: false,
        scalars: {
          DateTime: 'string',
        },
      },
    },
  },
};

export default config;
