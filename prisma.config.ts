import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Keep generation available without a database; migrate commands still
    // reject the empty URL and require DATABASE_URL.
    url: process.env.DATABASE_URL ?? '',
  },
});
