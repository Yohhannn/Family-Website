-- ============================================================
-- reset_data.sql
-- Resets all data in a PostgreSQL schema:
--   - Truncates every table (CASCADE handles FK dependencies)
--   - Restarts identity/sequence counters back to 1
--
-- USAGE:
--   psql -d your_database -f reset_data.sql
--
-- CONFIG:
--   Change target_schema below if your tables aren't in "public".
-- ============================================================

DO $$
DECLARE
    target_schema text := 'public';   -- <-- change if needed
    r record;
    tbl_list text := '';
BEGIN
    -- Build a comma-separated list of all tables in the schema
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

    -- Strip trailing comma/space
    tbl_list := left(tbl_list, length(tbl_list) - 2);

    -- TRUNCATE ... RESTART IDENTITY CASCADE:
    --   RESTART IDENTITY -> resets any associated sequences (SERIAL/IDENTITY columns) to 1
    --   CASCADE          -> also truncates tables with FK references to these tables
    EXECUTE 'TRUNCATE TABLE ' || tbl_list || ' RESTART IDENTITY CASCADE';

    RAISE NOTICE 'Reset % table(s) in schema %', (SELECT count(*) FROM pg_tables WHERE schemaname = target_schema), target_schema;
END $$;