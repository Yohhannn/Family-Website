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

/* ---------------- Full state ---------------- */
app.get("/api/state", async (req, res, next) => {
  try {
    const [settings, rooms, renters, houseMeter, expenses] = await Promise.all([
      pool.query("SELECT rate, cost, currency FROM settings WHERE id = 1"),
      pool.query("SELECT * FROM rooms ORDER BY sort_order, id"),
      pool.query("SELECT * FROM renters ORDER BY sort_order, id"),
      pool.query("SELECT prev_reading, curr_reading FROM house_meter WHERE id = 1"),
      pool.query("SELECT * FROM expenses ORDER BY sort_order, id"),
    ]);
    res.json({
      settings: settings.rows[0] || { rate: 15, cost: 0, currency: "₱" },
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
    const { rate, cost, currency } = req.body;
    const result = await pool.query(
      `UPDATE settings SET rate = $1, cost = $2, currency = $3 WHERE id = 1 RETURNING *`,
      [num(rate), num(cost), currency || "₱"]
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
      `INSERT INTO rooms (name, rent_type, flat_rent, rate_per_person, persons, prev_reading, curr_reading, due_day, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        b.name || "",
        b.rent_type === "per_person" ? "per_person" : "flat",
        num(b.flat_rent),
        num(b.rate_per_person),
        num(b.persons),
        num(b.prev_reading),
        num(b.curr_reading),
        num(b.due_day),
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
         persons = $5, prev_reading = $6, curr_reading = $7, due_day = $8
       WHERE id = $9 RETURNING *`,
      [
        b.name || "",
        b.rent_type === "per_person" ? "per_person" : "flat",
        num(b.flat_rent),
        num(b.rate_per_person),
        num(b.persons),
        num(b.prev_reading),
        num(b.curr_reading),
        num(b.due_day),
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
   A "flat" room is billed (and marked paid) as a whole: one row per room per
   month, renter_id NULL. A "per_person" room is billed one renter at a time:
   one row per assigned renter per month, so each person can be marked paid
   separately. Calling GET with no year/month returns the full history. */
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
    const values = [b.room_id, b.renter_id || null, b.year, b.month, !!b.paid, b.paid_date || null, num(b.amount)];
    const conflictClause = b.renter_id
      ? "ON CONFLICT (renter_id, period_year, period_month) WHERE renter_id IS NOT NULL"
      : "ON CONFLICT (room_id, period_year, period_month) WHERE renter_id IS NULL";
    const result = await pool.query(
      `INSERT INTO payments (room_id, renter_id, period_year, period_month, paid, paid_date, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ${conflictClause}
       DO UPDATE SET paid = EXCLUDED.paid, paid_date = EXCLUDED.paid_date, amount = EXCLUDED.amount
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
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM renters");
    await client.query("DELETE FROM rooms");
    await client.query("DELETE FROM expenses");
    await client.query("UPDATE settings SET rate = 15, cost = 0, currency = '₱' WHERE id = 1");
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

app.listen(PORT, () => {
  console.log(`Lauglaug Renting & Electricity Business running at http://localhost:${PORT}`);
});
