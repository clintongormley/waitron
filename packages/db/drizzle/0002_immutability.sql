/*
 * The backstop, not the control.
 *
 * A distinct SQLSTATE rather than the plpgsql default P0001, so tests can
 * assert on the code instead of the wording — a test matching on prose breaks
 * when the message is improved, and passes when the wrong error is raised.
 * WT001 is in a user-defined class; the standard reserves classes 00–08 and
 * those beginning A–H.
 *
 * The same function serves both the row triggers and the statement triggers.
 * TG_OP distinguishes them and it always raises, so the return value is
 * unreachable.
 *
 * Created once, here, and referenced by every protected table in packages/db.
 * It takes no arguments and reads only TG_ variables, so one definition covers
 * every table without parameterisation.
 */
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'WT001';
END;
$$;
