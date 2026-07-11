-- Nuclear reset: truncates EVERY table in the public schema and restarts sequences.
-- Usage: psql -U youruser -d yourdatabase -f db/fullreset.sql
-- After running, restart the app (ensureLatestSchema + seed) or run db/schema.sql seeds.

DO $$
DECLARE
  target_schema text := 'public';
  r record;
  tbl_list text := '';
BEGIN
  FOR r IN
    SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS full_name
    FROM pg_tables
    WHERE schemaname = target_schema
  LOOP
    tbl_list := tbl_list || r.full_name || ', ';
  END LOOP;

  IF tbl_list = '' THEN
    RAISE NOTICE 'No tables found in schema %', target_schema;
    RETURN;
  END IF;

  tbl_list := left(tbl_list, length(tbl_list) - 2);
  EXECUTE 'TRUNCATE TABLE ' || tbl_list || ' RESTART IDENTITY CASCADE';
  RAISE NOTICE 'Truncated all tables in schema %', target_schema;
END $$;
