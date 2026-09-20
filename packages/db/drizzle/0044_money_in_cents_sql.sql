-- The coverage check reads four money values out of the tables and adds them up. Its locals were
-- declared `numeric(12, 2)`, which held a decimal amount exactly; the same columns now hold a
-- count of whole cents, and `numeric(12, 2)` admits only ten integer digits, so a large enough
-- amount would be rejected by the local rather than by the check. `bigint` matches what the
-- columns now are and leaves the comparison exact.
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total  bigint;
  corrections bigint;
  tendered    bigint;
  tipped      bigint;
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale (signed; usually negative).
  SELECT coalesce(sum(total), 0) INTO corrections
    FROM sales WHERE corrects_sale_id = p_sale_id;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + corrections + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + corrections + tips is %',
      p_sale_id, tendered, sale_total + corrections + tipped;
  END IF;
END;
$$;

--> statement-breakpoint
-- `ALTER COLUMN ... SET DATA TYPE` does not re-derive the objects defined over the old type; it
-- keeps them and casts. So after the type change above, a database built from these migrations
-- still describes a decimal column everywhere one of these columns is named: every check over a
-- money column reads back with a `::numeric` cast on both sides, and `tenders.tip_amount` keeps
-- the default `0.00`. All of them still behave correctly -- the casts compare the same values, and
-- the default coerces to 0 -- but a migrated database no longer matches what the schema declares,
-- which is what `packages/db/src/schema/schema-conformance.test.ts` reports. Every one is
-- re-stated below over the new type. The list is the core set's checks and defaults that name a
-- money column; the guard is what says it is complete.
ALTER TABLE "sales" DROP CONSTRAINT "sales_total_ck";--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_total_ck" CHECK ("sales"."total" >= 0 or "sales"."corrects_sale_id" is not null);--> statement-breakpoint
ALTER TABLE "tenders" ALTER COLUMN "tip_amount" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_amount_ck";--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_amount_ck" CHECK ("tenders"."amount" > 0);--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_cash_tendered_ck";--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_cash_tendered_ck" CHECK ("tenders"."cash_tendered" is null or ("tenders"."method" = 'cash' and "tenders"."cash_tendered" >= "tenders"."amount"));--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_tip_amount_ck";--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_tip_amount_ck" CHECK ("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount");
--> statement-breakpoint
-- `option_group_items.price_delta` keeps the default as `0::numeric` after the type change. The
-- conformance guard does not separate that from the declared `0`, so this one was found by
-- applying the migrations and reading information_schema back rather than by the guard.
ALTER TABLE "option_group_items" ALTER COLUMN "price_delta" SET DEFAULT 0;
