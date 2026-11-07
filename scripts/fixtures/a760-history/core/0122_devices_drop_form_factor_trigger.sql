-- The next migration rebuilds `devices`, and its rename fails while a trigger on another table names
-- `devices`; this one comes back unchanged in the migration after it.
DROP TRIGGER `device_profile_form_factor_locked`;
