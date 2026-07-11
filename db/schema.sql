-- Lauglaug Renting & Electricity Business
-- Run this once against your PostgreSQL database to create the tables.
-- Safe to re-run any time (existing installs get missing columns/indexes added).
-- Example: psql -U youruser -d yourdatabase -f db/schema.sql

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rate NUMERIC(10,2) NOT NULL DEFAULT 15,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250,
  currency TEXT NOT NULL DEFAULT '₱',
  CONSTRAINT settings_single_row CHECK (id = 1)
);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250;

-- ======================== ROOMS ========================
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  rent_type TEXT NOT NULL DEFAULT 'flat' CHECK (rent_type IN ('flat', 'per_person')),
  flat_rent NUMERIC(10,2),
  rate_per_person NUMERIC(10,2),
  persons INTEGER,
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'vacant',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS due_day INTEGER CHECK (due_day BETWEEN 1 AND 31);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'vacant';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ======================== RENTERS ========================
-- Full renter profile: personal, contact, work, ID, emergency contact, rental status
CREATE TABLE IF NOT EXISTS renters (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,

  -- Personal info
  first_name TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  birthday DATE,
  nationality TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  civil_status TEXT NOT NULL DEFAULT '',

  -- Contact info
  address TEXT NOT NULL DEFAULT '',
  mail_address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',

  -- Work / Employer
  occupation TEXT NOT NULL DEFAULT '',
  employer TEXT NOT NULL DEFAULT '',
  work_address TEXT NOT NULL DEFAULT '',

  -- Government ID
  id_number TEXT NOT NULL DEFAULT '',

  -- Emergency contact
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_number TEXT NOT NULL DEFAULT '',
  emergency_contact_relation TEXT NOT NULL DEFAULT '',
  emergency_contact_address TEXT NOT NULL DEFAULT '',

  -- Rental details
  stay_start_date DATE,
  next_due DATE,
  status TEXT NOT NULL DEFAULT 'active',       -- active | inactive | moved_out
  payment_method TEXT NOT NULL DEFAULT 'cash', -- cash | gcash | bank_transfer | others
  deposit NUMERIC(10,2),
  advance_rent NUMERIC(10,2),
  balance NUMERIC(10,2) DEFAULT 0,
  is_new_renter BOOLEAN NOT NULL DEFAULT false,

  -- Legacy / misc
  reason_for_stay TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns to existing installs
ALTER TABLE renters ADD COLUMN IF NOT EXISTS nationality TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS civil_status TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS mail_address TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS occupation TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS employer TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS work_address TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS id_number TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS emergency_contact_address TEXT NOT NULL DEFAULT '';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS next_due DATE;
ALTER TABLE renters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE renters ADD COLUMN IF NOT EXISTS deposit NUMERIC(10,2);
ALTER TABLE renters ADD COLUMN IF NOT EXISTS advance_rent NUMERIC(10,2);
ALTER TABLE renters ADD COLUMN IF NOT EXISTS balance NUMERIC(10,2) DEFAULT 0;
ALTER TABLE renters ADD COLUMN IF NOT EXISTS is_new_renter BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE renters ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ======================== PAYMENTS ========================
-- One payment record per renter per month.
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  renter_id INTEGER REFERENCES renters(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_date DATE,
  amount NUMERIC(10,2),
  rent_amount NUMERIC(10,2),
  electricity_amount NUMERIC(10,2),
  internet_amount NUMERIC(10,2)
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS renter_id INTEGER REFERENCES renters(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(10,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS electricity_amount NUMERIC(10,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS internet_amount NUMERIC(10,2);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_room_id_period_year_period_month_key;
DROP INDEX IF EXISTS payments_room_period_uq;
DROP INDEX IF EXISTS payments_renter_period_uq;
CREATE UNIQUE INDEX payments_room_period_uq ON payments (room_id, period_year, period_month) WHERE renter_id IS NULL;
CREATE UNIQUE INDEX payments_renter_period_uq ON payments (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL;

-- ======================== HOUSE METER ========================
CREATE TABLE IF NOT EXISTS house_meter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  CONSTRAINT house_meter_single_row CHECK (id = 1)
);

-- ======================== EXPENSES (Rent System) ========================
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ======================== KWPH (Electricity Meter Readings per Room) ========================
-- Tracks individual billing-period electricity readings per room.
-- price = kWh rate applied for that billing period.
CREATE TABLE IF NOT EXISTS kwph (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,     -- rate per kWh for this period
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  previous_meter NUMERIC(12,2),
  current_meter NUMERIC(12,2),
  reading_date DATE DEFAULT CURRENT_DATE,
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, year, month)
);

-- ======================== METER HISTORY ========================
CREATE TABLE IF NOT EXISTS room_meter_history (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  room_name TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  usage_kwh NUMERIC(12,2) NOT NULL DEFAULT 0,
  electricity_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  electricity_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS room_meter_history_period_uq
  ON room_meter_history (room_id, period_year, period_month)
  WHERE room_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS house_meter_history (
  id SERIAL PRIMARY KEY,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  usage_kwh NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

-- ======================== FINANCIAL SYSTEM ========================
-- Independent from the Rent System. Used to track personal/family finances.

CREATE TABLE IF NOT EXISTS financial_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- type: 'income' or 'expense'
CREATE TABLE IF NOT EXISTS financial_expenses (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES financial_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
  expense_date DATE DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT NOT NULL DEFAULT '',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ======================== SEED DEFAULTS ========================
INSERT INTO settings (id, rate, cost, internet_rate, currency)
  SELECT 1, 15, 0, 250, '₱'
  WHERE NOT EXISTS (SELECT 1 FROM settings);

INSERT INTO house_meter (id, prev_reading, curr_reading)
  SELECT 1, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM house_meter);

INSERT INTO rooms (name, rent_type, flat_rent, rate_per_person, persons, sort_order)
  SELECT * FROM (VALUES
    ('Room 1', 'flat', 4000::numeric, NULL::numeric, NULL::integer, 1),
    ('Room 2', 'flat', 4000::numeric, NULL::numeric, NULL::integer, 2),
    ('Room 3', 'flat', 5000::numeric, NULL::numeric, NULL::integer, 3),
    ('Room 4', 'per_person', NULL::numeric, 8000::numeric, NULL::integer, 4)
  ) AS seed(name, rent_type, flat_rent, rate_per_person, persons, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM rooms);

-- Default financial categories
INSERT INTO financial_categories (name, color)
  SELECT * FROM (VALUES
    ('Food & Groceries', '#f59e0b'),
    ('Utilities', '#3b82f6'),
    ('Transportation', '#10b981'),
    ('Healthcare', '#ef4444'),
    ('Maintenance & Repairs', '#8b5cf6'),
    ('Miscellaneous', '#6b7280')
  ) AS seed(name, color)
  WHERE NOT EXISTS (SELECT 1 FROM financial_categories);
