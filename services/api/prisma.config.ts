import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI (migrate) targets the test database when PRISMA_TARGET=test.
    url:
      process.env['PRISMA_TARGET'] === 'test'
        ? process.env['DATABASE_URL_TEST']
        : process.env['DATABASE_URL'],
  },
});
