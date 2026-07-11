require("dotenv").config();
const express = require("express");
const path = require("path");
const pool = require("./db/pool");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function num(v) {
  return v === undefined || v === null || v === "" ? null : Number(v);
}

async function ensureLatestSchema() {
  await pool.query(`
    ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS internet_rate NUMERIC(10,2) NOT NULL DEFAULT 250;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS electricity_amount NUMERIC(10,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS internet_amount NUMERIC(10,2);
    DELETE FROM payments WHERE renter_id IS NULL AND paid = false;

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
  `);
}

/* ---------------- Full state ---------------- */
app.get("/api/state", async (req, res, next) => {
  try {
    const [settings, rooms, renters, houseMeter, expenses] = await Promise.all([
      pool.query("SELECT rate, cost, internet_rate, currency FROM settings WHERE id = 1"),
      pool.query("SELECT * FROM rooms ORDER BY sort_order, id"),
      pool.query("SELECT * FROM renters ORDER BY sort_order, id"),
      pool.query("SELECT prev_reading, curr_reading FROM house_meter WHERE id = 1"),
      pool.query("SELECT * FROM expenses ORDER BY sort_order, id"),
    ]);
    res.json({
      settings: settings.rows[0] || { rate: 15, cost: 0, internet_rate: 250, currency: "₱" },
      rooms: rooms.rows,
      renters: renters.rows,
      houseMeter: houseMeter.rows[0] || { prev_reading: null, curr_reading: null },
      expenses: expenses.rows,
    });
  } catch (e) {
    next(e);
  }
});

/* ---------------- Settings ---------------- */
app.put("/api/settings", async (req, res, next) => {
  try {
    const { rate, cost, internet_rate, currency } = req.body;
    const result = await pool.query(
      `UPDATE settings
       SET rate = $1, cost = $2, internet_rate = $3, currency = $4
       WHERE id = 1 RETURNING *`,
      [num(rate), num(cost), num(internet_rate), currency || "₱"]
    );
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
      `INSERT INTO rooms (name, rent_type, flat_rent, rate_per_person, persons, prev_reading, curr_reading, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        b.name || "",
        b.rent_type === "per_person" ? "per_person" : "flat",
        num(b.flat_rent),
        num(b.rate_per_person),
        num(b.persons),
        num(b.prev_reading),
        num(b.curr_reading),
        sortRow.rows[0].next,
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
    const result = await pool.query(
      `UPDATE rooms SET name = $1, rent_type = $2, flat_rent = $3, rate_per_person = $4,
         persons = $5, prev_reading = $6, curr_reading = $7
       WHERE id = $8 RETURNING *`,
      [
        b.name || "",
        b.rent_type === "per_person" ? "per_person" : "flat",
        num(b.flat_rent),
        num(b.rate_per_person),
        num(b.persons),
        num(b.prev_reading),
        num(b.curr_reading),
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
    const sortRow = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM renters");
    const result = await pool.query(
      `INSERT INTO renters (room_id, first_name, middle_name, last_name, address, contact_number,
         emergency_contact_name, emergency_contact_relation, emergency_contact_number,
         birthday, reason_for_stay, stay_start_date, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        b.room_id || null,
        b.first_name || "",
        b.middle_name || "",
        b.last_name || "",
        b.address || "",
        b.contact_number || "",
        b.emergency_contact_name || "",
        b.emergency_contact_relation || "",
        b.emergency_contact_number || "",
        b.birthday || null,
        b.reason_for_stay || "",
        b.stay_start_date || null,
        sortRow.rows[0].next,
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
    const result = await pool.query(
      `UPDATE renters SET room_id = $1, first_name = $2, middle_name = $3, last_name = $4,
         address = $5, contact_number = $6, emergency_contact_name = $7,
         emergency_contact_relation = $8, emergency_contact_number = $9,
         birthday = $10, reason_for_stay = $11, stay_start_date = $12
       WHERE id = $13 RETURNING *`,
      [
        b.room_id || null,
        b.first_name || "",
        b.middle_name || "",
        b.last_name || "",
        b.address || "",
        b.contact_number || "",
        b.emergency_contact_name || "",
        b.emergency_contact_relation || "",
        b.emergency_contact_number || "",
        b.birthday || null,
        b.reason_for_stay || "",
        b.stay_start_date || null,
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

/* ---------------- Payments ----------------
   Every assigned renter has an individual monthly payment record. Calling
   GET with no year/month returns the full history. */
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
       WHERE ($1::int IS NULL OR p.period_year = $1) AND ($2::int IS NULL OR p.period_month = $2)
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
    if (!b.room_id || !b.year || !b.month) {
      return res.status(400).json({ error: "room_id, year, and month are required" });
    }
    if (!b.renter_id) {
      return res.status(400).json({ error: "renter_id is required for individual billing" });
    }
    const values = [
      b.room_id, b.renter_id, b.year, b.month, !!b.paid, b.paid_date || null,
      num(b.amount), num(b.rent_amount), num(b.electricity_amount), num(b.internet_amount),
    ];
    const result = await pool.query(
      `INSERT INTO payments
         (room_id, renter_id, period_year, period_month, paid, paid_date, amount,
          rent_amount, electricity_amount, internet_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL
       DO UPDATE SET paid = EXCLUDED.paid, paid_date = EXCLUDED.paid_date,
         amount = EXCLUDED.amount, rent_amount = EXCLUDED.rent_amount,
         electricity_amount = EXCLUDED.electricity_amount,
         internet_amount = EXCLUDED.internet_amount
       RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ---------------- House meter ---------------- */
app.put("/api/house-meter", async (req, res, next) => {
  try {
    const { prev_reading, curr_reading } = req.body;
    const result = await pool.query(
      `UPDATE house_meter SET prev_reading = $1, curr_reading = $2 WHERE id = 1 RETURNING *`,
      [num(prev_reading), num(curr_reading)]
    );
    res.json(result.rows[0]);
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
                electricity_charge, created_at
         FROM room_meter_history
         ORDER BY period_year DESC, period_month DESC, room_name`
      ),
      pool.query(
        `SELECT id, period_year, period_month, prev_reading, curr_reading,
                usage_kwh, created_at
         FROM house_meter_history
         ORDER BY period_year DESC, period_month DESC`
      ),
    ]);
    res.json({ rooms: rooms.rows, house: house.rows });
  } catch (e) {
    next(e);
  }
});

app.post("/api/meter-rollover", async (req, res, next) => {
  const year = parseInt(req.body && req.body.year, 10);
  const month = parseInt(req.body && req.body.month, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "A valid billing year and month are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [settingsResult, roomsResult, rentersResult, houseResult] = await Promise.all([
      client.query("SELECT rate, internet_rate FROM settings WHERE id = 1"),
      client.query("SELECT * FROM rooms ORDER BY sort_order, id"),
      client.query("SELECT id, room_id FROM renters WHERE room_id IS NOT NULL"),
      client.query("SELECT prev_reading, curr_reading FROM house_meter WHERE id = 1"),
    ]);
    const settings = settingsResult.rows[0] || { rate: 15, internet_rate: 250 };
    const electricityRate = Number(settings.rate) || 0;
    const internetRate = Number(settings.internet_rate) || 0;
    const house = houseResult.rows[0];
    const hasCurrentReading = roomsResult.rows.some((room) => room.curr_reading !== null) ||
      (house && house.curr_reading !== null);
    if (!hasCurrentReading) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Enter at least one current meter reading before finishing the period.",
      });
    }

    for (const room of roomsResult.rows) {
      if (room.curr_reading === null) continue;
      const previous = room.prev_reading === null ? Number(room.curr_reading) : Number(room.prev_reading);
      const current = Number(room.curr_reading);
      const usage = Math.max(0, current - previous);
      const electricityCharge = usage * electricityRate;

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

      const roomRenters = rentersResult.rows.filter((r) => r.room_id === room.id);
      const renterCount = roomRenters.length;
      const powerShare = renterCount ? electricityCharge / renterCount : 0;
      const rentShare = room.rent_type === "per_person"
        ? (Number(room.rate_per_person) || 0)
        : (renterCount ? (Number(room.flat_rent) || 0) / renterCount : 0);
      for (const renter of roomRenters) {
        const amount = rentShare + powerShare + internetRate;
        await client.query(
          `INSERT INTO payments
             (room_id, renter_id, period_year, period_month, paid, amount,
              rent_amount, electricity_amount, internet_amount)
           VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8)
           ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL
           DO UPDATE SET amount = EXCLUDED.amount,
             rent_amount = EXCLUDED.rent_amount,
             electricity_amount = EXCLUDED.electricity_amount,
             internet_amount = EXCLUDED.internet_amount
           WHERE payments.paid = false`,
          [room.id, renter.id, year, month, amount, rentShare, powerShare, internetRate]
        );
      }

      await client.query(
        "UPDATE rooms SET prev_reading = curr_reading, curr_reading = NULL WHERE id = $1",
        [room.id]
      );
    }

    if (house && house.curr_reading !== null) {
      const previous = house.prev_reading === null ? Number(house.curr_reading) : Number(house.prev_reading);
      const current = Number(house.curr_reading);
      const usage = Math.max(0, current - previous);
      await client.query(
        `INSERT INTO house_meter_history
           (period_year, period_month, prev_reading, curr_reading, usage_kwh)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (period_year, period_month)
         DO UPDATE SET prev_reading = EXCLUDED.prev_reading,
           curr_reading = EXCLUDED.curr_reading,
           usage_kwh = EXCLUDED.usage_kwh`,
        [year, month, previous, current, usage]
      );
      await client.query(
        "UPDATE house_meter SET prev_reading = curr_reading, curr_reading = NULL WHERE id = 1"
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Meter readings saved and carried into the next billing period." });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

/* ---------------- Expenses ---------------- */
app.post("/api/expenses", async (req, res, next) => {
  try {
    const b = req.body || {};
    const sortRow = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expenses");
    const result = await pool.query(
      `INSERT INTO expenses (name, amount, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [b.name || "", num(b.amount), sortRow.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

app.put("/api/expenses/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const result = await pool.query(
      `UPDATE expenses SET name = $1, amount = $2 WHERE id = $3 RETURNING *`,
      [b.name || "", num(b.amount), req.params.id]
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

/* ---------------- Reset everything to defaults ---------------- */
app.post("/api/reset", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM room_meter_history");
    await client.query("DELETE FROM house_meter_history");
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM renters");
    await client.query("DELETE FROM rooms");
    await client.query("DELETE FROM expenses");
    await client.query("UPDATE settings SET rate = 15, cost = 0, internet_rate = 250, currency = '₱' WHERE id = 1");
    await client.query("UPDATE house_meter SET prev_reading = NULL, curr_reading = NULL WHERE id = 1");
    await client.query(
      `INSERT INTO rooms (name, rent_type, flat_rent, rate_per_person, persons, sort_order) VALUES
        ('Room 1','flat',4000,NULL,NULL,1),
        ('Room 2','flat',4000,NULL,NULL,2),
        ('Room 3','flat',5000,NULL,NULL,3),
        ('Room 4','per_person',NULL,8000,NULL,4)`
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

ensureLatestSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Lauglaug Renting & Electricity Business running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not prepare the database schema:", err);
    process.exitCode = 1;
  });
