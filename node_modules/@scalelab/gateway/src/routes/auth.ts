import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

const cred = z.object({ email: z.string().email(), password: z.string().min(6) });

export async function authRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;
  const issue = async (rep: any, u: any) => {
    const token = app.jwt.sign({ id: u.id, email: u.email });
    rep.setCookie('sl_token', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 12 * 3600 });
    return { token, user: pub(u) };
  };
  const pub = (u: any) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, is_demo: u.is_demo });

  app.post('/auth/register', async (req, rep) => {
    const b = cred.extend({ full_name: z.string().max(100).default('') }).parse(req.body);
    const hash = await bcrypt.hash(b.password, 10);
    try {
      const { rows } = await pool.query('INSERT INTO users(email,full_name,password_hash) VALUES (lower($1),$2,$3) RETURNING *', [b.email, b.full_name, hash]);
      await pool.query('INSERT INTO user_prefs(user_id) VALUES ($1)', [rows[0].id]);
      return issue(rep, rows[0]);
    } catch (e: any) {
      if (e.code === '23505') return rep.code(409).send({ error: 'Пользователь с такой почтой уже есть' });
      throw e;
    }
  });

  app.post('/auth/login', async (req, rep) => {
    const b = cred.parse(req.body);
    const { rows } = await pool.query('SELECT * FROM users WHERE email=lower($1)', [b.email]);
    if (!rows[0] || !(await bcrypt.compare(b.password, rows[0].password_hash))) return rep.code(401).send({ error: 'Неверная почта или пароль' });
    return issue(rep, rows[0]);
  });

  app.post('/auth/demo', async (_req, rep) => {
    let { rows } = await pool.query("SELECT * FROM users WHERE email='demo@masshtablab.local'");
    if (!rows[0]) {
      const hash = await bcrypt.hash(cryptoRandom(), 10);
      rows = (await pool.query("INSERT INTO users(email,full_name,password_hash,is_demo) VALUES ('demo@masshtablab.local','Демо-оператор',$1,true) RETURNING *", [hash])).rows;
      await pool.query('INSERT INTO user_prefs(user_id) VALUES ($1)', [rows[0].id]);
    }
    return issue(rep, rows[0]);
  });

  app.post('/auth/logout', async (_req, rep) => { rep.clearCookie('sl_token', { path: '/' }); return { ok: true }; });

  app.get('/auth/me', { preHandler: app.auth }, async (req, rep) => {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return rep.code(401).send({ error: 'Требуется вход' });
    return pub(rows[0]);
  });
}

function cryptoRandom() { return randomBytes(18).toString('hex'); }
