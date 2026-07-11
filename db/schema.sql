-- Lauglaug Renting & Electricity Business
-- Run this once against your PostgreSQL database to create the tables.
-- Safe to re-run any time (existing installs get missing columns/indexes added).
-- Example: psql -U youruser -d yourdatabase -f db/schema.sql

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rate NUMERIC(10,2) NOT NULL DEFAULT 15,       -- peso per kWh charged to renters
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,        -- your own cost per kWh (solar upkeep, grid top-up)
  currency TEXT NOT NULL DEFAULT '₱',
  CONSTRAINT settings_single_row CHECK (id = 1)
);

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
  sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS due_day INTEGER CHECK (due_day BETWEEN 1 AND 31);

CREATE TABLE IF NOT EXISTS renters (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_relation TEXT NOT NULL DEFAULT '',
  emergency_contact_number TEXT NOT NULL DEFAULT '',
  birthday DATE,
  reason_for_stay TEXT NOT NULL DEFAULT '',
  stay_start_date DATE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- One payment record per month, per billable unit. A "flat" room is billed as
-- a whole (renter_id is NULL); a "per_person" room is billed one renter at a
-- time (renter_id is set) so each person can be marked paid separately.
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  renter_id INTEGER REFERENCES renters(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_date DATE,
  amount NUMERIC(10,2)
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS renter_id INTEGER REFERENCES renters(id) ON DELETE CASCADE;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_room_id_period_year_period_month_key;
DROP INDEX IF EXISTS payments_room_period_uq;
DROP INDEX IF EXISTS payments_renter_period_uq;
CREATE UNIQUE INDEX payments_room_period_uq ON payments (room_id, period_year, period_month) WHERE renter_id IS NULL;
CREATE UNIQUE INDEX payments_renter_period_uq ON payments (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS house_meter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  prev_reading NUMERIC(12,2),
  curr_reading NUMERIC(12,2),
  CONSTRAINT house_meter_single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seed defaults only if the tables are empty (safe to re-run).
INSERT INTO settings (id, rate, cost, currency)
  SELECT 1, 15, 0, '₱'
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
