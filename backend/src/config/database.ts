import '../loadEnv';
import { Pool, Client } from 'pg';
import bcrypt from 'bcryptjs';

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

// The app's business timezone is Asia/Manila (see loadEnv.ts and the availability
// slot-generation logic), but the DB server's own default session timezone is
// whatever the host defaults to (commonly UTC on managed providers). Without this,
// DATE(...)/EXTRACT(... FROM ...) on timestamptz columns truncate/extract using
// the wrong day, silently misfiling early-morning Manila slots under the previous
// UTC calendar day. Set it per physical connection so every session agrees.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Manila'").catch((err) => {
    console.error('Failed to set session timezone to Asia/Manila:', err);
  });
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
    // Per-image caption and album, keyed by the stored image path:
    //   { "users/<id>/portfolio/123.jpg": { "caption": "...", "album": "Weddings" } }
    // Keyed by path rather than by index so it survives reordering and removal, and
    // deliberately separate from portfolio_images, which stays the single source of
    // truth for what exists and in what order. Rows with no metadata just have '{}'.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_meta JSONB DEFAULT '{}'::jsonb;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS years_experience INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS category VARCHAR(100);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;`);

    // Tracks whether this account has a password its owner actually knows, as opposed to
    // the random one generated on Google sign-up (see routes/auth.ts). NULL means "no
    // known password yet" and lets change-password skip asking for a current one; a real
    // timestamp means one must be verified. Unlike most columns below, NULL here is a
    // meaningful, permanent steady state for Google-only accounts - so the backfill for
    // pre-existing rows has to run exactly once, the boot this column is introduced, not
    // on every boot like the IS-NULL-guarded backfills elsewhere in this file. Re-running
    // it later would stamp a timestamp onto a genuinely-still-passwordless Google account
    // created after that first boot and silently break the flow for them.
    const passwordSetAtExists = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'password_set_at'
    `);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMP;`);
    if (passwordSetAtExists.rows.length === 0) {
      // Safest default for every account that already exists: assume it has a real,
      // known password unless this migration proves otherwise going forward. That never
      // lets an existing password holder skip re-entering it; the cost is that an
      // existing Google-only account stays unable to use change-password until it sets
      // a password via "forgot password" instead - the same limitation it already had.
      await client.query(`UPDATE users SET password_set_at = created_at WHERE password_set_at IS NULL;`);
    }

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
    // pricing_type: 'package' (fixed price) or 'hourly' (price per hour)
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) DEFAULT 'package';`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS package_price DECIMAL(10, 2);`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10, 2);`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS hourly_price DECIMAL(10, 2);`);
    // Backfill pricing columns from legacy price field
    await client.query(`
      UPDATE services SET package_price = price
      WHERE package_price IS NULL AND (pricing_type IS NULL OR pricing_type IN ('package', 'both'));
    `);
    await client.query(`
      UPDATE services SET hourly_rate = COALESCE(hourly_price, price)
      WHERE hourly_rate IS NULL AND pricing_type IN ('hourly', 'both');
    `);

    // Create bookings table (only if not exists)
    const bookingsExist = await client.query(`SELECT to_regclass('public.bookings') as exists`);
    if (!bookingsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE bookings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            service_id UUID REFERENCES services(id) ON DELETE SET NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed', 'confirmed', 'awaiting_confirmation', 'disputed')),
            notes TEXT,
            start_date TIMESTAMPTZ,
            end_date TIMESTAMPTZ,
            booking_mode VARCHAR(20) DEFAULT 'request',
            payment_status VARCHAR(50) DEFAULT 'unpaid',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE bookings (
            id SERIAL PRIMARY KEY,
            client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed', 'confirmed', 'awaiting_confirmation', 'disputed')),
            notes TEXT,
            start_date TIMESTAMPTZ,
            end_date TIMESTAMPTZ,
            booking_mode VARCHAR(20) DEFAULT 'request',
            payment_status VARCHAR(50) DEFAULT 'unpaid',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Add missing columns to bookings table (works for both UUID and INTEGER schemas)
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) DEFAULT 'request';`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Payment deadline tracking. Clients pay after the provider confirms, and until now
    // nothing bounded that wait - an accepted booking could sit unpaid past its own date
    // indefinitely while still blocking the slot. See config/paymentConfig.ts.
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reminder_sent_at TIMESTAMP;`);
    // Why a booking was cancelled. 'cancelled' now covers both a person cancelling and a
    // payment deadline passing, and those read very differently to whoever it happened to.
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_bookings_payment_due ON bookings (payment_due_at)
       WHERE payment_due_at IS NOT NULL;`
    );

    // Give bookings that were already accepted before this column existed a deadline.
    // Deliberately measured from now rather than from their original acceptance: dating it
    // backwards would have the first sweep after deploy cancel live bookings that never
    // had a deadline to miss, without the client ever being told one existed. The same
    // two rules as computePaymentDueAt - 24h, no later than 2h before the start, never
    // less than 30 minutes - so a booking starting soon still can't slip through unpaid.
    // Guarded by IS NULL, so it only ever touches a row once.
    try {
      const backfilled = await client.query(
        `UPDATE bookings
         SET payment_due_at = GREATEST(
               NOW() + INTERVAL '30 minutes',
               LEAST(NOW() + INTERVAL '24 hours', start_date - INTERVAL '2 hours')
             )
         WHERE payment_due_at IS NULL
           AND status IN ('accepted', 'confirmed')
           AND COALESCE(payment_status, 'unpaid') <> 'paid'`
      );
      if (backfilled.rowCount) {
        console.log(`Set a payment deadline on ${backfilled.rowCount} already-accepted unpaid booking(s).`);
      }
    } catch (e) {
      console.log('payment_due_at backfill skipped (non-fatal):', (e as Error).message);
    }

    // Reschedule tracking columns
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_by UUID;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_reason TEXT;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_start_date TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_end_date TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;`);
    // Set when an already-accepted/confirmed booking is rescheduled, so the other
    // party must confirm or reject the new time instead of it taking effect unilaterally.
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_pending_approval BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_previous_start_date TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_previous_end_date TIMESTAMPTZ;`);

    // Dual confirmation columns for service completion verification
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_completed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completion_notes TEXT;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_raised BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_reason TEXT;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_raised_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_resolution TEXT;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_resolved_by ${refType};`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_warning_sent_at TIMESTAMP;`);

    // Update status column size and CHECK constraint to include new statuses
    try {
      // First, check current column size and increase if needed
      const statusColInfo = await client.query(`
        SELECT character_maximum_length FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'status'
      `);
      const currentSize = statusColInfo.rows[0]?.character_maximum_length;
      if (currentSize && currentSize < 30) {
        console.log(`Increasing bookings.status column size from ${currentSize} to 50...`);
        await client.query(`ALTER TABLE bookings ALTER COLUMN status TYPE VARCHAR(50);`);
      }

      // Drop old constraint if exists
      await client.query(`ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;`);
      // Add new constraint with all statuses
      await client.query(`
        ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed', 'confirmed', 'awaiting_confirmation', 'disputed'));
      `);
      console.log('Updated bookings status constraint to include new statuses.');
    } catch (e) {
      console.log('Could not update bookings status constraint (may already be correct):', (e as Error).message);
    }

    // Migrate booking timestamp columns from TIMESTAMP (no timezone) to TIMESTAMPTZ.
    // Without a timezone, these columns silently stored/reread times using whatever
    // the server host's ambient timezone happened to be (often UTC), not Manila —
    // causing booking times to drift by hours depending on where the app is hosted.
    // Existing naive values are interpreted as Asia/Manila wall-clock time, since
    // that's the timezone the app's UI and users have always operated in.
    for (const col of ['start_date', 'end_date', 'original_start_date', 'original_end_date', 'reschedule_previous_start_date', 'reschedule_previous_end_date']) {
      const colInfo = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = $1
      `, [col]);
      if (colInfo.rows[0]?.data_type === 'timestamp without time zone') {
        console.log(`Migrating bookings.${col} to TIMESTAMPTZ...`);
        await client.query(`
          ALTER TABLE bookings ALTER COLUMN ${col} TYPE TIMESTAMPTZ
          USING ${col} AT TIME ZONE 'Asia/Manila';
        `);
      }
    }

    // Migrate old booking_date to start_date/end_date if the column exists
    const bookingDateCol = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'booking_date'
    `);
    if (bookingDateCol.rows.length > 0) {
      await client.query(`
        UPDATE bookings
        SET start_date = booking_date::timestamp,
            end_date = booking_date::timestamp + interval '1 hour'
        WHERE start_date IS NULL AND booking_date IS NOT NULL;
      `);
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

    // ==================== BOOKING EVIDENCE TABLE ====================
    const bookingEvidenceExist = await client.query(`SELECT to_regclass('public.booking_evidence') as exists`);
    if (!bookingEvidenceExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE booking_evidence (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            evidence_type VARCHAR(20) NOT NULL CHECK (evidence_type IN ('before', 'after', 'during', 'other')),
            file_url TEXT NOT NULL,
            caption TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE booking_evidence (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            evidence_type VARCHAR(20) NOT NULL CHECK (evidence_type IN ('before', 'after', 'during', 'other')),
            file_url TEXT NOT NULL,
            caption TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Booking evidence indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_booking_evidence_booking ON booking_evidence (booking_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_booking_evidence_uploaded_by ON booking_evidence (uploaded_by);`);

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
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
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
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
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
    // Tracks the underlying PayMongo payment resource (distinct from the payment_intent),
    // required to issue refunds, plus refund bookkeeping for dispute resolutions.
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paymongo_payment_id VARCHAR(255);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paymongo_refund_id VARCHAR(255);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_status VARCHAR(50);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(12, 2);`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;`);
    // Atomic "have we already credited the provider's wallet for this payment" gate.
    // A card can resolve to 'succeeded' synchronously during the attach-method call
    // (no 3D Secure needed), so wallet crediting can't be keyed off "did *this* code
    // path just flip status to succeeded" - attach-method, /confirm, and the webhook
    // all race for the same payment, and whichever transitions status first must not
    // be the only one allowed to credit. This column is the single source of truth.
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_credited_at TIMESTAMP;`);

    // Widen the payments status constraint to allow partial refunds (older databases
    // may still have the constraint from before 'partially_refunded' was supported).
    try {
      await client.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;`);
      await client.query(`
        ALTER TABLE payments ADD CONSTRAINT payments_status_check
        CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded'));
      `);
      console.log('Updated payments status constraint to include partially_refunded.');
    } catch (e) {
      console.log('Could not update payments status constraint (may already be correct):', (e as Error).message);
    }

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
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS wallet_id ${refType};`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS payout_method VARCHAR(50);`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS payout_details JSONB;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS admin_notes TEXT;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Fix payouts foreign key - should reference users table, not providers table
    try {
      // Drop incorrect foreign key if it exists (references providers table)
      await client.query(`ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_provider_id_fkey;`);
      // Add correct foreign key to users table
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'payouts_provider_id_users_fkey' AND table_name = 'payouts'
          ) THEN
            ALTER TABLE payouts ADD CONSTRAINT payouts_provider_id_users_fkey
              FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    } catch (fkError) {
      console.log('Payouts FK fix (non-fatal):', fkError);
    }

    // Add foreign key for payout_id in transactions after payouts table exists (only if not exists)
    const fkExists = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_transactions_payout' AND table_name = 'transactions'
    `);
    if (fkExists.rows.length === 0) {
      await client.query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;`);
    }

    // Audit actions are dotted ('dispute.resolve', 'user.delete'). Two writes in
    // bookings.ts used to bypass auditService and insert snake_case names instead, so
    // history contains both styles and filtering by 'dispute.' missed the real dispute
    // resolutions. Rename the legacy rows so past and future agree. Idempotent.
    try {
      const renames: Array<[string, string]> = [
        ['dispute_resolved', 'dispute.resolve'],
        ['dispute_auto_resolved', 'dispute.auto_resolve'],
      ];
      for (const [from, to] of renames) {
        const r = await client.query('UPDATE audit_logs SET action = $1 WHERE action = $2', [to, from]);
        if (r.rowCount) console.log(`Renamed ${r.rowCount} audit_logs row(s) from '${from}' to '${to}'.`);
      }
    } catch (e) {
      console.log('audit action rename skipped (non-fatal):', (e as Error).message);
    }

    // One providers row per user.
    //
    // providers.user_id had no unique constraint, and the "create the row on first use"
    // helpers in services.ts / bookings.ts did a plain INSERT after a SELECT miss - so
    // two concurrent requests for the same brand-new provider could each insert a row.
    // A user with two rows then had their services and bookings split across both, and
    // the ownership check ("You can only update your own services") rejected whichever
    // half wasn't under the row that got resolved.
    //
    // Fold every duplicate onto the oldest row, then add the constraint so it can't
    // recur. Both steps are idempotent and no-op once the data is clean.
    try {
      const dupes = await client.query(`
        SELECT user_id, COUNT(*) AS n FROM providers GROUP BY user_id HAVING COUNT(*) > 1
      `);
      for (const row of dupes.rows) {
        const all = await client.query(
          `SELECT id FROM providers WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
          [row.user_id]
        );
        const keep = all.rows[0].id;
        const drop = all.rows.slice(1).map((r: any) => String(r.id));
        for (const table of ['services', 'bookings', 'reviews', 'portfolio']) {
          await client.query(
            `UPDATE ${table} SET provider_id = $1 WHERE provider_id::text = ANY($2::text[])`,
            [keep, drop]
          );
        }
        await client.query(`DELETE FROM providers WHERE id::text = ANY($1::text[])`, [drop]);
        console.log(
          `Merged ${drop.length} duplicate providers row(s) for user ${row.user_id} into ${keep}.`
        );
      }
    } catch (e) {
      console.error('providers de-duplication skipped (non-fatal):', (e as Error).message);
    }

    try {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS providers_user_id_unique ON providers (user_id);
      `);
    } catch (e) {
      console.error(
        'Could not create providers_user_id_unique - a user still has more than one ' +
        'providers row, so services and bookings may be split across them:', (e as Error).message
      );
    }

    // Payment system indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_client ON payments (client_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_paymongo_intent ON payments (paymongo_payment_intent_id);`);

    // A booking may have several payment rows (a new one is created after each failed
    // attempt), but at most ONE of them may ever be 'succeeded'. The application check
    // in POST /payments/create-intent enforces this too; this partial unique index is
    // the backstop that makes charging a booking twice impossible even if a concurrent
    // request slips past that check. Created CONCURRENTLY-free since it's tiny, and
    // guarded so a pre-existing duplicate can't stop the server booting.
    try {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS payments_one_succeeded_per_booking
        ON payments (booking_id) WHERE status = 'succeeded';
      `);
    } catch (e) {
      console.error(
        'Could not create payments_one_succeeded_per_booking - a booking already has ' +
        'more than one succeeded payment, which means someone was charged twice. ' +
        'Investigate before relying on this guard:', (e as Error).message
      );
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wallets_provider ON wallets (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions (wallet_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payouts_provider ON payouts (provider_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status);`);

    // Backfill wallet_credited_at for payments credited before that column existed.
    // settlePaymentSuccess() claims a payment with "wallet_credited_at IS NULL", so
    // without this a payment that was already credited would be credited a SECOND time
    // the next time that code runs for it (a webhook retry, a revisited payment
    // callback). The wallet ledger is the evidence of the original credit, so stamp
    // each payment with the time of its first 'payment_received' transaction.
    // Idempotent - the IS NULL guard makes re-running on every boot a no-op.
    try {
      const backfilled = await client.query(`
        UPDATE payments p
        SET wallet_credited_at = t.first_credit
        FROM (
          SELECT payment_id, MIN(created_at) AS first_credit
          FROM transactions
          WHERE type = 'payment_received' AND payment_id IS NOT NULL
          GROUP BY payment_id
        ) t
        WHERE t.payment_id::text = p.id::text
          AND p.wallet_credited_at IS NULL
      `);
      if (backfilled.rowCount) {
        console.log(`Backfilled wallet_credited_at for ${backfilled.rowCount} already-credited payment(s).`);
      }
    } catch (e) {
      console.log('wallet_credited_at backfill skipped (non-fatal):', (e as Error).message);
    }

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
            slot_duration INTEGER NOT NULL DEFAULT 30,
            buffer_minutes INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT valid_time_range CHECK (end_time > start_time),
            CONSTRAINT unique_provider_rule_slot UNIQUE (provider_id, day_of_week, start_time)
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
            slot_duration INTEGER NOT NULL DEFAULT 30,
            buffer_minutes INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT valid_time_range CHECK (end_time > start_time),
            CONSTRAINT unique_provider_rule_slot UNIQUE (provider_id, day_of_week, start_time)
          );
        `);
      }
    }

    // Backfill the unique constraint for pre-existing availability_rules tables
    // that were created before ON CONFLICT support was added (see routes/availability.ts POST /rules)
    try {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'unique_provider_rule_slot' AND table_name = 'availability_rules'
          ) THEN
            ALTER TABLE availability_rules ADD CONSTRAINT unique_provider_rule_slot
              UNIQUE (provider_id, day_of_week, start_time);
          END IF;
        END $$;
      `);
    } catch (ruleConstraintError) {
      console.log('availability_rules unique constraint backfill (non-fatal):', ruleConstraintError);
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
            start_datetime TIMESTAMPTZ NOT NULL,
            end_datetime TIMESTAMPTZ NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'booked')),
            held_by UUID REFERENCES users(id) ON DELETE SET NULL,
            hold_expires_at TIMESTAMPTZ,
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
            start_datetime TIMESTAMPTZ NOT NULL,
            end_datetime TIMESTAMPTZ NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'booked')),
            held_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            hold_expires_at TIMESTAMPTZ,
            booking_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_provider_slot UNIQUE (provider_id, start_datetime)
          );
        `);
      }
    }

    // Migrate time_slots timestamp columns to TIMESTAMPTZ — same reasoning as
    // the bookings table migration above: naive TIMESTAMP columns let slot
    // generation and hold-expiry drift by hours depending on the host's timezone.
    for (const col of ['start_datetime', 'end_datetime', 'hold_expires_at']) {
      const colInfo = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'time_slots' AND column_name = $1
      `, [col]);
      if (colInfo.rows[0]?.data_type === 'timestamp without time zone') {
        console.log(`Migrating time_slots.${col} to TIMESTAMPTZ...`);
        await client.query(`
          ALTER TABLE time_slots ALTER COLUMN ${col} TYPE TIMESTAMPTZ
          USING ${col} AT TIME ZONE 'Asia/Manila';
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

    // Reconcile time slots against the bookings that own them.
    //
    // POST /bookings did not mark its slots 'booked' for a long time - it inserted the
    // booking row and left time_slots untouched. The bookings-table overlap check still
    // prevented a genuine double-booking, but the slot picker reads time_slots, so a
    // taken time kept rendering as available: the client's hold simply expired on its
    // own timer and the slot went back on sale under a booking that still existed. The
    // route now claims its slots, but that only helps bookings made after it ships -
    // every booking taken before then is still unlinked, and its time would go on
    // showing as free right up until someone tried to book it and got a 409.
    //
    // Idempotent: once a slot is marked and linked, the status/booking_id guards below
    // exclude it, so re-running this on every boot is a no-op. Scoped to bookings that
    // have not finished yet, since the picker only ever renders future slots.
    //
    // bookings.provider_id and time_slots.provider_id are NOT the same id space when a
    // separate providers table exists - the former is providers.id, the latter is
    // users.id - hence resolving through it. COALESCE covers the schema where bookings
    // reference users directly and there is nothing to resolve.
    try {
      const hasProvidersTable = await client.query(`SELECT to_regclass('public.providers') as exists`);
      const providerJoin = hasProvidersTable.rows[0].exists
        ? `LEFT JOIN providers p ON p.id::text = b.provider_id::text`
        : '';
      const providerMatch = hasProvidersTable.rows[0].exists
        ? `COALESCE(p.user_id::text, b.provider_id::text)`
        : `b.provider_id::text`;

      const reconciled = await client.query(`
        UPDATE time_slots ts
        SET status = 'booked',
            booking_id = b.id,
            held_by = NULL,
            hold_expires_at = NULL
        FROM bookings b
        ${providerJoin}
        WHERE ts.provider_id::text = ${providerMatch}
          AND b.status NOT IN ('cancelled', 'rejected')
          AND b.deleted_at IS NULL
          AND b.start_date IS NOT NULL
          AND b.end_date IS NOT NULL
          AND b.end_date > NOW()
          AND ts.start_datetime >= b.start_date
          AND ts.end_datetime <= b.end_date
          AND ts.status <> 'booked'
          AND ts.booking_id IS NULL
      `);
      if (reconciled.rowCount) {
        console.log(`Marked ${reconciled.rowCount} time slot(s) as booked to match existing bookings.`);
      }
    } catch (e) {
      console.log('Time slot reconciliation skipped (non-fatal):', (e as Error).message);
    }

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
    // 'unsubmitted' means the provider hasn't requested verification yet (no documents
    // uploaded). Only a provider who actually submits documents moves to 'pending', so
    // the admin queue (WHERE verification_status = 'pending') reflects real requests
    // instead of every provider who has ever signed up. SET DEFAULT is needed on top of
    // ADD COLUMN IF NOT EXISTS because the latter is a no-op on databases where the
    // column already exists with the old 'pending' default.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'unsubmitted';`);
    await client.query(`ALTER TABLE users ALTER COLUMN verification_status SET DEFAULT 'unsubmitted';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_documents JSONB;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;`);
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);

    // ==================== PASSWORD RESET TOKENS TABLE ====================
    const passwordResetTokensExist = await client.query(`SELECT to_regclass('public.password_reset_tokens') as exists`);
    if (!passwordResetTokensExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE password_reset_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
      // Create index for faster token lookups
      await client.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id);`);
      console.log('Password reset tokens table created');
    }

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
    await client.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;`);

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

    // Disputes indexes - only create if disputes table exists and has required columns
    const disputesTableExists = await client.query(`SELECT to_regclass('public.disputes') as exists`);
    if (disputesTableExists.rows[0].exists) {
      // Get existing columns in disputes table
      const disputeCols = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'disputes' AND table_schema = 'public'
      `);
      const disputeColNames = disputeCols.rows.map((r: any) => r.column_name);

      try {
        if (disputeColNames.includes('booking_id')) {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes (booking_id);`);
        }
        if (disputeColNames.includes('raised_by')) {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes (raised_by);`);
        }
        if (disputeColNames.includes('status')) {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status);`);
        }
        if (disputeColNames.includes('priority')) {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_priority ON disputes (priority);`);
        }
        if (disputeColNames.includes('assigned_to')) {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_disputes_assigned ON disputes (assigned_to);`);
        }
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

    // ==================== SUPPORT TICKETS TABLE ====================
    const supportTicketsExist = await client.query(`SELECT to_regclass('public.support_tickets') as exists`);
    if (!supportTicketsExist.rows[0].exists) {
      if (usesUUID) {
        await client.query(`
          CREATE TABLE support_tickets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
            subject VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
            admin_reply TEXT,
            replied_by UUID REFERENCES users(id) ON DELETE SET NULL,
            replied_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } else {
        await client.query(`
          CREATE TABLE support_tickets (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
            subject VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
            admin_reply TEXT,
            replied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            replied_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    }

    // Support tickets indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets (created_at DESC);`);
    await client.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(50);`);

    // ==================== SUPPORT MESSAGES TABLE ====================
    const supportMessagesExist = await client.query(`SELECT to_regclass('public.support_messages') as exists`);
    if (!supportMessagesExist.rows[0].exists) {
      await client.query(`
        CREATE TABLE support_messages (
          id ${idType} PRIMARY KEY ${usesUUID ? 'DEFAULT gen_random_uuid()' : ''},
          ticket_id ${refType} NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          sender_id ${refType} REFERENCES users(id) ON DELETE SET NULL,
          sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('user', 'admin', 'system')),
          content TEXT,
          attachment_url TEXT,
          attachment_type VARCHAR(20),
          attachment_name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          read_at TIMESTAMP
        );
      `);
    }

    // Support messages indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages (ticket_id, created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_unread ON support_messages (ticket_id) WHERE read_at IS NULL;`);

    // Backfill: turn each pre-chat ticket's opening message + admin_reply into thread messages (idempotent).
    try {
      await client.query(`
        INSERT INTO support_messages (ticket_id, sender_id, sender_role, content, created_at)
        SELECT t.id, t.user_id, 'user', t.message, t.created_at
        FROM support_tickets t
        WHERE NOT EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id::text = t.id::text)
      `);
      await client.query(`
        INSERT INTO support_messages (ticket_id, sender_id, sender_role, content, created_at)
        SELECT t.id, t.replied_by, 'admin', t.admin_reply, COALESCE(t.replied_at, t.updated_at)
        FROM support_tickets t
        WHERE t.admin_reply IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM support_messages m
            WHERE m.ticket_id::text = t.id::text AND m.sender_role = 'admin'
          )
      `);
    } catch (e) {
      console.warn('Support messages backfill could not be completed:', e);
    }

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
