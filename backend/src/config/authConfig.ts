/**
 * The signing secret for every JWT this app issues and verifies.
 *
 * Six call sites used to read `process.env.JWT_SECRET || 'your_secret_key'` inline. That
 * fallback is committed to the repository, so an environment that simply forgot to set
 * JWT_SECRET did not fail - it silently signed and accepted tokens under a string anyone
 * can read, which is enough to mint a token for any userId with role 'admin'. A missing
 * secret is not a condition to paper over with a default, so this throws instead.
 *
 * Read at import time, which runs after loadEnv (server.ts imports it first), so the
 * process refuses to start rather than serving traffic with forgeable sessions.
 */

// The value that used to be the inline fallback. Rejected explicitly: an environment
// that copied it out of the old source or an example file is no better off than one
// that set nothing at all.
const PUBLICLY_KNOWN_SECRET = 'your_secret_key';

// Below this, a secret is guessable by brute force rather than by reading the repo.
const MIN_SECRET_LENGTH = 32;

function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start: without it every session token would be ' +
        'signed with a hardcoded value and could be forged by anyone. Set JWT_SECRET to a ' +
        `random string of at least ${MIN_SECRET_LENGTH} characters.`
    );
  }

  if (secret === PUBLICLY_KNOWN_SECRET) {
    throw new Error(
      'JWT_SECRET is set to the old hardcoded placeholder, which is published in this ' +
        'repository and offers no protection. Replace it with a random secret.'
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is only ${secret.length} characters. Use at least ${MIN_SECRET_LENGTH} ` +
        'random characters so it cannot be brute-forced.'
    );
  }

  return secret;
}

export const JWT_SECRET = readJwtSecret();
