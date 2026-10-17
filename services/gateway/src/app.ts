import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CoreError } from './core.js';
import type { Pool } from './db.js';
import type { NoSql } from './nosql.js';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { sampleRoutes } from './routes/samples.js';
import { reportRoutes } from './routes/reports.js';
import { miscRoutes } from './routes/misc.js';
import { mobileRoutes } from './routes/mobile.js';

export interface Ctx { pool: Pool; nosql: NoSql }
declare module 'fastify' {
  interface FastifyInstance { ctx: Ctx; auth: (req: FastifyRequest, rep: FastifyReply) => Promise<void> }
}
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { id: string; email: string }; user: { id: string; email: string } }
}

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' }, bodyLimit: 10 * 1024 * 1024 });
  fs.mkdirSync(path.join(config.dataDir, 'images'), { recursive: true });
  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: 'sl_token', signed: false }, sign: { expiresIn: '12h' } });
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
  app.decorate('ctx', ctx);
  app.decorate('auth', async (req: FastifyRequest, rep: FastifyReply) => {
    try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Требуется вход' }); }
  });

  app.setErrorHandler((err: any, _req, rep) => {
    if (err instanceof CoreError) return rep.code(err.status).send({ error: err.message });
    if (err?.name === 'ZodError') return rep.code(400).send({ error: 'Некорректные данные', issues: err.issues });
    if (err?.code === '22P02') return rep.code(400).send({ error: 'Некорректный идентификатор' });
    if (err?.statusCode && err.statusCode < 500) return rep.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return rep.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  await app.register(async (api) => {
    await authRoutes(api);
    await sessionRoutes(api);
    await sampleRoutes(api);
    await reportRoutes(api);
    await miscRoutes(api);
    await mobileRoutes(api);
  }, { prefix: '/api' });
  return app;
}
