// Express application factory (no listen() here, so tests can mount it).

import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { PLATFORM_ROOT, config } from './config.mjs';
import { getDb } from './db/index.mjs';
import { logSystemError } from './lib/activity.mjs';
import { HttpError } from './http/util.mjs';
import { sessionMiddleware, csrfMiddleware, requireAuth, requireAdmin } from './http/auth-middleware.mjs';
import { authRoutes } from './http/routes/auth.mjs';
import { resumeRoutes } from './http/routes/resumes.mjs';
import { jobRoutes, searchRoutes } from './http/routes/jobs.mjs';
import { applicationRoutes, dashboardRoute } from './http/routes/applications.mjs';
import { meRoutes } from './http/routes/me.mjs';
import { adminRoutes } from './http/routes/admin.mjs';

export function createApp({ db = getDb } = {}) {
  const getConn = typeof db === 'function' ? db : () => db;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        'upgrade-insecure-requests': null, // the app may be served over http (LAN) and https (tunnel) at once
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.publicUrl.startsWith('https://'),
  }));

  app.use('/api', express.json({ limit: '200kb' }));
  app.use('/api', express.urlencoded({ extended: false, limit: '50kb' }));
  app.use('/api', sessionMiddleware(getConn));
  app.use('/api', csrfMiddleware);
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (req, res) => {
    try { getConn().prepare('SELECT 1').get(); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use('/api/auth', authRoutes(getConn));
  app.get('/api/dashboard', requireAuth, dashboardRoute(getConn));
  app.use('/api/me', requireAuth, meRoutes(getConn));
  app.use('/api/me', requireAuth, searchRoutes(getConn));
  app.use('/api/resumes', requireAuth, resumeRoutes(getConn));
  app.use('/api/jobs', requireAuth, jobRoutes(getConn));
  app.use('/api/applications', requireAuth, applicationRoutes(getConn));
  app.use('/api/admin', requireAdmin, adminRoutes(getConn));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Static front-end. Chart.js is served from node_modules so nothing loads from a CDN.
  const pub = path.join(PLATFORM_ROOT, 'public');
  app.use('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(PLATFORM_ROOT, 'node_modules/chart.js/dist/chart.umd.js')));
  app.use(express.static(pub, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
  // SPA routes.
  const index = path.join(pub, 'index.html');
  app.get(['/', '/login', '/register', '/forgot-password', '/reset-password', '/app', '/app/*', '/admin', '/admin/*'], (req, res) => {
    if (!existsSync(index)) return res.status(500).send('Front-end missing');
    res.sendFile(index);
  });
  app.use((req, res) => res.status(404).sendFile(index));

  // Errors: typed HttpErrors are shown; anything else is logged and hidden.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
    logSystemError(getConn(), `${req.method} ${req.path}`, err);
    if (config.env !== 'test') console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. The error was logged for the administrator.' });
  });
  return app;
}
