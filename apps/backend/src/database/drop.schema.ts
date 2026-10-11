// DEV-ONLY: drop the entire public schema (tables, enums, indices, data).
//
//   pnpm db:reset:dev        (= db:drop:dev + db:migrate)
//
// This replaces the old `db:reset` (schema:drop + schema:sync) — schema:sync
// is banned under the migrations-only workflow (P1-5). Refuses to run with
// NODE_ENV=production.

import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';

async function main() {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('❌ db:reset:dev refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    console.log('✅ public schema dropped (dev only) — run `pnpm db:migrate` to recreate it');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('❌ schema drop failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
