import { buildApp } from './app.js';
import { config } from './config.js';
import { makePool, migrate } from './db.js';
import { makeNoSql } from './nosql.js';

const pool = makePool();
for (let i = 0; ; i++) {
  try { await pool.query('SELECT 1'); break; } catch (e) { if (i > 30) throw e; await new Promise((r) => setTimeout(r, 1000)); }
}
if (process.env.MIGRATE !== '0') console.log('migrations:', await migrate(pool));
const nosql = await makeNoSql();
const app = await buildApp({ pool, nosql });
await app.listen({ port: config.port, host: '0.0.0.0' });
