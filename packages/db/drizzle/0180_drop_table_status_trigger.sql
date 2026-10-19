-- Venue-made table statuses are retired (A757 slice 2); the next migration rebuilds dining_tables.
DROP TRIGGER parties_clear_table_status;
