import pg from 'pg';
import { loadConfig } from '../config';
import { runMigrations } from '../repo/migrate';

async function main() {
  const config = loadConfig(process.env);
  if (!config.DATABASE_URL) {
    console.log('No DATABASE_URL configured; in-memory store does not require SQL migrations.');
    return;
  }
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  try {
    console.log('Running PostGIS schema migrations...');
    await runMigrations(pool, (msg) => console.log(`  ${msg}`));
    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

void main();
