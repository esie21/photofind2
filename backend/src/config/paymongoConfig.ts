/**
 * PayMongo credentials and the URL PayMongo sends the client back to, read and checked once.
 *
 * These used to be read inline as `process.env.X || ''` in two files. An empty or mistyped
 * key did not stop the server: it started, answered /health, and then failed every single
 * payment with a PayMongo 401 that reached the client as "Failed to create payment intent".
 * A missing webhook secret was worse - every webhook was refused, so QR Ph payments (which
 * settle only by webhook once the client closes the tab) were taken but never recorded.
 *
 * In production a broken configuration now refuses to start, the same way authConfig does
 * for JWT_SECRET. Outside production it only warns, because payments are optional for local
 * development and a developer without PayMongo keys should still be able to run the app.
 *
 * Read at import time, which runs after loadEnv (server.ts imports it first).
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export type PayMongoMode = 'live' | 'test' | 'unconfigured';

function modeOf(key: string, secretPrefix: 'sk' | 'pk'): 'live' | 'test' | null {
  if (key.startsWith(`${secretPrefix}_live_`)) return 'live';
  if (key.startsWith(`${secretPrefix}_test_`)) return 'test';
  return null;
}

// The values shipped in .env.example. Copied verbatim they look set but authenticate nothing.
function isPlaceholder(value: string): boolean {
  return /x{3,}$/i.test(value) || value.includes('your_') || value.includes('<');
}

function readConfig() {
  const secretKey = (process.env.PAYMONGO_SECRET_KEY || '').trim();
  const publicKey = (process.env.PAYMONGO_PUBLIC_KEY || '').trim();
  const webhookSecret = (process.env.PAYMONGO_WEBHOOK_SECRET || '').trim();
  // Trailing slash stripped: return_url is built as `${base}/payment/callback`, and a
  // FRONTEND_URL set as "https://site.com/" produced "//payment/callback".
  const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');

  const problems: string[] = [];

  if (!secretKey || isPlaceholder(secretKey)) {
    problems.push('PAYMONGO_SECRET_KEY is not set (or is still the example placeholder).');
  }
  if (!publicKey || isPlaceholder(publicKey)) {
    problems.push('PAYMONGO_PUBLIC_KEY is not set (or is still the example placeholder).');
  }
  if (!webhookSecret || isPlaceholder(webhookSecret)) {
    problems.push(
      'PAYMONGO_WEBHOOK_SECRET is not set (or is still the example placeholder). Without it ' +
        'every webhook is refused and QR Ph payments are never recorded.'
    );
  }

  const secretMode = secretKey ? modeOf(secretKey, 'sk') : null;
  const publicMode = publicKey ? modeOf(publicKey, 'pk') : null;

  // Swapped keys are an easy paste mistake, and the public key is sent to every browser -
  // so a secret key in the public slot would publish it.
  if (publicKey.startsWith('sk_')) {
    problems.push('PAYMONGO_PUBLIC_KEY holds a SECRET key (sk_...). It would be sent to browsers - swap them.');
  } else if (publicKey && !isPlaceholder(publicKey) && !publicMode) {
    problems.push('PAYMONGO_PUBLIC_KEY does not look like a PayMongo public key (pk_live_... or pk_test_...).');
  }
  if (secretKey && !isPlaceholder(secretKey) && !secretMode) {
    problems.push('PAYMONGO_SECRET_KEY does not look like a PayMongo secret key (sk_live_... or sk_test_...).');
  }

  // A live secret with a test public key (or the reverse) half-works: intents are created
  // in one mode and the browser tries to attach methods in the other, and every payment
  // fails with "resource not found" long after the deploy looked healthy.
  if (secretMode && publicMode && secretMode !== publicMode) {
    problems.push(
      `PayMongo keys are from different modes: secret is ${secretMode}, public is ${publicMode}. ` +
        'Use both live keys or both test keys.'
    );
  }

  // FRONTEND_URL is where PayMongo returns the client after 3D Secure or an e-wallet
  // authorisation. The old fallback was http://localhost:3000, which in production sends a
  // paying client to their own machine. Still the right default for local development.
  if (IS_PRODUCTION && !frontendUrl) {
    problems.push('FRONTEND_URL is not set, so PayMongo would return clients to localhost after paying.');
  } else if (IS_PRODUCTION && !frontendUrl.startsWith('https://')) {
    problems.push(`FRONTEND_URL must be https in production (got ${frontendUrl}).`);
  }

  const mode: PayMongoMode =
    secretMode && publicMode && secretMode === publicMode && webhookSecret ? secretMode : 'unconfigured';

  if (problems.length > 0) {
    const message = 'PayMongo configuration problems:\n  - ' + problems.join('\n  - ');
    if (IS_PRODUCTION) {
      throw new Error(message + '\nRefusing to start: payments would fail or go unrecorded.');
    }
    console.warn(message + '\n(Not production, so starting anyway. Payments will fail until this is fixed.)');
  }

  if (IS_PRODUCTION && mode === 'test') {
    // Not fatal: a staging deploy legitimately runs NODE_ENV=production on test keys. But on
    // the real site it means nobody is actually being charged, so say it loudly.
    console.warn(
      '*** PayMongo is in TEST mode on a production build. No real money will be collected. ***'
    );
  }

  return {
    secretKey,
    publicKey,
    webhookSecret,
    mode,
    returnUrl: `${frontendUrl || 'http://localhost:3000'}/payment/callback`,
  };
}

const config = readConfig();

export const PAYMONGO_SECRET_KEY = config.secretKey;
export const PAYMONGO_PUBLIC_KEY = config.publicKey;
export const PAYMONGO_WEBHOOK_SECRET = config.webhookSecret;
export const PAYMONGO_MODE: PayMongoMode = config.mode;
/** Where PayMongo sends the client after 3D Secure / e-wallet authorisation. */
export const PAYMENT_RETURN_URL = config.returnUrl;

console.log(`PayMongo mode: ${PAYMONGO_MODE}`);
