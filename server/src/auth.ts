// Identifies the user from a Firebase ID token (Google sign-in). The token is
// verified against Google's public keys; no service account is needed.
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getUserByEmail, upsertUser, type UserRow } from './db.ts';

const PROJECT = process.env.FIREBASE_PROJECT_ID;
if (!PROJECT && !process.env.DEV_USER_EMAIL) throw new Error('Set FIREBASE_PROJECT_ID in .env (see README).');
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

// For local development only: skip sign-in and act as this email.
const DEV_EMAIL = process.env.DEV_USER_EMAIL;
if (DEV_EMAIL) console.warn(`DEV_USER_EMAIL set: sign-in is skipped and every request is ${DEV_EMAIL}`);

export const requireUser = createMiddleware<{ Variables: { user: UserRow } }>(async (c, next) => {
  if (DEV_EMAIL) {
    c.set('user', getUserByEmail(DEV_EMAIL));
    return next();
  }
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'not signed in' }, 401);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${PROJECT}`,
      audience: PROJECT,
    });
    if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
      throw new Error('token has no verified email');
    }
    const name = typeof payload.name === 'string' ? payload.name : null;
    c.set('user', upsertUser(payload.sub, payload.email.toLowerCase(), name));
  } catch (err) {
    console.warn('Firebase token rejected:', (err as Error).message);
    return c.json({ error: 'invalid session' }, 401);
  }
  return next();
});
