-- `ALTER COLUMN ... SET DATA TYPE` does not re-derive the objects defined over the old type; it
-- keeps them and casts. The migration before this one rebuilt the four rate checks, because their
-- bound changed from 100 to 10000 and drizzle could see that. The two quantity checks say `<> 0`
-- in both scales, so drizzle saw nothing to do and PostgreSQL kept them as
-- `((quantity)::numeric <> (0)::numeric)` — a decimal comparison on a column that is no longer a
-- decimal. The answer is the same either way; a database whose catalogue still describes a
-- decimal is not.
--
-- Found by `packages/db/src/schema/schema-conformance.test.ts`, which builds a database from these
-- migrations and compares every check expression with the one the drizzle schema declares. It
-- named both of these and nothing else.
ALTER TABLE "working_order_lines" DROP CONSTRAINT "working_order_lines_quantity_ck";--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_quantity_ck" CHECK ("working_order_lines"."quantity" <> 0);--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_quantity_ck";--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_quantity_ck" CHECK ("sale_lines"."quantity" <> 0);
