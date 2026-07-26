-- Lauglaug Systems — PostgreSQL schema (Rent + Financial)
-- Matches the current UI: Billing tab meters, per-renter payments, Settings expenses.
-- Safe to re-run on existing databases (adds missing objects; legacy cleanup runs at server start).
-- Example: psql -U youruser -d yourdatabase -f db/schema.sql

-- ======================== SETTINGS ========================
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rate NUMERIC(10,2) NOT NULL DEFAULT 15,          -- electricity sell rate (₱/kWh)
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,           -- electricity cost (₱/kWh)
  internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250,
  water_rate NUMERIC(10,2) NOT NULL DEFAULT 15,   -- water sell rate (₱ per meter unit)
  currency TEXT NOT NULL DEFAULT '₱',
  CONSTRAINT settings_single_row CHECK (id = 1)
);

-- ======================== ROOMS ========================
-- Fixed room list: name, max occupants, rate per assigned renter.
-- Meter readings live in room_meter_history (Billing tab), not on this table.
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  occupant_amount INTEGER NOT NULL DEFAULT 1,
  rate_per_person NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'vacant',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ======================== RENTERS ========================
CREATE TABLE IF NOT EXISTS renters (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,

  first_name TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  birthday DATE,
  nationality TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  civil_status TEXT NOT NULL DEFAULT '',

  address TEXT NOT NULL DEFAULT '',
  mail_address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',

  occupation TEXT NOT NULL DEFAULT '',
  employer TEXT NOT NULL DEFAULT '',
  work_address TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',

  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_number TEXT NOT NULL DEFAULT '',
  emergency_contact_relation TEXT NOT NULL DEFAULT '',
  emergency_contact_address TEXT NOT NULL DEFAULT '',

  stay_start_date DATE,
  next_due DATE,
  notice_date DATE,
  notice_end_date DATE,
  credits_applied BOOLEAN NOT NULL DEFAULT false,
  free_water BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  deposit NUMERIC(10,2),
  advance_rent NUMERIC(10,2),
  balance NUMERIC(10,2) DEFAULT 0,
  is_new_renter BOOLEAN NOT NULL DEFAULT false,
  reason_for_stay TEXT NOT NULL DEFAULT '',

  sort_order INTEGER NOT NULL DEFAULT 0,
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ======================== PAYMENTS ========================
-- One row per renter per billing month (due on the 15th).
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  renter_id INTEGER NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_date DATE,
  amount NUMERIC(10,2),
  rent_amount NUMERIC(10,2),
  electricity_amount NUMERIC(10,2),
  internet_amount NUMERIC(10,2),
  water_amount NUMERIC(10,2),
  credit_amount NUMERIC(10,2) DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_renter_period_uq
  ON payments (renter_id, period_year, period_month);

-- ======================== OPERATING EXPENSES (Rent System / Settings tab) ========================
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2),
  recurrence_type TEXT NOT NULL DEFAULT 'monthly',
  expense_month INTEGER CHECK (expense_month BETWEEN 1 AND 12),
  expense_year INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ======================== METER HISTORY (Billing tab) ========================
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
  water_prev_reading NUMERIC(12,2),
  water_curr_reading NUMERIC(12,2),
  usage_water NUMERIC(12,2) NOT NULL DEFAULT 0,
  water_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
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
  bill_amount NUMERIC(10,2) NOT NULL DEFAULT 0,  -- our electricity bill for solar profit
  water_prev_reading NUMERIC(12,2),
  water_curr_reading NUMERIC(12,2),
  usage_water NUMERIC(12,2) NOT NULL DEFAULT 0,
  water_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

-- ======================== ROOM BILLING SNAPSHOTS ========================
-- Saved each time bills are generated (used for dashboard / payment calculations).
CREATE TABLE IF NOT EXISTS room_billing_history (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  room_name TEXT NOT NULL DEFAULT '',
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  occupant_amount INTEGER NOT NULL DEFAULT 1,
  rate_per_person NUMERIC(10,2) NOT NULL DEFAULT 0,
  rent_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  kwh_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  electricity_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  electricity_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  internet_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_prev_reading NUMERIC(12,2),
  water_curr_reading NUMERIC(12,2),
  water_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  renters_snapshot JSONB NOT NULL DEFAULT '[]',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS room_billing_history_period_uq
  ON room_billing_history (room_id, period_year, period_month)
  WHERE room_id IS NOT NULL;

-- ======================== FINANCIAL SYSTEM ========================
CREATE TABLE IF NOT EXISTS financial_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
INSERT INTO settings (id, rate, cost, internet_rate, water_rate, currency)
  SELECT 1, 15, 0, 250, 15, '₱'
  WHERE NOT EXISTS (SELECT 1 FROM settings);

INSERT INTO rooms (name, occupant_amount, rate_per_person, sort_order)
  SELECT * FROM (VALUES
    ('Room 1', 1, 0::numeric, 1),
    ('Room 2', 1, 0::numeric, 2),
    ('Room 3', 1, 0::numeric, 3),
    ('Room 4', 1, 0::numeric, 4)
  ) AS seed(name, occupant_amount, rate_per_person, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM rooms);

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
