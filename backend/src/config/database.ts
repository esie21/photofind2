import { Pool, Client } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Support both DATABASE_URL (Railway/Heroku style) and individual variables
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'photofind',
    };

export const pool = new Pool(poolConfig);

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
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS category VARCHAR(100);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;`);
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

    // Reschedule tracking columns
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_by UUID;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_reason TEXT;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_start_date TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_end_date TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;`);

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

    // ==================== PAYMENT SYSTEM TABLES ====================

    // Wallets table - one per provider
    const walletsExist = await client.query(`SELECT to_regclass('public.wallets') as exists`);
    if (!walletsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE wallets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            available_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
            pending_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_wallet UNIQUE (provider_id)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE wallets (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            available_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
            pending_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_wallet UNIQUE (provider_id)
          );
        `);
      }
    }

    // Payments table - tracks PayMongo payments
    const paymentsExist = await client.query(`SELECT to_regclass('public.payments') as exists`);
    if (!paymentsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE payments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paymongo_payment_intent_id VARCHAR(255),
            paymongo_payment_method_id VARCHAR(255),
            idempotency_key VARCHAR(255) UNIQUE,
            gross_amount DECIMAL(12, 2) NOT NULL,
            commission_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
            commission_amount DECIMAL(12, 2) NOT NULL,
            net_provider_amount DECIMAL(12, 2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'PHP',
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded')),
            payment_method_type VARCHAR(50),
            failure_reason TEXT,
            paid_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_booking_payment UNIQUE (booking_id)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE payments (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paymongo_payment_intent_id VARCHAR(255),
            paymongo_payment_method_id VARCHAR(255),
            idempotency_key VARCHAR(255) UNIQUE,
            gross_amount DECIMAL(12, 2) NOT NULL,
            commission_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
            commission_amount DECIMAL(12, 2) NOT NULL,
            net_provider_amount DECIMAL(12, 2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'PHP',
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded')),
            payment_method_type VARCHAR(50),
            failure_reason TEXT,
            paid_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_booking_payment UNIQUE (booking_id)
          );
        `);
      }
    }

    // Add missing columns to payments table (for existing databases)
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_id ${refType} REFERENCES users(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_id ${refType} REFERENCES users(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paymongo_payment_intent_id VARCHAR(255);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paymongo_payment_method_id VARCHAR(255);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(12, 2);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5, 4) DEFAULT 0.15;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(12, 2);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_provider_amount DECIMAL(12, 2);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'PHP';`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_type VARCHAR(50);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Transactions table - tracks all wallet movements
    const transactionsExist = await client.query(`SELECT to_regclass('public.transactions') as exists`);
    if (!transactionsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
            payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
            payout_id UUID,
            type VARCHAR(50) NOT NULL CHECK (type IN ('payment_received', 'commission_deducted', 'payout_requested', 'payout_completed', 'payout_cancelled', 'refund', 'adjustment')),
            amount DECIMAL(12, 2) NOT NULL,
            balance_after DECIMAL(12, 2) NOT NULL,
            reference_id VARCHAR(255),
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE transactions (
            id SERIAL PRIMARY KEY,
            wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
            payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
            payout_id INTEGER,
            type VARCHAR(50) NOT NULL CHECK (type IN ('payment_received', 'commission_deducted', 'payout_requested', 'payout_completed', 'payout_cancelled', 'refund', 'adjustment')),
            amount DECIMAL(12, 2) NOT NULL,
            balance_after DECIMAL(12, 2) NOT NULL,
            reference_id VARCHAR(255),
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Payouts table - tracks provider payout requests
    const payoutsExist = await client.query(`SELECT to_regclass('public.payouts') as exists`);
    if (!payoutsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE payouts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
            amount DECIMAL(12, 2) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'failed')),
            payout_method VARCHAR(50),
            payout_details JSONB,
            rejection_reason TEXT,
            admin_notes TEXT,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE payouts (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
            amount DECIMAL(12, 2) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'failed')),
            payout_method VARCHAR(50),
            payout_details JSONB,
            rejection_reason TEXT,
            admin_notes TEXT,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Add missing columns to payouts table
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS payout_method VARCHAR(50);`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS payout_details JSONB;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS admin_notes TEXT;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Add foreign key for payout_id in transactions after payouts table exists
    try {
      if (usesUUID) {
        await client.query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;`);
      } else {
        await client.query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;`);
      }
    } catch (e) {
      // Constraint might already exist
    }

    // Payment system indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_client ON payments (client_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_paymongo_intent ON payments (paymongo_payment_intent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wallets_provider ON wallets (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions (wallet_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payouts_provider ON payouts (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status);`);

    // Add payment_status to bookings if not exists
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'unpaid';`);

    // ==================== AVAILABILITY SYSTEM TABLES ====================

    // Availability Rules - recurring weekly schedules
    const availRulesExist = await client.query(`SELECT to_regclass('public.availability_rules') as exists`);
    if (!availRulesExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE availability_rules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            slot_duration INTEGER NOT NULL DEFAULT 60,
            buffer_minutes INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT valid_time_range CHECK (end_time > start_time)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE availability_rules (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            slot_duration INTEGER NOT NULL DEFAULT 60,
            buffer_minutes INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT valid_time_range CHECK (end_time > start_time)
          );
        `);
      }
    }

    // Availability Overrides - exceptions for specific dates
    const availOverridesExist = await client.query(`SELECT to_regclass('public.availability_overrides') as exists`);
    if (!availOverridesExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE availability_overrides (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            override_date DATE NOT NULL,
            is_available BOOLEAN NOT NULL DEFAULT FALSE,
            start_time TIME,
            end_time TIME,
            reason VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_date UNIQUE (provider_id, override_date)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE availability_overrides (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            override_date DATE NOT NULL,
            is_available BOOLEAN NOT NULL DEFAULT FALSE,
            start_time TIME,
            end_time TIME,
            reason VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_date UNIQUE (provider_id, override_date)
          );
        `);
      }
    }

    // Time Slots - generated slots with status tracking
    const timeSlotsExist = await client.query(`SELECT to_regclass('public.time_slots') as exists`);
    if (!timeSlotsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE time_slots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_datetime TIMESTAMP NOT NULL,
            end_datetime TIMESTAMP NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'booked')),
            held_by UUID REFERENCES users(id) ON DELETE SET NULL,
            hold_expires_at TIMESTAMP,
            booking_id UUID,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_slot UNIQUE (provider_id, start_datetime)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE time_slots (
            id SERIAL PRIMARY KEY,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_datetime TIMESTAMP NOT NULL,
            end_datetime TIMESTAMP NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'booked')),
            held_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            hold_expires_at TIMESTAMP,
            booking_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_slot UNIQUE (provider_id, start_datetime)
          );
        `);
      }
    }

    // Availability system indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_avail_rules_provider ON availability_rules (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_avail_rules_day ON availability_rules (provider_id, day_of_week);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_avail_overrides_provider ON availability_overrides (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_avail_overrides_date ON availability_overrides (provider_id, override_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_time_slots_provider ON time_slots (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_time_slots_datetime ON time_slots (provider_id, start_datetime);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_time_slots_status ON time_slots (status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_time_slots_hold_expires ON time_slots (hold_expires_at) WHERE status = 'held';`);

    // ==================== NOTIFICATIONS TABLE ====================
    const notificationsExist = await client.query(`SELECT to_regclass('public.notifications') as exists`);
    if (!notificationsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            data JSONB,
            read_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            data JSONB,
            read_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Notifications indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read_at) WHERE read_at IS NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (type);`);

    // ==================== SOFT DELETE COLUMNS ====================
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'pending';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_documents JSONB;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);

    // ==================== REVIEWS TABLE ====================
    const reviewsExist = await client.query(`SELECT to_regclass('public.reviews') as exists`);
    if (!reviewsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE reviews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            is_visible BOOLEAN DEFAULT TRUE,
            moderation_status VARCHAR(50) DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged')),
            moderation_reason TEXT,
            moderated_by UUID REFERENCES users(id),
            moderated_at TIMESTAMP,
            deleted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_booking_reviewer UNIQUE (booking_id, reviewer_id)
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE reviews (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reviewee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            is_visible BOOLEAN DEFAULT TRUE,
            moderation_status VARCHAR(50) DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged')),
            moderation_reason TEXT,
            moderated_by INTEGER REFERENCES users(id),
            moderated_at TIMESTAMP,
            deleted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_booking_reviewer UNIQUE (booking_id, reviewer_id)
          );
        `);
      }
    }

    // Add missing columns to reviews table
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id ${refType};`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewee_id ${refType};`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(50) DEFAULT 'approved';`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_reason TEXT;`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_by ${refType};`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Reviews indexes - only create if columns exist
    const reviewColsCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'reviews' AND column_name IN ('reviewee_id', 'reviewer_id', 'booking_id')
    `);
    const existingCols = reviewColsCheck.rows.map((r: any) => r.column_name);

    if (existingCols.includes('reviewee_id')) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews (reviewee_id);`);
    }
    if (existingCols.includes('reviewer_id')) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews (reviewer_id);`);
    }
    if (existingCols.includes('booking_id')) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_booking ON reviews (booking_id);`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_moderation ON reviews (moderation_status);`);

    // ==================== DISPUTES TABLE ====================
    const disputesExist = await client.query(`SELECT to_regclass('public.disputes') as exists`);
    if (!disputesExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE disputes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            raised_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            against_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category VARCHAR(100) NOT NULL CHECK (category IN ('payment', 'service_quality', 'no_show', 'cancellation', 'communication', 'safety', 'other')),
            subject VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            evidence_urls TEXT[],
            status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'closed', 'escalated')),
            priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
            resolution TEXT,
            resolution_type VARCHAR(50) CHECK (resolution_type IN ('refund_full', 'refund_partial', 'no_refund', 'warning_issued', 'account_suspended', 'dismissed', 'other')),
            refund_amount DECIMAL(12, 2),
            assigned_to UUID REFERENCES users(id),
            resolved_by UUID REFERENCES users(id),
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE disputes (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            raised_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            against_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category VARCHAR(100) NOT NULL CHECK (category IN ('payment', 'service_quality', 'no_show', 'cancellation', 'communication', 'safety', 'other')),
            subject VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            evidence_urls TEXT[],
            status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'closed', 'escalated')),
            priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
            resolution TEXT,
            resolution_type VARCHAR(50) CHECK (resolution_type IN ('refund_full', 'refund_partial', 'no_refund', 'warning_issued', 'account_suspended', 'dismissed', 'other')),
            refund_amount DECIMAL(12, 2),
            assigned_to INTEGER REFERENCES users(id),
            resolved_by INTEGER REFERENCES users(id),
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Dispute comments table
    const disputeCommentsExist = await client.query(`SELECT to_regclass('public.dispute_comments') as exists`);
    if (!disputeCommentsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE dispute_comments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            comment TEXT NOT NULL,
            is_internal BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE dispute_comments (
            id SERIAL PRIMARY KEY,
            dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            comment TEXT NOT NULL,
            is_internal BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Disputes indexes - only create if disputes table exists
    const disputesTableExists = await client.query(`SELECT to_regclass('public.disputes') as exists`);
    if (disputesTableExists.rows[0].exists) {
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes (booking_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes (raised_by);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_priority ON disputes (priority);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_assigned ON disputes (assigned_to);`);
      } catch (e) {
        console.warn('Some dispute indexes could not be created:', e);
      }
    }
    const disputeCommentsExists = await client.query(`SELECT to_regclass('public.dispute_comments') as exists`);
    if (disputeCommentsExists.rows[0].exists) {
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_dispute_comments_dispute ON dispute_comments (dispute_id);`);
      } catch (e) {
        console.warn('Dispute comments index could not be created:', e);
      }
    }

    // ==================== AUDIT LOGS TABLE ====================
    const auditLogsExist = await client.query(`SELECT to_regclass('public.audit_logs') as exists`);
    if (!auditLogsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(100) NOT NULL,
            entity_id VARCHAR(255),
            old_values JSONB,
            new_values JSONB,
            ip_address VARCHAR(45),
            user_agent TEXT,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE audit_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(100) NOT NULL,
            entity_id VARCHAR(255),
            old_values JSONB,
            new_values JSONB,
            ip_address VARCHAR(45),
            user_agent TEXT,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Audit logs indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);`);

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
