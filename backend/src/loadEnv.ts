import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// Pin the process to Manila time so slot generation, hold expiry, and any
// other server-side Date math match the business's actual timezone instead
// of whatever the host machine defaults to (commonly UTC on hosting).
process.env.TZ = process.env.TZ || 'Asia/Manila';
