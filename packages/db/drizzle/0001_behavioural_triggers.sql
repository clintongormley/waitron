-- The nine BEHAVIOURAL rules this package carried under PostgreSQL, restored as SQLite triggers.
--
-- Regenerating every migration set from the TypeScript schema for the storage switch dropped every
-- hand-written trigger: a trigger has never been declarable in TypeScript, so all of them lived in
-- `--custom` SQL and went with the regeneration. The eighteen APPEND-ONLY ones came back at runtime
-- (`installAppendOnlyTriggers`, `packages/store/src/append-only.ts`, called from
-- `packages/migrations/src/apply.ts`, from names each module declares). These nine came back as
-- nothing, and this file is where they come back.
--
-- WHY ALL NINE ARE TRIGGERS AGAIN, rather than checks moved into the callers: each is a
-- database-level backstop that survives ANY caller, SQLite expresses all nine, and restoring them
-- as triggers preserves the behaviour exactly rather than moving a refusal into one code path and
-- leaving every other path — a repair script, a future route, a restore — unguarded.
--
-- THREE ENGINE DIFFERENCES, none of them a behaviour change:
--
--   1. SQLite has no `BEFORE INSERT OR UPDATE` — one trigger takes exactly one event. The three
--      triggers that covered more than one event are split, keeping the PostgreSQL name as the base
--      and suffixing the event, so fourteen names stand for nine rules. (The binding rule at the
--      foot of this file arrived split ALREADY: PostgreSQL wrote it as two triggers of its own, for
--      a reason that outlives the engine, and its names are unchanged.)
--   2. PostgreSQL interpolated ids into its messages with `%` (`working order % cannot transition
--      from % to %`). SQLite's `raise` takes a LITERAL only, so every message here is a fixed
--      string. `packages/db/drizzle/0001_db_baseline_sql.sql` on `origin/main` has the originals.
--   3. `is` is SQLite's null-safe comparison, which is PostgreSQL's `IS DISTINCT FROM` inverted.
--
-- Each body is `select raise(abort, '…') where <the refused case>;` rather than a trigger `WHEN`
-- clause. Both parse here (measured 2026-09-22 on Node v26.7.0, SQLite 3.53.4, against this
-- package's own `0000_baseline.sql`), and the body form is used throughout so that every one of
-- these reads the same way whether or not its condition needs a subquery.
--
-- The tenant column was dropped on 2026-09-14, so every predicate the originals wrote against it is
-- gone. On `origin/main` the migration that dropped it had already rewritten two of these bodies
-- without it; the remaining tenant predicates are dropped the same way here. (The column is not
-- named anywhere in this file on purpose: `scripts/no-tenant-column.test.ts` reads migration SQL as
-- TEXT, so it cannot tell a comment from a column, and it fails on either.)
--
-- A refusal raised below arrives at `node:sqlite` as errcode 1811 (`SQLITE_CONSTRAINT_TRIGGER`)
-- with `message` equal to the raise text. An `ON DELETE RESTRICT` refusal carries the SAME code
-- with the message `FOREIGN KEY constraint failed`, so a caller that needs to tell them apart reads
-- the message, not the code. Guard: `scripts/behavioural-triggers.test.ts`, which pins every name
-- AND tries a real offending write against each rule, with an accepting control beside it.

-- A settlement's tenders must cover the sale: the sale's total, plus the SIGNED total of every
-- rectificativa that corrects it (usually negative), plus the tips those tenders carried.
--
-- A settlement for a sale row that does not exist is ACCEPTED, silently, exactly as
-- `sales_assert_tenders_cover` returned early — "the sale itself was rolled back; nothing left to
-- reconcile". The `exists` on the first line of the WHERE says so out loud, and it changes no
-- outcome: deleted from this trigger, the whole suite in `scripts/behavioural-triggers.test.ts`
-- still passes in full (measured 2026-09-22, when it held 35 cases), because with no sale row
-- `(SELECT total …)` is NULL,
-- `<>` against NULL is NULL, and the WHERE is not satisfied. It is kept as a statement of intent,
-- not as a condition anything rests on, and no test can tell it apart from its absence.
--
-- Every amount here is a count of whole cents (`packages/shared/src/cents.ts`), so this is integer
-- arithmetic with no rounding of any kind.
CREATE TRIGGER sale_settlements_check_coverage
BEFORE INSERT ON sale_settlements
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tenders do not cover the sale')
  WHERE exists (SELECT 1 FROM sales WHERE id = new.sale_id)
    AND (SELECT coalesce(sum(amount), 0) FROM tenders WHERE sale_id = new.sale_id)
        <> (SELECT total FROM sales WHERE id = new.sale_id)
           + (SELECT coalesce(sum(total), 0) FROM sales WHERE corrects_sale_id = new.sale_id)
           + (SELECT coalesce(sum(tip_amount), 0) FROM tenders WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
-- Once a sale is settled its tender set is closed. PostgreSQL raised this under SQLSTATE `WT002`;
-- this engine has no SQLSTATEs, so the message is what a caller matches on.
CREATE TRIGGER tenders_reject_post_settlement
BEFORE INSERT ON tenders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tender rejected: the sale is already settled')
  WHERE exists (SELECT 1 FROM sale_settlements WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
-- The legal status transitions of a working order.
--
--   open     → anything (a label edit keeps it open; any next state is reachable)
--   placed   → settled or abandoned, and nothing else
--   settled  → settled, ONLY as the kitchen-handover stamp
--
-- The handover stamp (KDS-1 §3e) is the only field that may be written on an already-settled order:
-- a Mode-P walk-up settles before it is fired, so it has no placed → settled transition to carry
-- the stamp. Nothing else about a settled order may change — the fiscal record was filed at settle
-- and is untouched here. That is what the column-by-column list enforces, and it names every column
-- of `working_orders` except the two the stamp itself moves (`status`, `collected_at`).
--
-- `is` is SQLite's null-safe comparison — PostgreSQL wrote this as `IS NOT DISTINCT FROM`. It never
-- yields NULL, so the whole `not (…)` is a plain true or false.
CREATE TRIGGER working_orders_enforce_transition
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'working order cannot make that transition')
  WHERE NOT (
    old.status = 'open'
    OR (old.status = 'placed' AND new.status IN ('settled', 'abandoned'))
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.till_id IS old.till_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id)
  );
END;
--> statement-breakpoint
-- Lines may only be written while their order is open. A parent that does not exist refuses too —
-- `not exists (… AND status = 'open')` covers the missing row and the wrong status in one clause,
-- which is what the PostgreSQL body's `IS DISTINCT FROM 'open'` did with a NULL parent status.
--
-- Three triggers for one rule: SQLite takes one event per trigger. The insert and update pair read
-- `new`, the delete one reads `old`.
CREATE TRIGGER working_order_lines_require_open_parent_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_delete
BEFORE DELETE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
-- A line's `descriptions` map must carry EXACTLY the venue's configured invoice locales — every one
-- of them, and nothing else. `locations.invoice_locales` is a JSON array and `descriptions` a JSON
-- object, both held in `text` columns on this engine, so `json_each` reads the array's `value`s and
-- the object's `key`s.
--
-- THE COMPARISON IS BETWEEN TWO SETS, spelled as `not exists` in BOTH directions: one side finds a
-- supplied locale the venue does not invoice in, the other finds a venue locale the line omitted.
-- Deliberately NOT an ordered `group_concat` of each side — SQLite does not guarantee that an inner
-- `ORDER BY` fixes the order `group_concat` accumulates in, so that shape would need a version
-- claim this file cannot make. Two `not exists` need none and are order-independent by
-- construction.
--
-- PostgreSQL raised a SECOND, distinct message when the join resolved to no location at all
-- ("working order % has no resolvable location"). Here that case FOLDS INTO THIS SAME REFUSAL — the
-- first clause below — because `raise` takes a literal, so a second message would mean a second
-- trigger, and from a caller's side the two are the same fault: the line's locales could not be
-- shown to match the venue's. Stated here so nobody reading the SQL assumes two messages survive.
CREATE TRIGGER working_order_lines_check_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN tills t ON t.id = wo.till_id
           JOIN locations l ON l.id = t.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN tills t ON t.id = wo.till_id
           JOIN locations l ON l.id = t.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
-- The same rule for the OPTIONAL `variant_descriptions` map, which is nullable: a line with no
-- variant map is untouched, which is the leading `is not null` guard. `sale_lines` is deliberately
-- uncovered and nothing in the database covers it instead — what holds the rule for a sold line is
-- the ROUTE (the till files from a persisted working order whose lines this already checked, and
-- `packages/core/src/sale-line-rows.ts` copies the maps across verbatim). The two `check_locales`
-- triggers above carry the set-comparison and folded-message reasoning that applies here too.
CREATE TRIGGER working_order_lines_check_variant_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN tills t ON t.id = wo.till_id
             JOIN locations l ON l.id = t.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN tills t ON t.id = wo.till_id
             JOIN locations l ON l.id = t.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
-- The one that ACTS rather than refusing: a dining table's service status belongs to the tab that
-- is open on it, so when that tab closes — settled or abandoned — the status comes off the table.
-- The `WHEN` clause carries the same condition PostgreSQL's did.
CREATE TRIGGER working_orders_clear_table_status
AFTER UPDATE ON working_orders
FOR EACH ROW
WHEN old.status IN ('open', 'placed') AND new.status IN ('settled', 'abandoned')
BEGIN
  UPDATE dining_tables SET status_id = NULL WHERE tab_id = new.id;
END;
--> statement-breakpoint
-- A device is DEFINED by its profile's form factor, and the binding rule reads that form factor to
-- decide a device's station or register binding. So a profile's form factor must not change out
-- from under an ACTIVE device that references it — that would silently invalidate the device's
-- binding without re-running the binding rule, which only fires on writes to `devices`.
--
-- `d.active` is a `boolean` column, which on this engine is an integer; `<> 0` reads it without
-- assuming which truthy value was written.
CREATE TRIGGER device_profile_form_factor_locked
BEFORE UPDATE ON device_profiles
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'cannot change form factor of a profile in use by an active device')
  WHERE new.form_factor <> old.form_factor
    AND exists (
      SELECT 1 FROM devices d WHERE d.device_profile_id = new.id AND d.active <> 0
    );
END;
--> statement-breakpoint
-- The BINDING RULE: a device's form factor — read from its PROFILE, never from a column on the
-- device — decides what it binds. A `kds` device binds a kitchen station and no register; every
-- other form factor binds a register and no station. No CHECK constraint can say this, because the
-- deciding value lives in another table; it has always been a trigger.
--
-- TWO triggers for one rule, the file header's difference 1: SQLite takes one event per trigger.
-- PostgreSQL split the same rule in two as well, and for a second reason that survives here — the
-- UPDATE half is GATED. `requireDevice` touches `last_seen_at` on every authenticated request, and
-- that UPDATE changes no binding column, so the gate is false and the `device_profiles` lookup
-- never runs.
--
-- The gate is a `WHEN` rather than the body form the rest of this file uses: it decides WHETHER the
-- rule runs at all and is shared by all three refusals below it, so in the bodies it would be the
-- same four lines written three times. `is not` is SQLite's null-safe comparison, which is
-- PostgreSQL's `IS DISTINCT FROM`, and `active` is a boolean column — an integer on this engine —
-- so it is read against 0 rather than against a truthy value this file would have to assume.
--
-- The `old.active = 0 and new.active <> 0` disjunct re-validates a REACTIVATION, and without it
-- this sequence lands an active device whose binding contradicts its profile: deactivate the
-- device, change the profile's form factor (`device_profile_form_factor_locked` above permits that
-- while no ACTIVE device references it), then switch the device back on. Guard: the reactivation
-- case in `packages/db/src/schema/devices.trigger.test.ts`.
--
-- The first refusal, on a `device_profile_id` naming no profile, is unreachable through the product:
-- `devices.device_profile_id` is NOT NULL with an `ON DELETE RESTRICT` foreign key, and the store
-- turns foreign keys on (`packages/store/src/index.ts:133`). It is kept because the rule must not
-- rest on that — with the row missing, `form_factor` is NULL, and BOTH arms below compare against
-- NULL and stay silent, so dropping this line would ACCEPT such a device rather than refuse it.
-- `scripts/behavioural-triggers.test.ts` runs with `pragma foreign_keys = off` and is where it is
-- exercised.
--
-- ENGINE DIFFERENCE, beyond the header's three: PostgreSQL enforced this with a pair of CONSTRAINT
-- triggers that took `for share` on the profile row so a concurrent form-factor UPDATE serialised
-- against an insert instead of racing it. There are no row locks here and nothing below takes one;
-- what serialises two writers now is the venue file's write queue
-- (`packages/store/src/write-queue.ts`). Nothing in this repository re-proves that claim for this
-- rule — the concurrency case that made it was deleted with the PostgreSQL harness, as
-- `packages/db/src/schema/device-profiles.trigger.test.ts` records.
CREATE TRIGGER device_binding_rule_insert
BEFORE INSERT ON devices
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station and no register')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND (new.station_id IS NULL OR new.till_id IS NOT NULL);

  SELECT raise(abort, 'a non-kds device binds a register and no station')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.till_id IS NULL OR new.station_id IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER device_binding_rule_update
BEFORE UPDATE ON devices
FOR EACH ROW
WHEN (
  old.station_id IS NOT new.station_id
  OR old.till_id IS NOT new.till_id
  OR old.device_profile_id IS NOT new.device_profile_id
  OR (old.active = 0 AND new.active <> 0)
)
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station and no register')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND (new.station_id IS NULL OR new.till_id IS NOT NULL);

  SELECT raise(abort, 'a non-kds device binds a register and no station')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.till_id IS NULL OR new.station_id IS NOT NULL);
END;
