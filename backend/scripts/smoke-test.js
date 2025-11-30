// Node smoke-test for backend API endpoints
// Run: node backend/scripts/smoke-test.js

const BASE = 'http://localhost:3001/api';

function log(title, obj) {
  console.log('\n--- ' + title + ' ---');
  if (obj === undefined) return;
  try { console.log(JSON.stringify(obj, null, 2)); } catch (e) { console.log(obj); }
}

async function run() {
  try {
    // Health
    try {
      const res = await fetch(`${BASE}/health`);
      const body = await res.text();
      log('HEALTH', { status: res.status, body: body });
    } catch (err) {
      log('HEALTH', { error: err.message });
    }

    // Signup
    const unique = Date.now();
    const email = `node-smoke+${unique}@example.com`;
    const signupPayload = { email, password: 'Password123!', name: 'Smoke Test', role: 'admin' };
    let token = null;

    try {
      const res = await fetch(`${BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupPayload),
      });
      const body = await res.json().catch(() => null);
      log('SIGNUP', { status: res.status, body });
    } catch (err) {
      log('SIGNUP', { error: err.message });
    }

    // Login
    try {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' }),
      });
      const body = await res.json();
      log('LOGIN', { status: res.status, body });
      if (body && body.token) token = body.token;
    } catch (err) {
      log('LOGIN', { error: err.message });
    }

    // Me
    if (token) {
      try {
        const res = await fetch(`${BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        log('ME', { status: res.status, body });
      } catch (err) {
        log('ME', { error: err.message });
      }
    } else {
      log('ME', 'No token returned; skipping /me');
    }

  } catch (err) {
    console.error('Unexpected error', err);
    process.exit(2);
  }
}

run();
