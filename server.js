require("dotenv").config();
const express = require("express");
const path = require("path");
const pool = require("./db/pool");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/** Bumps whenever any client changes data — other open browsers poll this to stay in sync. */
let dataVersion = Date.now();

function bumpDataVersion() {
  dataVersion = Date.now();
  return dataVersion;
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) bumpDataVersion();
  });
  next();
});

function num(v) {
  return v === undefined || v === null || v === "" ? null : Number(v);
}

function money2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function paymentNetDue(gross, credit, adjustment) {
  return Math.max(0, money2(money2(gross) - money2(credit) - money2(adjustment)));
}

function paymentIsSettled(amount, amountPaid) {
  return money2(amountPaid) + 0.005 >= money2(amount);
}

async function validateRoomCapacity(roomId, excludeRenterId) {
  if (!roomId) return null;
  const roomRes = await pool.query(
    "SELECT id, name, occupant_amount FROM rooms WHERE id = $1",
    [roomId]
  );
  if (!roomRes.rows.length) return "Room not found.";
  const room = roomRes.rows[0];
  const limit = Math.max(1, Number(room.occupant_amount) || 1);
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM renters
     WHERE room_id = $1 AND COALESCE(status, 'active') <> 'moved_out'
       AND ($2::int IS NULL OR id <> $2)`,
    [roomId, excludeRenterId || null]
  );
  if (countRes.rows[0].count >= limit) {
    const name = room.name || "This room";
    return name + " allows only " + limit + " occupant" + (limit === 1 ? "" : "s") +
      ". Remove a renter first or raise the occupancy limit.";
  }
  return null;
}

async function validateRoomOccupancyReduction(roomId, newLimit) {
  const assignedRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM renters
     WHERE room_id = $1 AND COALESCE(status, 'active') <> 'moved_out'`,
    [roomId]
  );
  const assigned = assignedRes.rows[0].count;
  const limit = Math.max(1, Number(newLimit) || 1);
  if (assigned > limit) {
    return "Can't set occupancy below " + assigned + " — that many renters are still assigned.";
  }
  return null;
}

function computeProrationServer(stayStart, fullMonthlyRate, year, month) {
  if (!stayStart || fullMonthlyRate == null) return fullMonthlyRate || 0;
  const startDate = new Date(String(stayStart).slice(0, 10) + "T00:00:00+08:00");
  if (isNaN(startDate.getTime())) return fullMonthlyRate || 0;
  const dueDate = new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevCutoff = new Date(prevYear + "-" + String(prevMonth).padStart(2, "0") + "-15T00:00:00+08:00");
  if (startDate <= prevCutoff || startDate > dueDate) return fullMonthlyRate || 0;
  const MS = 86400000;
  const daysInPeriod = Math.round((dueDate - prevCutoff) / MS);
  const daysStayed = Math.round((dueDate - startDate) / MS);
  return Math.round((daysStayed / daysInPeriod) * (fullMonthlyRate || 0) * 100) / 100;
}

/** Day fraction for first short stay (1 = full month). Used for rent and internet. */
function prorationFractionServer(stayStart, year, month) {
  if (!stayStart) return 1;
  const startDate = new Date(String(stayStart).slice(0, 10) + "T00:00:00+08:00");
  if (isNaN(startDate.getTime())) return 1;
  const dueDate = new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevCutoff = new Date(prevYear + "-" + String(prevMonth).padStart(2, "0") + "-15T00:00:00+08:00");
  if (startDate <= prevCutoff || startDate > dueDate) return 1;
  const MS = 86400000;
  const daysInPeriod = Math.round((dueDate - prevCutoff) / MS) || 1;
  const daysStayed = Math.round((dueDate - startDate) / MS);
  return daysStayed / daysInPeriod;
}

function isFinalNoticePeriodServer(noticeEndDate, year, month) {
  if (!noticeEndDate) return false;
  const end = String(noticeEndDate).slice(0, 10);
  const due = year + "-" + String(month).padStart(2, "0") + "-15";
  return end === due;
}

async function migrateLegacySchema() {
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS water_rate NUMERIC(10,2) NOT NULL DEFAULT 150;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS free_water BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE room_billing_history ADD COLUMN IF NOT EXISTS water_prev_reading NUMERIC(12,2);
    ALTER TABLE room_billing_history ADD COLUMN IF NOT EXISTS water_curr_reading NUMERIC(12,2);
    ALTER TABLE room_billing_history ADD COLUMN IF NOT EXISTS water_used NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE room_meter_history ADD COLUMN IF NOT EXISTS water_prev_reading NUMERIC(12,2);
    ALTER TABLE room_meter_history ADD COLUMN IF NOT EXISTS water_curr_reading NUMERIC(12,2);
    ALTER TABLE room_meter_history ADD COLUMN IF NOT EXISTS usage_water NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE room_meter_history ADD COLUMN IF NOT EXISTS water_rate NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE room_meter_history ADD COLUMN IF NOT EXISTS water_charge NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS bill_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS water_prev_reading NUMERIC(12,2);
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS water_curr_reading NUMERIC(12,2);
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS usage_water NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS water_rate NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE house_meter_history ADD COLUMN IF NOT EXISTS water_charge NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS occupant_amount INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'vacant';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'monthly';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_month INTEGER;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_year INTEGER;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS end_month INTEGER;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS end_year INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS electricity_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS internet_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS water_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS adjustment_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS skip_water BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS water_custom BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE room_billing_history ADD COLUMN IF NOT EXISTS water_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
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
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS notice_date DATE;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS notice_end_date DATE;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS credits_applied BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS deposit NUMERIC(10,2);
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS advance_rent NUMERIC(10,2);
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS balance NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS is_new_renter BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE renters ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Flat water fee is ₱150 per person per month by default (editable in Settings).
    UPDATE settings SET water_rate = 150 WHERE id = 1 AND water_rate = 15;
  `);

  await pool.query(`
    DO $migrate$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'persons'
      ) THEN
        UPDATE rooms SET occupant_amount = COALESCE(NULLIF(occupant_amount, 0), persons, 1)
          WHERE occupant_amount IS NULL OR occupant_amount < 1;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'flat_rent'
      ) THEN
        UPDATE rooms SET rate_per_person = COALESCE(rate_per_person, flat_rent, 0)
          WHERE rate_per_person IS NULL;
      END IF;
    END $migrate$;
  `);

  await pool.query(`
    DELETE FROM payments WHERE renter_id IS NULL;
    DROP INDEX IF EXISTS payments_room_period_uq;

    ALTER TABLE rooms DROP COLUMN IF EXISTS flat_rent;
    ALTER TABLE rooms DROP COLUMN IF EXISTS rent_type;
    ALTER TABLE rooms DROP COLUMN IF EXISTS persons;
    ALTER TABLE rooms DROP COLUMN IF EXISTS prev_reading;
    ALTER TABLE rooms DROP COLUMN IF EXISTS curr_reading;
    ALTER TABLE rooms DROP COLUMN IF EXISTS due_day;

    ALTER TABLE room_billing_history DROP COLUMN IF EXISTS notes;

    DROP TABLE IF EXISTS kwph CASCADE;
    DROP TABLE IF EXISTS house_meter CASCADE;
  `);
}

async function ensureLatestSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      rate NUMERIC(10,2) NOT NULL DEFAULT 15,
      cost NUMERIC(10,2) NOT NULL DEFAULT 0,
      internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250,
      water_rate NUMERIC(10,2) NOT NULL DEFAULT 150,
      currency TEXT NOT NULL DEFAULT '₱',
      CONSTRAINT settings_single_row CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      occupant_amount INTEGER NOT NULL DEFAULT 1,
      rate_per_person NUMERIC(10,2) NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'vacant',
      date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
      internet_amount NUMERIC(10,2),
      water_amount NUMERIC(10,2),
      credit_amount NUMERIC(10,2) DEFAULT 0,
      adjustment_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      adjustment_note TEXT NOT NULL DEFAULT '',
      amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
      skip_water BOOLEAN NOT NULL DEFAULT false,
      water_custom BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      amount NUMERIC(10,2),
      recurrence_type TEXT NOT NULL DEFAULT 'monthly',
      expense_month INTEGER,
      expense_year INTEGER,
      end_month INTEGER,
      end_year INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

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
      total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      renters_snapshot JSONB NOT NULL DEFAULT '[]',
      date_created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS room_billing_history_period_uq
      ON room_billing_history (room_id, period_year, period_month)
      WHERE room_id IS NOT NULL;

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

    CREATE UNIQUE INDEX IF NOT EXISTS payments_renter_period_uq
      ON payments (renter_id, period_year, period_month)
      WHERE renter_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS loans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'House Loan',
      lender TEXT NOT NULL DEFAULT '',
      original_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      monthly_payment NUMERIC(10,2) NOT NULL DEFAULT 0,
      start_date DATE,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      auto_pay BOOLEAN NOT NULL DEFAULT true,
      auto_pay_from DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS loan_payments (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      period_year INTEGER,
      period_month INTEGER CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
      note TEXT NOT NULL DEFAULT '',
      is_auto BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS loan_payments_loan_id_idx ON loan_payments (loan_id);
    CREATE INDEX IF NOT EXISTS loan_payments_date_idx ON loan_payments (payment_date DESC);
  `);

  await migrateLegacySchema();

  await pool.query(`
    ALTER TABLE loans ADD COLUMN IF NOT EXISTS auto_pay BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE loans ADD COLUMN IF NOT EXISTS auto_pay_from DATE;
    ALTER TABLE loan_payments ADD COLUMN IF NOT EXISTS is_auto BOOLEAN NOT NULL DEFAULT false;
    UPDATE loans
       SET auto_pay_from = COALESCE(auto_pay_from, (created_at AT TIME ZONE 'Asia/Manila')::date)
     WHERE auto_pay_from IS NULL;
  `);

  await pool.query(`
    INSERT INTO settings (id, rate, cost, internet_rate, water_rate, currency)
      SELECT 1, 15, 0, 250, 150, '₱'
      WHERE NOT EXISTS (SELECT 1 FROM settings);
  `);

  await pool.query(`
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
  `);
}

/* ===================================================================
   RENT SYSTEM ENDPOINTS
   =================================================================== */

/* ---------------- Live sync version ---------------- */
app.get("/api/sync", (req, res) => {
  res.json({ version: dataVersion });
});

/* ---------------- Full state (Rent System) ---------------- */
app.get("/api/state", async (req, res, next) => {
  try {
    const [settings, rooms, renters, expenses] = await Promise.all([
      pool.query("SELECT rate, cost, internet_rate, water_rate, currency FROM settings WHERE id = 1"),
      pool.query(
        `SELECT id, name, occupant_amount, rate_per_person, sort_order, status, date_created
         FROM rooms ORDER BY sort_order, id`
      ),
      pool.query("SELECT * FROM renters ORDER BY sort_order, id"),
      pool.query("SELECT * FROM expenses ORDER BY sort_order, id"),
    ]);
    res.json({
      version: dataVersion,
      settings: settings.rows[0] || { rate: 15, cost: 0, internet_rate: 250, water_rate: 150, currency: "₱" },
      rooms: rooms.rows,
      renters: renters.rows,
      expenses: expenses.rows,
    });
  } catch (e) {
    next(e);
  }
});

/* ---------------- Settings ---------------- */
app.put("/api/settings", async (req, res, next) => {
  try {
    const { rate, cost, internet_rate, water_rate, currency } = req.body;
    let result = await pool.query(
      `UPDATE settings SET rate = $1, cost = $2, internet_rate = $3, water_rate = $4, currency = $5
       WHERE id = 1 RETURNING *`,
      [num(rate), num(cost), num(internet_rate), num(water_rate), currency || "₱"]
    );
    if (!result.rows.length) {
      result = await pool.query(
        `INSERT INTO settings (id, rate, cost, internet_rate, water_rate, currency)
         VALUES (1, $1, $2, $3, $4, $5) RETURNING *`,
        [num(rate), num(cost), num(internet_rate), num(water_rate), currency || "₱"]
      );
    }
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ---------------- Rooms ---------------- */
app.post("/api/rooms", async (req, res, next) => {
  try {
    const b = req.body || {};
    const sortRow = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM rooms");
    const result = await pool.query(
      `INSERT INTO rooms (name, occupant_amount, rate_per_person, sort_order, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        b.name || "",
        num(b.occupant_amount) || 1,
        num(b.rate_per_person) || 0,
        sortRow.rows[0].next,
        b.status || "vacant",
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/rooms/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const occupantErr = await validateRoomOccupancyReduction(req.params.id, num(b.occupant_amount) || 1);
    if (occupantErr) return res.status(400).json({ error: occupantErr });
    const result = await pool.query(
      `UPDATE rooms SET name = $1, rate_per_person = $2, occupant_amount = $3, status = $4
       WHERE id = $5 RETURNING *`,
      [
        b.name || "",
        num(b.rate_per_person) || 0,
        num(b.occupant_amount) || 1,
        b.status || "occupied",
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Room not found" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/rooms/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM rooms WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Renters ---------------- */
app.post("/api/renters", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.room_id) {
      const capErr = await validateRoomCapacity(b.room_id, null);
      if (capErr) return res.status(400).json({ error: capErr });
    }
    const sortRow = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM renters");
    const result = await pool.query(
      `INSERT INTO renters (
         room_id, first_name, middle_name, last_name,
         birthday, nationality, gender, civil_status,
         address, mail_address, contact_number,
         occupation, employer, work_address, id_number,
         emergency_contact_name, emergency_contact_number,
         emergency_contact_relation, emergency_contact_address,
         stay_start_date, next_due, notice_date, notice_end_date, credits_applied, free_water,
         status, payment_method,
         deposit, advance_rent, balance, is_new_renter, reason_for_stay, sort_order
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
       ) RETURNING *`,
      [
        b.room_id || null,
        b.first_name || "",    b.middle_name || "",   b.last_name || "",
        b.birthday || null,    b.nationality || "",   b.gender || "",      b.civil_status || "",
        b.address || "",       b.mail_address || "",  b.contact_number || "",
        b.occupation || "",    b.employer || "",      b.work_address || "", b.id_number || "",
        b.emergency_contact_name || "",   b.emergency_contact_number || "",
        b.emergency_contact_relation || "", b.emergency_contact_address || "",
        b.stay_start_date || null, b.next_due || null,
        b.notice_date || null, b.notice_end_date || null,
        b.credits_applied === true || b.credits_applied === "true",
        b.free_water === true || b.free_water === "true",
        b.status || "active",  b.payment_method || "cash",
        num(b.deposit), num(b.advance_rent), num(b.balance) || 0,
        b.is_new_renter === true || b.is_new_renter === "true",
        b.reason_for_stay || "", sortRow.rows[0].next,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/renters/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.room_id) {
      const capErr = await validateRoomCapacity(b.room_id, parseInt(req.params.id, 10));
      if (capErr) return res.status(400).json({ error: capErr });
    }
    const result = await pool.query(
      `UPDATE renters SET
         room_id = $1, first_name = $2, middle_name = $3, last_name = $4,
         birthday = $5, nationality = $6, gender = $7, civil_status = $8,
         address = $9, mail_address = $10, contact_number = $11,
         occupation = $12, employer = $13, work_address = $14, id_number = $15,
         emergency_contact_name = $16, emergency_contact_number = $17,
         emergency_contact_relation = $18, emergency_contact_address = $19,
         stay_start_date = $20, next_due = $21, notice_date = $22, notice_end_date = $23,
         credits_applied = $24, free_water = $25, status = $26, payment_method = $27,
         deposit = $28, advance_rent = $29, balance = $30, is_new_renter = $31, reason_for_stay = $32
       WHERE id = $33 RETURNING *`,
      [
        b.room_id || null,
        b.first_name || "",    b.middle_name || "",   b.last_name || "",
        b.birthday || null,    b.nationality || "",   b.gender || "",      b.civil_status || "",
        b.address || "",       b.mail_address || "",  b.contact_number || "",
        b.occupation || "",    b.employer || "",      b.work_address || "", b.id_number || "",
        b.emergency_contact_name || "",   b.emergency_contact_number || "",
        b.emergency_contact_relation || "", b.emergency_contact_address || "",
        b.stay_start_date || null, b.next_due || null,
        b.notice_date || null, b.notice_end_date || null,
        b.credits_applied === true || b.credits_applied === "true",
        b.free_water === true || b.free_water === "true",
        b.status || "active",  b.payment_method || "cash",
        num(b.deposit), num(b.advance_rent), num(b.balance) || 0,
        b.is_new_renter === true || b.is_new_renter === "true",
        b.reason_for_stay || "",
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Renter not found" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/renters/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM renters WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Payments ---------------- */
app.get("/api/payments", async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const result = await pool.query(
      `SELECT p.*, r.name AS room_name,
              rt.first_name AS renter_first_name, rt.last_name AS renter_last_name
       FROM payments p
       JOIN rooms r ON r.id = p.room_id
       LEFT JOIN renters rt ON rt.id = p.renter_id
       WHERE ($1::int IS NULL OR p.period_year = $1)
         AND ($2::int IS NULL OR p.period_month = $2)
       ORDER BY p.period_year DESC, p.period_month DESC, r.sort_order, rt.sort_order`,
      [year, month]
    );
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.put("/api/payments", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.room_id || !b.year || !b.month)
      return res.status(400).json({ error: "room_id, year, and month are required" });
    if (!b.renter_id)
      return res.status(400).json({ error: "renter_id is required for individual billing" });
    const rentAmt = num(b.rent_amount) || 0;
    const elecAmt = num(b.electricity_amount) || 0;
    const inetAmt = num(b.internet_amount) || 0;
    const waterAmt = num(b.water_amount) || 0;
    const skipWater = b.skip_water === true || b.skip_water === "true" || b.skip_water === "1";
    const waterCustom = b.water_custom === true || b.water_custom === "true" || b.water_custom === "1" || skipWater;
    const creditAmt = num(b.credit_amount) || 0;
    const adjustmentAmt = Math.max(0, num(b.adjustment_amount) || 0);
    const adjustmentNote = String(b.adjustment_note || "").slice(0, 200);
    const gross = rentAmt + elecAmt + inetAmt + waterAmt;
    const amount = paymentNetDue(gross, creditAmt, adjustmentAmt);
    let amountPaid = Math.max(0, num(b.amount_paid) || 0);
    let paid = !!b.paid;
    if (paid && amountPaid < amount) amountPaid = amount;
    if (!paid && paymentIsSettled(amount, amountPaid)) paid = true;
    if (paid && amount <= 0.005) amountPaid = amountPaid || 0;
    amountPaid = Math.min(money2(amountPaid), amount);
    const paidDate = paid || amountPaid > 0 ? (b.paid_date || null) : null;
    const values = [
      b.room_id, b.renter_id, b.year, b.month, paid, paidDate,
      amount, rentAmt, elecAmt, inetAmt, waterAmt, creditAmt,
      adjustmentAmt, adjustmentNote, amountPaid, skipWater, waterCustom,
    ];
    const result = await pool.query(
      `INSERT INTO payments
         (room_id, renter_id, period_year, period_month, paid, paid_date, amount,
          rent_amount, electricity_amount, internet_amount, water_amount, credit_amount,
          adjustment_amount, adjustment_note, amount_paid, skip_water, water_custom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL
       DO UPDATE SET paid = EXCLUDED.paid, paid_date = EXCLUDED.paid_date,
         amount = EXCLUDED.amount, rent_amount = EXCLUDED.rent_amount,
         electricity_amount = EXCLUDED.electricity_amount,
         internet_amount = EXCLUDED.internet_amount,
         water_amount = EXCLUDED.water_amount,
         credit_amount = EXCLUDED.credit_amount,
         adjustment_amount = EXCLUDED.adjustment_amount,
         adjustment_note = EXCLUDED.adjustment_note,
         amount_paid = EXCLUDED.amount_paid,
         skip_water = EXCLUDED.skip_water,
         water_custom = EXCLUDED.water_custom
       RETURNING *`,
      values
    );
    // When final-month payment is marked paid with a credit, mark credits as applied.
    if (paid && b.renter_id && creditAmt > 0) {
      await pool.query(
        `UPDATE renters SET credits_applied = true WHERE id = $1`,
        [b.renter_id]
      );
    }
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.post("/api/renters/:id/apply-deposit", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const renterId = parseInt(req.params.id, 10);
    await client.query("BEGIN");
    const renterRes = await client.query("SELECT * FROM renters WHERE id = $1 FOR UPDATE", [renterId]);
    if (!renterRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Renter not found" });
    }
    const renter = renterRes.rows[0];
    const poolAmt = money2((Number(renter.deposit) || 0) + (Number(renter.advance_rent) || 0));
    const billed = await client.query(
      `SELECT * FROM payments WHERE renter_id = $1
       ORDER BY period_year ASC, period_month ASC, id ASC`,
      [renterId]
    );
    const alreadyCredited = billed.rows.reduce((sum, row) => sum + money2(row.credit_amount), 0);
    let remaining = money2(Math.max(0, poolAmt - alreadyCredited));
    if (remaining <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No deposit/advance left to apply. It may already be credited on their bills.",
      });
    }
    const applied = [];
    for (const row of billed.rows) {
      if (remaining <= 0) break;
      const due = money2(row.amount);
      const paidSoFar = money2(row.amount_paid);
      const legacyPaid = row.paid && paidSoFar <= 0.005;
      if (legacyPaid || paymentIsSettled(due, paidSoFar)) continue;
      const leftover = Math.max(0, money2(due - paidSoFar));
      if (leftover <= 0.005) continue;
      const use = Math.min(leftover, remaining);
      const newCredit = money2((Number(row.credit_amount) || 0) + use);
      const gross = money2(
        (Number(row.rent_amount) || 0) +
        (Number(row.electricity_amount) || 0) +
        (Number(row.internet_amount) || 0) +
        (Number(row.water_amount) || 0)
      );
      const newAmount = paymentNetDue(gross, newCredit, row.adjustment_amount);
      const newPaid = paymentIsSettled(newAmount, paidSoFar);
      const paidDate = newPaid
        ? (row.paid_date || new Date().toISOString().slice(0, 10))
        : row.paid_date;
      await client.query(
        `UPDATE payments
         SET credit_amount = $1, amount = $2, paid = $3, paid_date = $4
         WHERE id = $5`,
        [newCredit, newAmount, newPaid, paidDate, row.id]
      );
      remaining = money2(remaining - use);
      applied.push({
        payment_id: row.id,
        period_year: row.period_year,
        period_month: row.period_month,
        applied: use,
        remaining_due: Math.max(0, money2(newAmount - paidSoFar)),
      });
    }
    await client.query("UPDATE renters SET credits_applied = true WHERE id = $1", [renterId]);
    await client.query("COMMIT");
    res.json({
      applied,
      leftover_deposit: remaining,
      message: applied.length
        ? "Deposit applied to " + applied.length + " unpaid bill" + (applied.length === 1 ? "" : "s") + "."
        : "No unpaid bills found to apply the deposit to.",
    });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

/* ---------------- Room billing history ---------------- */
app.get("/api/room-billing-history", async (req, res, next) => {
  try {
    const where = req.query.room_id ? "WHERE room_id = $1" : "";
    const params = req.query.room_id ? [req.query.room_id] : [];
    const result = await pool.query(
      `SELECT * FROM room_billing_history ${where}
       ORDER BY period_year DESC, period_month DESC, room_id ASC`,
      params
    );
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/room-billing-history/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM room_billing_history WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Meter history / billing rollover ---------------- */
app.get("/api/meter-history", async (req, res, next) => {
  try {
    const [rooms, house] = await Promise.all([
      pool.query(
        `SELECT id, room_id, room_name, period_year, period_month,
                prev_reading, curr_reading, usage_kwh, electricity_rate,
                electricity_charge, water_prev_reading, water_curr_reading,
                usage_water, water_rate, water_charge, created_at
         FROM room_meter_history
         ORDER BY period_year DESC, period_month DESC, room_name`
      ),
      pool.query(
        `SELECT id, period_year, period_month, prev_reading, curr_reading,
                usage_kwh, bill_amount, water_prev_reading, water_curr_reading,
                usage_water, water_rate, water_charge, created_at
         FROM house_meter_history
         ORDER BY period_year DESC, period_month DESC`
      ),
    ]);
    res.json({ rooms: rooms.rows, house: house.rows });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/house-meter-history/:id", async (req, res) => {
  res.status(403).json({ error: "Main house meter history records cannot be deleted." });
});

app.post("/api/meter-rollover", async (req, res, next) => {
  const body = req.body || {};
  const year = parseInt(body.year, 10);
  const month = parseInt(body.month, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "A valid billing year and month are required." });
  }

  const roomReadings = Array.isArray(body.rooms) ? body.rooms : [];
  const houseInput = body.house_meter || {};
  const waterOverrideMap = {};
  (Array.isArray(body.water_people) ? body.water_people : []).forEach(function (w) {
    if (w && w.renter_id != null) waterOverrideMap[Number(w.renter_id)] = w;
  });
  const readingMap = {};
  roomReadings.forEach(function (r) {
    if (r && r.id != null) readingMap[Number(r.id)] = r;
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Run sequentially — pg clients cannot run concurrent queries on one connection.
    const settingsResult = await client.query(
      "SELECT rate, internet_rate, water_rate FROM settings WHERE id = 1"
    );
    const roomsResult = await client.query("SELECT * FROM rooms ORDER BY sort_order, id");
    const rentersResult = await client.query(
      `SELECT id, room_id, first_name, last_name, stay_start_date,
              deposit, advance_rent, notice_end_date, credits_applied, free_water
       FROM renters
       WHERE room_id IS NOT NULL AND COALESCE(status, 'active') <> 'moved_out'`
    );
    const settings = settingsResult.rows[0] || { rate: 15, internet_rate: 250, water_rate: 150 };
    const electricityRate = Number(settings.rate) || 0;
    const internetRate = Number(settings.internet_rate) || 0;
    const waterPerPerson = Math.round((Number(settings.water_rate) || 0) * 100) / 100;

    const hasRoomElec = roomsResult.rows.some(function (room) {
      const reading = readingMap[room.id];
      return reading && reading.curr_reading != null && reading.curr_reading !== "";
    });
    const hasBill =
      houseInput.bill_amount != null &&
      houseInput.bill_amount !== "" &&
      isFinite(Number(houseInput.bill_amount));

    if (!hasRoomElec && !hasBill) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Enter a room electricity reading or our electricity bill.",
      });
    }

    const billAmount = hasBill ? Number(houseInput.bill_amount) : null;
    const billedRenterIds = new Set();

    // Persist house electricity bill only (water is a flat monthly fee per person).
    if (hasBill) {
      await client.query(
        `INSERT INTO house_meter_history
           (period_year, period_month, prev_reading, curr_reading, usage_kwh, bill_amount,
            water_prev_reading, water_curr_reading, usage_water, water_rate, water_charge)
         VALUES ($1,$2,NULL,NULL,0,COALESCE($3,0),NULL,NULL,0,$4,0)
         ON CONFLICT (period_year, period_month)
         DO UPDATE SET
           bill_amount = CASE WHEN $3::numeric IS NOT NULL THEN $3::numeric ELSE house_meter_history.bill_amount END,
           water_rate = $4`,
        [year, month, billAmount, waterPerPerson]
      );
    }

    for (const room of roomsResult.rows) {
      const roomRenters = rentersResult.rows.filter((r) => r.room_id === room.id);
      const reading = readingMap[room.id] || {};
      const hasElec = reading.curr_reading != null && reading.curr_reading !== "";
      if (!roomRenters.length && !hasElec) continue;

      let previous = null;
      let current = null;
      let usage = 0;
      let electricityCharge = 0;
      if (hasElec) {
        previous = reading.prev_reading == null || reading.prev_reading === ""
          ? Number(reading.curr_reading)
          : Number(reading.prev_reading);
        current = Number(reading.curr_reading);
        usage = Math.max(0, current - previous);
        electricityCharge = usage * electricityRate;
      }

      if (hasElec) {
        await client.query(
          `INSERT INTO room_meter_history
             (room_id, room_name, period_year, period_month, prev_reading,
              curr_reading, usage_kwh, electricity_rate, electricity_charge)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (room_id, period_year, period_month) WHERE room_id IS NOT NULL
           DO UPDATE SET room_name = EXCLUDED.room_name,
             prev_reading = EXCLUDED.prev_reading,
             curr_reading = EXCLUDED.curr_reading,
             usage_kwh = EXCLUDED.usage_kwh,
             electricity_rate = EXCLUDED.electricity_rate,
             electricity_charge = EXCLUDED.electricity_charge`,
          [room.id, room.name, year, month, previous, current, usage, electricityRate, electricityCharge]
        );
      }

      if (!roomRenters.length) continue;

      const renterCount = Math.max(1, roomRenters.length);
      const powerShare = electricityCharge / renterCount;
      const rentShare = Number(room.rate_per_person) || 0;
      const roomWaterAmount = waterPerPerson * roomRenters.length;

      const rentersSnapshot = roomRenters.map((r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(Unnamed)",
        free_water: false,
      }));
      const occupantAmount = Number(room.occupant_amount) || 1;
      const ratePerPerson = Number(room.rate_per_person) || 0;
      const roomRentAmount = occupantAmount * ratePerPerson;
      const roomInternetAmount = roomRenters.length * internetRate;
      const roomTotal = roomRentAmount + electricityCharge + roomInternetAmount + roomWaterAmount;

      await client.query(
        `INSERT INTO room_billing_history
           (room_id, room_name, period_year, period_month, occupant_amount, rate_per_person,
            rent_amount, prev_reading, curr_reading, kwh_used, electricity_rate, electricity_amount,
            internet_amount, water_amount, water_prev_reading, water_curr_reading, water_used,
            total_amount, renters_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,0,$15,$16)
         ON CONFLICT (room_id, period_year, period_month) WHERE room_id IS NOT NULL
         DO UPDATE SET
           room_name = EXCLUDED.room_name,
           occupant_amount = EXCLUDED.occupant_amount,
           rate_per_person = EXCLUDED.rate_per_person,
           rent_amount = EXCLUDED.rent_amount,
           prev_reading = EXCLUDED.prev_reading,
           curr_reading = EXCLUDED.curr_reading,
           kwh_used = EXCLUDED.kwh_used,
           electricity_rate = EXCLUDED.electricity_rate,
           electricity_amount = EXCLUDED.electricity_amount,
           internet_amount = EXCLUDED.internet_amount,
           water_amount = EXCLUDED.water_amount,
           water_prev_reading = NULL,
           water_curr_reading = NULL,
           water_used = 0,
           total_amount = EXCLUDED.total_amount,
           renters_snapshot = EXCLUDED.renters_snapshot`,
        [
          room.id, room.name, year, month, occupantAmount, ratePerPerson,
          roomRentAmount, previous, current, usage, electricityRate, electricityCharge,
          roomInternetAmount, roomWaterAmount,
          roomTotal, JSON.stringify(rentersSnapshot),
        ]
      );

      for (const renter of roomRenters) {
        const frac = prorationFractionServer(renter.stay_start_date, year, month);
        const proratedRent = Math.round(rentShare * frac * 100) / 100;
        const proratedInternet = Math.round(internetRate * frac * 100) / 100;
        const existingPay = await client.query(
          `SELECT skip_water, water_custom, water_amount FROM payments
           WHERE renter_id = $1 AND period_year = $2 AND period_month = $3`,
          [renter.id, year, month]
        );
        const existing = existingPay.rows[0];
        const override = waterOverrideMap[renter.id];
        let skipWater = false;
        let waterCustom = false;
        let renterWater = waterPerPerson;
        if (override) {
          skipWater = !!(override.skip_water === true || override.skip_water === "true" || override.skip_water === 1);
          renterWater = skipWater ? 0 : money2(override.water_amount != null ? override.water_amount : waterPerPerson);
          waterCustom = skipWater ||
            override.water_custom === true ||
            Math.abs(renterWater - waterPerPerson) > 0.005;
        } else if (existing) {
          skipWater = !!existing.skip_water;
          waterCustom = !!existing.water_custom;
          if (skipWater) renterWater = 0;
          else if (waterCustom && existing.water_amount != null) {
            renterWater = money2(existing.water_amount);
          }
        }
        const gross = proratedRent + powerShare + proratedInternet + renterWater;
        let credit = 0;
        if (isFinalNoticePeriodServer(renter.notice_end_date, year, month) && !renter.credits_applied) {
          credit = Math.min(gross, (Number(renter.deposit) || 0) + (Number(renter.advance_rent) || 0));
        }
        const amount = money2(Math.max(0, gross - credit));
        await client.query(
          `INSERT INTO payments
             (room_id, renter_id, period_year, period_month, paid, amount,
              rent_amount, electricity_amount, internet_amount, water_amount, credit_amount,
              skip_water, water_custom)
           VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL
           DO UPDATE SET amount = GREATEST(0, ROUND((EXCLUDED.amount - COALESCE(payments.adjustment_amount, 0))::numeric, 2)),
             rent_amount = EXCLUDED.rent_amount,
             electricity_amount = EXCLUDED.electricity_amount,
             internet_amount = EXCLUDED.internet_amount,
             water_amount = EXCLUDED.water_amount,
             credit_amount = EXCLUDED.credit_amount,
             skip_water = EXCLUDED.skip_water,
             water_custom = EXCLUDED.water_custom,
             paid = CASE
               WHEN COALESCE(payments.amount_paid, 0) >= GREATEST(0, ROUND((EXCLUDED.amount - COALESCE(payments.adjustment_amount, 0))::numeric, 2))
               THEN true ELSE false END
           WHERE payments.paid = false`,
          [room.id, renter.id, year, month, amount, proratedRent, powerShare, proratedInternet, renterWater, credit, skipWater, waterCustom]
        );
        billedRenterIds.add(Number(renter.id));
      }
    }

    const extraWaterIds = Object.keys(waterOverrideMap)
      .map(Number)
      .filter(function (id) { return id && !billedRenterIds.has(id); });
    if (extraWaterIds.length) {
      const extraRenters = await client.query(
        `SELECT id, room_id, stay_start_date, deposit, advance_rent, notice_end_date, credits_applied, status
         FROM renters WHERE id = ANY($1::int[])`,
        [extraWaterIds]
      );
      for (const renter of extraRenters.rows) {
        const override = waterOverrideMap[renter.id];
        if (!override) continue;
        const skipWater = !!(override.skip_water === true || override.skip_water === "true" || override.skip_water === 1);
        const renterWater = skipWater ? 0 : money2(override.water_amount != null ? override.water_amount : waterPerPerson);
        const waterCustom = skipWater ||
          override.water_custom === true ||
          Math.abs(renterWater - waterPerPerson) > 0.005;
        const existingPay = await client.query(
          `SELECT id, room_id, rent_amount, electricity_amount, internet_amount,
                  credit_amount, adjustment_amount, amount_paid, paid
           FROM payments
           WHERE renter_id = $1 AND period_year = $2 AND period_month = $3`,
          [renter.id, year, month]
        );
        const existing = existingPay.rows[0];
        if (!existing && skipWater) continue;
        let roomId = renter.room_id || (override.room_id != null ? Number(override.room_id) : null);
        if (!roomId && existing) roomId = existing.room_id;
        if (!roomId) {
          const lastPay = await client.query(
            `SELECT room_id FROM payments
             WHERE renter_id = $1 AND room_id IS NOT NULL
             ORDER BY period_year DESC, period_month DESC LIMIT 1`,
            [renter.id]
          );
          roomId = lastPay.rows[0] && lastPay.rows[0].room_id;
        }
        if (!roomId) continue;
        const rentAmt = existing ? Number(existing.rent_amount) || 0 : 0;
        const elecAmt = existing ? Number(existing.electricity_amount) || 0 : 0;
        const inetAmt = existing ? Number(existing.internet_amount) || 0 : 0;
        const creditAmt = existing ? Number(existing.credit_amount) || 0 : 0;
        const adjAmt = existing ? Number(existing.adjustment_amount) || 0 : 0;
        const amount = money2(Math.max(0, rentAmt + elecAmt + inetAmt + renterWater - creditAmt - adjAmt));
        await client.query(
          `INSERT INTO payments
             (room_id, renter_id, period_year, period_month, paid, amount,
              rent_amount, electricity_amount, internet_amount, water_amount, credit_amount,
              skip_water, water_custom)
           VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL
           DO UPDATE SET
             water_amount = EXCLUDED.water_amount,
             skip_water = EXCLUDED.skip_water,
             water_custom = EXCLUDED.water_custom,
             amount = GREATEST(0, ROUND((
               COALESCE(payments.rent_amount, 0) +
               COALESCE(payments.electricity_amount, 0) +
               COALESCE(payments.internet_amount, 0) +
               EXCLUDED.water_amount -
               COALESCE(payments.credit_amount, 0) -
               COALESCE(payments.adjustment_amount, 0)
             )::numeric, 2)),
             paid = CASE
               WHEN COALESCE(payments.amount_paid, 0) >= GREATEST(0, ROUND((
                 COALESCE(payments.rent_amount, 0) +
                 COALESCE(payments.electricity_amount, 0) +
                 COALESCE(payments.internet_amount, 0) +
                 EXCLUDED.water_amount -
                 COALESCE(payments.credit_amount, 0) -
                 COALESCE(payments.adjustment_amount, 0)
               )::numeric, 2))
               THEN true ELSE false END
           WHERE payments.paid = false`,
          [roomId, renter.id, year, month, amount, rentAmt, elecAmt, inetAmt, renterWater, creditAmt, skipWater, waterCustom]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ message: "Bills generated for " + month + "/" + year + "." });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

/* ---------------- Rent Expenses ---------------- */
app.post("/api/expenses", async (req, res, next) => {
  try {
    const b = req.body || {};
    const recurrence = b.recurrence_type === "one_time" ? "one_time" : "monthly";
    const endMonth = recurrence === "monthly" ? (num(b.end_month) || null) : null;
    const endYear = recurrence === "monthly" ? (num(b.end_year) || null) : null;
    const sortRow = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expenses");
    const result = await pool.query(
      `INSERT INTO expenses (name, amount, recurrence_type, expense_month, expense_year, end_month, end_year, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [b.name || "", num(b.amount), recurrence,
       recurrence === "one_time" ? (num(b.expense_month) || null) : null,
       recurrence === "one_time" ? (num(b.expense_year)  || null) : null,
       endMonth, endYear,
       sortRow.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/expenses/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const recurrence = b.recurrence_type === "one_time" ? "one_time" : "monthly";
    const endMonth = recurrence === "monthly" ? (num(b.end_month) || null) : null;
    const endYear = recurrence === "monthly" ? (num(b.end_year) || null) : null;
    const result = await pool.query(
      `UPDATE expenses
       SET name = $1, amount = $2, recurrence_type = $3, expense_month = $4, expense_year = $5,
           end_month = $6, end_year = $7
       WHERE id = $8 RETURNING *`,
      [b.name || "", num(b.amount), recurrence,
       recurrence === "one_time" ? (num(b.expense_month) || null) : null,
       recurrence === "one_time" ? (num(b.expense_year)  || null) : null,
       endMonth, endYear,
       req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Expense not found" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/expenses/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM expenses WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Loans ---------------- */
const MONTH_NAMES_SERVER = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function phNowDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    iso: get("year") + "-" + get("month") + "-" + get("day"),
  };
}

function addMonthsClamped(year, month, add) {
  const idx = (year * 12 + (month - 1)) + add;
  return {
    year: Math.floor(idx / 12),
    month: (idx % 12) + 1,
  };
}

function formatLoanDateLabel(iso) {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split("-").map(Number);
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return MONTH_NAMES_SERVER[parts[1] - 1] + " " + parts[2] + ", " + parts[0];
}

function loanStats(loan, payments) {
  const today = phNowDate();
  const original = Number(loan.original_amount) || 0;
  const balance = Number(loan.current_balance) || 0;
  const monthly = Number(loan.monthly_payment) || 0;
  const paidTotal = (payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const paidCount = (payments || []).length;
  const progressFromBalance = original > 0
    ? Math.max(0, Math.min(100, ((original - balance) / original) * 100))
    : 0;
  const monthsLeft = monthly > 0 && balance > 0
    ? Math.ceil(balance / monthly)
    : (balance > 0 ? null : 0);

  // Next 15th due date (today or later).
  let nextYear = today.year;
  let nextMonth = today.month;
  if (today.day > 15) {
    const n = addMonthsClamped(today.year, today.month, 1);
    nextYear = n.year;
    nextMonth = n.month;
  }
  const nextPaymentIso = balance > 0 && monthly > 0
    ? nextYear + "-" + String(nextMonth).padStart(2, "0") + "-15"
    : null;

  // Finish date = 15th of the month after (monthsLeft - 1) payments from next due.
  let payoffIso = null;
  let durationLabel = null;
  if (balance <= 0 || loan.status === "paid_off") {
    payoffIso = lastPaymentIsoFrom(payments) || today.iso;
    durationLabel = "Paid off";
  } else if (monthsLeft != null && monthsLeft > 0) {
    const finish = addMonthsClamped(nextYear, nextMonth, monthsLeft - 1);
    payoffIso = finish.year + "-" + String(finish.month).padStart(2, "0") + "-15";
    const years = Math.floor(monthsLeft / 12);
    const remMonths = monthsLeft % 12;
    const parts = [];
    if (years > 0) parts.push(years + (years === 1 ? " year" : " years"));
    if (remMonths > 0) parts.push(remMonths + (remMonths === 1 ? " month" : " months"));
    if (!parts.length) parts.push("less than 1 month");
    durationLabel = parts.join(" ");
  }

  const sortedAsc = (payments || []).slice().sort(function (a, b) {
    return String(a.payment_date).localeCompare(String(b.payment_date));
  });
  const firstPayment = sortedAsc.length ? sortedAsc[0] : null;
  const lastPayment = payments && payments.length ? payments[0] : null;
  const startIso = loan.start_date
    ? String(loan.start_date).slice(0, 10)
    : (loan.created_at ? String(loan.created_at).slice(0, 10) : null);

  let daysUntilNext = null;
  if (nextPaymentIso) {
    const t = Date.UTC(today.year, today.month - 1, today.day);
    const n = Date.UTC(nextYear, nextMonth - 1, 15);
    daysUntilNext = Math.round((n - t) / 86400000);
  }

  let daysUntilPayoff = null;
  if (payoffIso && balance > 0) {
    const t = Date.UTC(today.year, today.month - 1, today.day);
    const p = payoffIso.split("-").map(Number);
    const f = Date.UTC(p[0], p[1] - 1, p[2]);
    daysUntilPayoff = Math.max(0, Math.round((f - t) / 86400000));
  }

  return {
    paid_total: Math.round(paidTotal * 100) / 100,
    paid_count: paidCount,
    progress_pct: Math.round(progressFromBalance * 10) / 10,
    months_left: monthsLeft,
    duration_left_label: durationLabel,
    next_payment_date: nextPaymentIso,
    next_payment_label: formatLoanDateLabel(nextPaymentIso),
    days_until_next: daysUntilNext,
    payoff_date: payoffIso,
    payoff_label: formatLoanDateLabel(payoffIso),
    days_until_payoff: daysUntilPayoff,
    first_payment_date: firstPayment ? firstPayment.payment_date : null,
    first_payment_label: firstPayment ? formatLoanDateLabel(firstPayment.payment_date) : null,
    last_payment_date: lastPayment ? lastPayment.payment_date : null,
    last_payment_label: lastPayment ? formatLoanDateLabel(lastPayment.payment_date) : null,
    last_payment_amount: lastPayment ? Number(lastPayment.amount) || 0 : null,
    start_date: startIso,
    start_label: formatLoanDateLabel(startIso),
    auto_pay: loan.auto_pay !== false,
  };
}

function lastPaymentIsoFrom(payments) {
  if (!payments || !payments.length) return null;
  return payments[0].payment_date ? String(payments[0].payment_date).slice(0, 10) : null;
}

/** Post monthly loan payments for every 15th that has passed since auto_pay_from. */
async function applyDueLoanPayments() {
  const today = phNowDate();
  const loansResult = await pool.query(
    `SELECT * FROM loans
     WHERE status = 'active'
       AND COALESCE(auto_pay, true) = true
       AND COALESCE(monthly_payment, 0) > 0
       AND COALESCE(current_balance, 0) > 0
     ORDER BY id`
  );
  let applied = 0;

  for (const loan of loansResult.rows) {
    const monthly = Number(loan.monthly_payment) || 0;
    if (monthly <= 0) continue;

    const fromIso = loan.auto_pay_from
      ? String(loan.auto_pay_from).slice(0, 10)
      : String(loan.created_at).slice(0, 10);
    const fromParts = fromIso.split("-").map(Number);
    let year = fromParts[0];
    let month = fromParts[1];
    if (!year || !month) continue;

    const existing = await pool.query(
      `SELECT period_year, period_month FROM loan_payments
       WHERE loan_id = $1 AND period_year IS NOT NULL AND period_month IS NOT NULL`,
      [loan.id]
    );
    const paidKeys = {};
    existing.rows.forEach(function (p) {
      paidKeys[p.period_year + "-" + p.period_month] = true;
    });

    let balance = Number(loan.current_balance) || 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
        [loan.id]
      );
      if (!locked.rows.length || locked.rows[0].status !== "active") {
        await client.query("ROLLBACK");
        continue;
      }
      balance = Number(locked.rows[0].current_balance) || 0;

      while (balance > 0) {
        const dueIso =
          year + "-" + String(month).padStart(2, "0") + "-15";
        const duePassed =
          year < today.year ||
          (year === today.year && month < today.month) ||
          (year === today.year && month === today.month && today.day >= 15);

        if (!duePassed) break;
        if (dueIso < fromIso) {
          month += 1;
          if (month > 12) { month = 1; year += 1; }
          continue;
        }

        const key = year + "-" + month;
        if (!paidKeys[key]) {
          const amount = Math.min(monthly, balance);
          const note = "Auto — 15 " + MONTH_NAMES_SERVER[month - 1] + " " + year;
          await client.query(
            `INSERT INTO loan_payments
               (loan_id, amount, payment_date, period_year, period_month, note, is_auto)
             VALUES ($1,$2,$3,$4,$5,$6,true)`,
            [loan.id, amount, dueIso, year, month, note]
          );
          balance = Math.max(0, Math.round((balance - amount) * 100) / 100);
          paidKeys[key] = true;
          applied += 1;
        }

        month += 1;
        if (month > 12) { month = 1; year += 1; }
        if (year > today.year + 1) break;
      }

      const status = balance <= 0 ? "paid_off" : "active";
      await client.query(
        `UPDATE loans
         SET current_balance = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [balance, status, loan.id]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  return applied;
}

app.get("/api/loans", async (req, res, next) => {
  try {
    await applyDueLoanPayments();
    const loansResult = await pool.query(
      "SELECT * FROM loans ORDER BY status ASC, id ASC"
    );
    const paymentsResult = await pool.query(
      `SELECT * FROM loan_payments
       ORDER BY payment_date DESC, id DESC`
    );
    const paymentsByLoan = {};
    paymentsResult.rows.forEach(function (p) {
      if (!paymentsByLoan[p.loan_id]) paymentsByLoan[p.loan_id] = [];
      paymentsByLoan[p.loan_id].push(p);
    });
    const loans = loansResult.rows.map(function (loan) {
      const payments = paymentsByLoan[loan.id] || [];
      return Object.assign({}, loan, { payments: payments, stats: loanStats(loan, payments) });
    });
    res.json({ loans: loans });
  } catch (e) {
    next(e);
  }
});

app.post("/api/loans", async (req, res, next) => {
  try {
    const b = req.body || {};
    const original = Number(b.original_amount) || 0;
    const balance = b.current_balance != null && b.current_balance !== ""
      ? Number(b.current_balance)
      : original;
    const today = phNowDate();
    const autoPay = b.auto_pay === false || b.auto_pay === "false" ? false : true;
    const result = await pool.query(
      `INSERT INTO loans
         (name, lender, original_amount, current_balance, monthly_payment, start_date, notes, status,
          auto_pay, auto_pay_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        b.name || "House Loan",
        b.lender || "",
        original,
        Math.max(0, balance),
        Number(b.monthly_payment) || 0,
        b.start_date || null,
        b.notes || "",
        b.status === "paid_off" ? "paid_off" : "active",
        autoPay,
        b.auto_pay_from || today.iso,
      ]
    );
    const loan = result.rows[0];
    if (autoPay) await applyDueLoanPayments();
    const refreshed = await pool.query("SELECT * FROM loans WHERE id = $1", [loan.id]);
    const payments = await pool.query(
      `SELECT * FROM loan_payments WHERE loan_id = $1
       ORDER BY payment_date DESC, id DESC`,
      [loan.id]
    );
    const row = refreshed.rows[0] || loan;
    res.status(201).json(Object.assign({}, row, {
      payments: payments.rows,
      stats: loanStats(row, payments.rows),
    }));
  } catch (e) {
    next(e);
  }
});

app.put("/api/loans/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const existing = await pool.query("SELECT * FROM loans WHERE id = $1", [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Loan not found" });
    const autoPay = b.auto_pay === false || b.auto_pay === "false" ? false : true;
    const result = await pool.query(
      `UPDATE loans SET
         name = $1,
         lender = $2,
         original_amount = $3,
         current_balance = $4,
         monthly_payment = $5,
         start_date = $6,
         notes = $7,
         status = $8,
         auto_pay = $9,
         auto_pay_from = COALESCE(auto_pay_from, $10),
         updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        b.name || "House Loan",
        b.lender || "",
        Number(b.original_amount) || 0,
        Math.max(0, Number(b.current_balance) || 0),
        Number(b.monthly_payment) || 0,
        b.start_date || null,
        b.notes || "",
        b.status === "paid_off" ? "paid_off" : "active",
        autoPay,
        phNowDate().iso,
        req.params.id,
      ]
    );
    if (autoPay) await applyDueLoanPayments();
    const payments = await pool.query(
      `SELECT * FROM loan_payments WHERE loan_id = $1
       ORDER BY payment_date DESC, id DESC`,
      [req.params.id]
    );
    const loan = (await pool.query("SELECT * FROM loans WHERE id = $1", [req.params.id])).rows[0] || result.rows[0];
    res.json(Object.assign({}, loan, {
      payments: payments.rows,
      stats: loanStats(loan, payments.rows),
    }));
  } catch (e) {
    next(e);
  }
});

app.delete("/api/loans/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM loans WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Loan not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

app.post("/api/loans/:id/payments", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Payment amount must be greater than 0." });
    }
    await client.query("BEGIN");
    const loanRes = await client.query("SELECT * FROM loans WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!loanRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Loan not found" });
    }
    const loan = loanRes.rows[0];
    const payDate = b.payment_date || new Date().toISOString().slice(0, 10);
    const year = b.period_year != null && b.period_year !== ""
      ? parseInt(b.period_year, 10)
      : parseInt(String(payDate).slice(0, 4), 10);
    const month = b.period_month != null && b.period_month !== ""
      ? parseInt(b.period_month, 10)
      : parseInt(String(payDate).slice(5, 7), 10);

    const payRes = await client.query(
      `INSERT INTO loan_payments
         (loan_id, amount, payment_date, period_year, period_month, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [loan.id, amount, payDate, year || null, month || null, b.note || ""]
    );

    const newBalance = Math.max(0, (Number(loan.current_balance) || 0) - amount);
    const status = newBalance <= 0 ? "paid_off" : "active";
    const updated = await client.query(
      `UPDATE loans
       SET current_balance = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newBalance, status, loan.id]
    );
    const payments = await client.query(
      `SELECT * FROM loan_payments WHERE loan_id = $1
       ORDER BY payment_date DESC, id DESC`,
      [loan.id]
    );
    await client.query("COMMIT");
    const row = updated.rows[0];
    res.status(201).json(Object.assign({}, row, {
      payments: payments.rows,
      stats: loanStats(row, payments.rows),
      payment: payRes.rows[0],
    }));
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.delete("/api/loans/:loanId/payments/:paymentId", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loanRes = await client.query(
      "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
      [req.params.loanId]
    );
    if (!loanRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Loan not found" });
    }
    const payRes = await client.query(
      "DELETE FROM loan_payments WHERE id = $1 AND loan_id = $2 RETURNING *",
      [req.params.paymentId, req.params.loanId]
    );
    if (!payRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payment not found" });
    }
    const restored = Math.max(0, (Number(loanRes.rows[0].current_balance) || 0) + (Number(payRes.rows[0].amount) || 0));
    const status = restored <= 0 ? "paid_off" : "active";
    const updated = await client.query(
      `UPDATE loans
       SET current_balance = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [restored, status, req.params.loanId]
    );
    const payments = await client.query(
      `SELECT * FROM loan_payments WHERE loan_id = $1
       ORDER BY payment_date DESC, id DESC`,
      [req.params.loanId]
    );
    await client.query("COMMIT");
    const row = updated.rows[0];
    res.json(Object.assign({}, row, {
      payments: payments.rows,
      stats: loanStats(row, payments.rows),
    }));
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

/* ===================================================================
   FINANCIAL SYSTEM ENDPOINTS
   =================================================================== */

/* ---------------- Financial Categories ---------------- */
app.get("/api/financial-categories", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM financial_categories ORDER BY date_created ASC"
    );
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.post("/api/financial-categories", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name is required" });
    const result = await pool.query(
      `INSERT INTO financial_categories (name, color) VALUES ($1, $2) RETURNING *`,
      [b.name.trim(), b.color || "#6366f1"]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/financial-categories/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const result = await pool.query(
      `UPDATE financial_categories SET name = $1, color = $2 WHERE id = $3 RETURNING *`,
      [b.name || "", b.color || "#6366f1", req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Category not found" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/financial-categories/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM financial_categories WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Financial Expenses/Income ---------------- */
app.get("/api/financial-expenses", async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const type = req.query.type || null;
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;

    const result = await pool.query(
      `SELECT fe.*, fc.name AS category_name, fc.color AS category_color
       FROM financial_expenses fe
       LEFT JOIN financial_categories fc ON fc.id = fe.category_id
       WHERE ($1::int IS NULL OR EXTRACT(YEAR FROM fe.expense_date) = $1)
         AND ($2::int IS NULL OR EXTRACT(MONTH FROM fe.expense_date) = $2)
         AND ($3::text IS NULL OR fe.type = $3)
         AND ($4::int IS NULL OR fe.category_id = $4)
       ORDER BY fe.expense_date DESC, fe.date_created DESC`,
      [year, month, type, categoryId]
    );
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.post("/api/financial-expenses", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name is required" });
    if (!b.amount || isNaN(Number(b.amount))) return res.status(400).json({ error: "valid amount is required" });
    const result = await pool.query(
      `INSERT INTO financial_expenses
         (category_id, name, amount, type, expense_date, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        b.category_id || null,
        b.name.trim(),
        num(b.amount),
        b.type === "income" ? "income" : "expense",
        b.expense_date || null,
        b.payment_method || "cash",
        b.notes || "",
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/financial-expenses/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const result = await pool.query(
      `UPDATE financial_expenses
       SET category_id = $1, name = $2, amount = $3, type = $4,
           expense_date = $5, payment_method = $6, notes = $7
       WHERE id = $8 RETURNING *`,
      [
        b.category_id || null,
        b.name || "",
        num(b.amount),
        b.type === "income" ? "income" : "expense",
        b.expense_date || null,
        b.payment_method || "cash",
        b.notes || "",
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Record not found" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/financial-expenses/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM financial_expenses WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------- Financial Summary (for dashboard) ---------------- */
app.get("/api/financial-summary", async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;

    const [monthSummary, yearSummary, byCategoryResult] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
         FROM financial_expenses
         WHERE EXTRACT(YEAR FROM expense_date) = $1
           AND EXTRACT(MONTH FROM expense_date) = $2`,
        [year, month]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
         FROM financial_expenses
         WHERE EXTRACT(YEAR FROM expense_date) = $1`,
        [year]
      ),
      pool.query(
        `SELECT fc.name, fc.color,
           COALESCE(SUM(CASE WHEN fe.type = 'expense' THEN fe.amount ELSE 0 END), 0) AS total
         FROM financial_categories fc
         LEFT JOIN financial_expenses fe ON fe.category_id = fc.id
           AND EXTRACT(YEAR FROM fe.expense_date) = $1
           AND EXTRACT(MONTH FROM fe.expense_date) = $2
         GROUP BY fc.id, fc.name, fc.color
         ORDER BY total DESC`,
        [year, month]
      ),
    ]);

    const m = monthSummary.rows[0];
    const y = yearSummary.rows[0];
    res.json({
      month: {
        income: Number(m.total_income),
        expenses: Number(m.total_expenses),
        net: Number(m.total_income) - Number(m.total_expenses),
      },
      year: {
        income: Number(y.total_income),
        expenses: Number(y.total_expenses),
        net: Number(y.total_income) - Number(y.total_expenses),
      },
      byCategory: byCategoryResult.rows.map((r) => ({
        name: r.name,
        color: r.color,
        total: Number(r.total),
      })),
    });
  } catch (e) {
    next(e);
  }
});

/* ===================================================================
   RESET (Rent System only)
   =================================================================== */
app.post("/api/reset", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM room_meter_history");
    await client.query("DELETE FROM house_meter_history");
    await client.query("DELETE FROM room_billing_history");
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM renters");
    await client.query("DELETE FROM rooms");
    await client.query("DELETE FROM expenses");
    await client.query("DELETE FROM loan_payments");
    await client.query("DELETE FROM loans");
    await client.query(
      "UPDATE settings SET rate = 15, cost = 0, internet_rate = 250, water_rate = 150, currency = '₱' WHERE id = 1"
    );
    await client.query(
      `INSERT INTO rooms (name, occupant_amount, rate_per_person, sort_order) VALUES
        ('Room 1', 1, 0, 1),
        ('Room 2', 1, 0, 2),
        ('Room 3', 1, 0, 3),
        ('Room 4', 1, 0, 4)`
    );
    await client.query("COMMIT");
    res.status(204).end();
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Check the server window for details." });
});

async function seedDefaultRooms() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM rooms");
  if (rows[0].cnt === 0) {
    await pool.query(`
      INSERT INTO rooms (name, occupant_amount, rate_per_person, sort_order)
      VALUES
        ('Room 1', 1, 0, 1),
        ('Room 2', 1, 0, 2),
        ('Room 3', 1, 0, 3),
        ('Room 4', 1, 0, 4)
    `);
    console.log("Seeded 4 default rooms.");
  }
}

ensureLatestSchema()
  .then(seedDefaultRooms)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Lauglaug Systems running at http://localhost:${PORT}`);
    });
    // Catch up auto loan payments on startup and about every hour (15th PH time).
    applyDueLoanPayments().catch(function (err) {
      console.error("Loan auto-pay catch-up failed:", err.message);
    });
    setInterval(function () {
      applyDueLoanPayments().catch(function (err) {
        console.error("Loan auto-pay check failed:", err.message);
      });
    }, 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error("Could not prepare the database schema:", err);
    process.exitCode = 1;
  });
