-- Migration: Add missing columns to bookings table for proper scheduling
-- Run this with: psql -U postgres -d photofind -f backend/migrations/001_fix_bookings_table.sql

-- Add start_date and end_date columns for time range bookings
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS end_date TIMESTAMP;

-- Add booking workflow columns
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) DEFAULT 'request',
ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();

-- Migrate existing data: convert booking_date to start_date/end_date
UPDATE bookings
SET start_date = booking_date::timestamp,
    end_date = (booking_date::timestamp + interval '1 hour')
WHERE start_date IS NULL AND booking_date IS NOT NULL;

-- Add index for efficient booking conflict queries
CREATE INDEX IF NOT EXISTS idx_bookings_provider_dates
ON bookings (provider_id, start_date, end_date)
WHERE status NOT IN ('cancelled', 'rejected');

-- Add index for user booking lookups
CREATE INDEX IF NOT EXISTS idx_bookings_client_id ON bookings (client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

SELECT 'Migration completed successfully' AS result;
