-- The following migration rebuilds dining_tables; its dependent trigger is restored afterwards.
DROP TRIGGER parties_clear_table_status;
