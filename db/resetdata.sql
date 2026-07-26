-- Reset Rent System data only (keeps Financial System tables).
-- Clears billing, renters, rooms, and expenses; restores default rooms + settings.
-- Usage: psql -U youruser -d yourdatabase -f db/resetdata.sql

BEGIN;

TRUNCATE TABLE
  room_meter_history,
  house_meter_history,
  room_billing_history,
  payments,
  renters,
  rooms,
  expenses
RESTART IDENTITY CASCADE;

UPDATE settings
SET rate = 15, cost = 0, internet_rate = 250, water_rate = 15, currency = '₱'
WHERE id = 1;

INSERT INTO settings (id, rate, cost, internet_rate, water_rate, currency)
SELECT 1, 15, 0, 250, 15, '₱'
WHERE NOT EXISTS (SELECT 1 FROM settings);

INSERT INTO rooms (name, occupant_amount, rate_per_person, sort_order) VALUES
  ('Room 1', 1, 0, 1),
  ('Room 2', 1, 0, 2),
  ('Room 3', 1, 0, 3),
  ('Room 4', 1, 0, 4);

COMMIT;
