import { MongoClient, type Db } from 'mongodb';
import { config } from './config.js';

type Doc = Record<string, any>;
export interface NoSql {
  insert(col: string, doc: Doc): Promise<string>;
  find(col: string, filter: Doc, opts?: { sort?: Record<string, 1 | -1>; limit?: number }): Promise<Doc[]>;
  findOne(col: string, filter: Doc): Promise<Doc | null>;
  upsert(col: string, filter: Doc, doc: Doc): Promise<void>;
  deleteMany(col: string, filter: Doc): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  kind: 'mongo' | 'memory';
}

const matches = (d: Doc, f: Doc) => Object.entries(f).every(([k, v]) => String(d[k]) === String(v));

export function memoryNoSql(): NoSql {
  const cols = new Map<string, Doc[]>();
  let seq = 0;
  const col = (n: string) => (cols.get(n) ?? cols.set(n, []).get(n)!);
  return {
    kind: 'memory',
    async insert(c, doc) { const _id = `m${++seq}`; col(c).push({ ...doc, _id }); return _id; },
    async find(c, f, o) {
      let r = col(c).filter((d) => matches(d, f));
      const s = o?.sort && Object.entries(o.sort)[0];
      if (s) r = [...r].sort((a, b) => (a[s[0]] > b[s[0]] ? 1 : a[s[0]] < b[s[0]] ? -1 : 0) * s[1]);
      return (o?.limit ? r.slice(0, o.limit) : r).map((d) => ({ ...d }));
    },
    async findOne(c, f) { const d = col(c).find((x) => matches(x, f)); return d ? { ...d } : null; },
    async upsert(c, f, doc) {
      const i = col(c).findIndex((x) => matches(x, f));
      if (i >= 0) col(c)[i] = { ...col(c)[i], ...doc }; else col(c).push({ ...f, ...doc, _id: `m${++seq}` });
    },
    async deleteMany(c, f) { cols.set(c, col(c).filter((d) => !matches(d, f))); },
    async ping() { return true; },
    async close() {},
  };
}

export async function mongoNoSql(): Promise<NoSql> {
  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db: Db = client.db(config.mongoDb);
  const strip = (d: any) => (d ? { ...d, _id: String(d._id) } : d);
  return {
    kind: 'mongo',
    async insert(c, doc) { const r = await db.collection(c).insertOne({ ...doc }); return String(r.insertedId); },
    async find(c, f, o) {
      let q = db.collection(c).find(f);
      if (o?.sort) q = q.sort(o.sort);
      if (o?.limit) q = q.limit(o.limit);
      return (await q.toArray()).map(strip);
    },
    async findOne(c, f) { return strip(await db.collection(c).findOne(f)); },
    async upsert(c, f, doc) { await db.collection(c).updateOne(f, { $set: doc }, { upsert: true }); },
    async deleteMany(c, f) { await db.collection(c).deleteMany(f); },
    async ping() { try { await db.command({ ping: 1 }); return true; } catch { return false; } },
    async close() { await client.close(); },
  };
}

export async function makeNoSql(): Promise<NoSql> {
  return config.nosql === 'memory' ? memoryNoSql() : mongoNoSql();
}
