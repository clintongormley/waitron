import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The one place the storage engine's column types are named.
 *
 * Every table definition imports its columns from here so the engine can be changed in one file
 * rather than in every column definition across the schema. The bodies below emit PostgreSQL types;
 * the SQLite switch replaces them and nothing else.
 *
 * Scale is part of the meaning, not decoration: money, quantity and rate are three different
 * scales and a single "numeric" helper would let one silently truncate another.
 */

/** A uuid identifier. */
export const id = (name: string) => uuid(name);

/** A moment on the server clock, read back as a `Date`. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A structured document. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

/** A monetary amount: two decimal places. */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** A quantity: three decimal places, so 0.005 kg is representable. */
export const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** A percentage rate: two decimal places, e.g. a 21.00 VAT rate. */
export const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * A closed vocabulary. Text plus a check constraint rather than a database enum type, which is
 * already the house preference for a vocabulary that may widen (`drawer_opens.reason`,
 * `invoice_series.purpose`): widening costs a one-line migration instead of an `ALTER TYPE`.
 *
 * The caller still writes the `check()` on the table; this helper supplies the column and its
 * TypeScript type so the two cannot drift apart. `values` is read for its TYPE only, which is why
 * the parameter is unused in the body.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only parameter, see above
export const enumText = <T extends string>(name: string, _values: readonly T[]) =>
  text(name).$type<T>();

/** A true/false flag. */
export const flag = (name: string) => boolean(name);

/** A whole number. */
export const count = (name: string) => integer(name);

/** Free text. */
export const label = (name: string) => text(name);

export const table = pgTable;
