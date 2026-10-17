import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function makePool(url = config.databaseUrl) {
  return new pg.Pool({ connectionString: url, max: 10 });
}
export type Pool = pg.Pool;

export async function migrate(pool: Pool, dir = config.migrationsDir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  return files;
}
