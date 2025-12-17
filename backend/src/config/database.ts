import { Pool, Client } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'photofind',
});

// Test the connection
pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

export async function testConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW()');
    console.log('Database connected successfully:', res.rows[0]);
  } finally {
    client.release();
  }
}

// Initialize database tables
export async function initializeTables() {
  const client = await pool.connect();
  try {
    // Detect if using UUID or INTEGER for user IDs
    const userIdTypeRes = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'id'
    `);
    const usesUUID = userIdTypeRes.rows.length > 0 && userIdTypeRes.rows[0].data_type === 'uuid';
    const idType = usesUUID ? 'UUID' : 'SERIAL';
    const refType = usesUUID ? 'UUID' : 'INTEGER';

    console.log(`Database schema type: ${usesUUID ? 'UUID' : 'INTEGER'}`);

    // Create users table (only if not exists)
    if (!usesUUID) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('client', 'provider', 'admin')),
          profile_image TEXT,
          portfolio_images TEXT[] DEFAULT '{}',
          bio TEXT,
          years_experience INTEGER DEFAULT 0,
          location VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    // Ensure new columns exist (safe for existing DBs)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_images TEXT[] DEFAULT '{}'::text[];`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS years_experience INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Create services table (only if not exists)
    const servicesExist = await client.query(`SELECT to_regclass('public.services') as exists`);
    if (!servicesExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE services (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            price DECIMAL(10, 2) NOT NULL,
            category VARCHAR(100),
            images TEXT[],
            duration_minutes INTEGER DEFAULT 60,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE services (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            price DECIMAL(10, 2) NOT NULL,
            category VARCHAR(100),
            images TEXT[],
            duration_minutes INTEGER DEFAULT 60,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS category VARCHAR(100);`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS images TEXT[];`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Add missing columns to bookings table (works for both UUID and INTEGER schemas)
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_date TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_date TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) DEFAULT 'request';`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Migrate old booking_date to start_date/end_date if needed
    try {
      await client.query(`
        UPDATE bookings
        SET start_date = booking_date::timestamp,
            end_date = booking_date::timestamp + interval '1 hour'
        WHERE start_date IS NULL AND booking_date IS NOT NULL;
      `);
    } catch (e) {
      // booking_date column may not exist, that's fine
    }

    // Create availability_slots table (only if not exists)
    const availSlotsExist = await client.query(`SELECT to_regclass('public.availability_slots') as exists`);
    if (!availSlotsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE availability_slots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            is_bookable BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE availability_slots (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            is_bookable BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_provider_start ON bookings (provider_id, start_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_provider_end ON bookings (provider_id, end_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_availability_provider_start ON availability_slots (provider_id, start_time);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_availability_provider_end ON availability_slots (provider_id, end_time);`);

    // Check if chats table has wrong column types and drop if needed
    const chatsColType = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'chats' AND column_name = 'user_a'
    `);
    if (chatsColType.rows.length > 0) {
      const currentType = chatsColType.rows[0].data_type;
      const expectedType = usesUUID ? 'uuid' : 'integer';
      if (currentType !== expectedType) {
        console.log(`Dropping chats-related tables due to type mismatch (${currentType} vs ${expectedType})`);
        await client.query(`DROP TABLE IF EXISTS chat_messages CASCADE;`);
        await client.query(`DROP TABLE IF EXISTS messages CASCADE;`);
        await client.query(`DROP TABLE IF EXISTS chats CASCADE;`);
      }
    }

    // Check if conversations table has wrong column types and drop if needed
    const convsColType = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'conversations' AND column_name = 'user_a'
    `);
    if (convsColType.rows.length > 0) {
      const currentType = convsColType.rows[0].data_type;
      const expectedType = usesUUID ? 'uuid' : 'integer';
      if (currentType !== expectedType) {
        console.log(`Dropping conversations table due to type mismatch (${currentType} vs ${expectedType})`);
        await client.query(`DROP TABLE IF EXISTS conversations CASCADE;`);
      }
    }

    // Create chats table with correct type based on schema
    const chatsExist = await client.query(`SELECT to_regclass('public.chats') as exists`);
    if (!chatsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE chats (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
            user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE chats (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Add missing columns to chats table if they don't exist
    await client.query(
      `ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`
    );
    await client.query(
      `ALTER TABLE chats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`
    );

    // Create chat_messages table with correct type based on schema
    const chatMsgsExist = await client.query(`SELECT to_regclass('public.chat_messages') as exists`);
    if (!chatMsgsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE chat_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
            sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
            content TEXT,
            attachment_url TEXT,
            attachment_type VARCHAR(50),
            attachment_name TEXT,
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE chat_messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
            sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            content TEXT,
            attachment_url TEXT,
            attachment_type VARCHAR(50),
            attachment_name TEXT,
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP
          );
        `);
      }
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_chats_booking ON chats (booking_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats (updated_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created ON chat_messages (chat_id, created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_read ON chat_messages (chat_id, read_at);`);

    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_chats_booking_id ON chats (booking_id) WHERE booking_id IS NOT NULL;`
    );

    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_chats_direct_pair ON chats (user_a, user_b) WHERE booking_id IS NULL;`
    );

    // Conversations table (user-to-user threads)
    const convsExist = await client.query(`SELECT to_regclass('public.conversations') as exists`);
    if (!convsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_conversation_pair UNIQUE (user_a, user_b)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE conversations (
            id SERIAL PRIMARY KEY,
            user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_conversation_pair UNIQUE (user_a, user_b)
          );
        `);
      }
    }

    // Messages table
    const msgsExist = await client.query(`SELECT to_regclass('public.messages') as exists`);
    if (!msgsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
            sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
            sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP
          );
        `);
      }
    }

    await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;`);

    // Helpful indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at DESC);`);

    console.log('Database tables initialized successfully');
    // Seed admin user if not present
    const adminEmail = process.env.ADMIN_EMAIL || 'esiecadungog772@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || '12345678';
    const adminName = process.env.ADMIN_NAME || 'Admin';

    const adminCheck = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (adminCheck.rows.length === 0) {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await client.query(
        'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
        [adminEmail, adminName, hashed, 'admin']
      );
      console.log(`Admin user created: ${adminEmail}`);
    } else {
      console.log('Admin user already exists');
    }
  } catch (error) {
    console.error('Error initializing tables:', error);
  } finally {
    client.release();
  }
}

export default pool;
