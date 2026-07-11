# Lauglaug Renting & Electricity Business

A simple, friendly website to work out how much each room owes for **rent** and
for **electricity** (from your solar), see your **gross** and **net** totals,
and keep a permanent record of your **renters** — all backed by a real
PostgreSQL database, so nothing gets lost.

## One-time setup

You'll need [Node.js](https://nodejs.org) (v18 or newer) and a PostgreSQL
database already running (you said you'll host your own — any Postgres 12+
works, local or remote).

1. **Create the tables.** Point `psql` at your database and run the schema
   once:
   ```
   psql -U yourusername -d yourdatabase -f db/schema.sql
   ```
   This creates the tables and pre-fills the 4 rooms (₱4,000 / ₱4,000 /
   ₱5,000 / ₱8,000 per-person) so you're not starting from zero.

2. **Tell the app how to reach your database.** Copy `.env.example` to
   `.env` and fill in your real connection details:
   ```
   cp .env.example .env
   ```
   Then edit `.env` — either paste one connection string into
   `DATABASE_URL`, or fill in `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD`
   / `PGDATABASE` individually.

3. **Install and start the server:**
   ```
   npm install
   npm start
   ```
   You should see `Lauglaug Renting & Electricity Business running at
   http://localhost:3000`.

4. **Open the site.** Go to `http://localhost:3000` in your browser.

> The server needs to be running for the page to work (it's what talks to
> the database). Keep the terminal window open, or set it up to run
> automatically on startup if you want it always available.

## How to use it (step by step)

1. **Settings** (only needed once, or when the price changes)
   - *Electricity rate you charge*: the price per kWh. It's set to **₱15**.
   - *Your solar cost*: what one kWh costs you. Leave it **0** if you're not
     sure — then "net electricity" just equals what you charge.
   - *Currency symbol*: usually **₱**.

2. **Rooms** — one table row each, already set up for the 4 rooms.
   - Type the room's **name** and **monthly rent**.
     - If a room is charged **per person** (like Room 4), tick **"Split by
       number of people instead"** — fill in the **₱ per person** rate and
       **# of people**, and the rent is worked out for you automatically.
   - Type the **previous** and **current meter reading** from that room's
     own submeter.
   - Every bill is due on the **15th of the month**.
   - Each assigned renter is charged **₱250 internet per month** (changeable
     in Settings).
   - The row automatically shows electricity used, electricity charge,
     internet, and **total to collect**.
   - At month-end, use **Save month & start next period**. The app saves the
     previous/current readings to Meter History, creates that month's bills,
     then carries each current reading forward as the next previous reading.
   - Press **➕ Add a room** for more. Press ✕ to remove one.

3. **Main House Meter**
   - Type the **previous** and **current reading** of the meter for the
     *whole house*. Compared against the rooms' submeters, this shows
     **Family's own free use** — electricity your household used that
     wasn't billed to anyone, thanks to the solar panels.

4. **Renters** — a profile for each person, kept separate from the room's
   rent card so it doesn't get wiped when a room's numbers change.
   - Full name (first / middle / last), which **room** they're in, address,
     contact number.
   - **Emergency contact**: name, relation, and number.
   - **Birthday**, **reason for stay**, and **staying since** date — the
     card automatically shows how long they've been staying.
   - Press **➕ Add a renter** for more. Press ✕ to remove one.

5. **Rent expenses** (optional) — costs like repairs, loan/mortgage
   payment, tax, water, etc. Subtracted from rent to show your **net** rent.

6. **Summary at the top** shows everything added up: **Gross** (all money
   coming in) and **Net** (what you keep after costs), for rent,
   electricity, and combined.

## Words explained

- **Gross** = the full amount before taking away any costs.
- **Net** = what's left after costs are subtracted.
- **kWh** = the unit of electricity shown on the meter.

## Good to know

- Use the **Save changes** button on each editable tab to save your work.
- If it can't reach the database, a message explains what to check.
- **Print** button: makes a clean copy you can print or save as PDF.
- **Clear everything**: wipes all data in the database and starts fresh
  (asks first — this cannot be undone).

## Files

- `public/index.html`, `public/styles.css`, `public/app.js` — the page you
  open in the browser.
- `server.js` — the backend that talks to PostgreSQL.
- `db/schema.sql` — run once to create the database tables.
- `.env` — your database connection details (never share this file).
