-- Hand-written custom migration (drizzle-kit generate --custom): a PARTIAL unique index is not in
-- src/schema/payments.ts, so drizzle-kit's snapshot never diffs or drops it (same reason the RLS /
-- GRANT / resolver-seam migrations are hand-written). 0007_snapshot.json is a byte-for-byte copy of
-- 0006's — this migration adds no table or column.
--
-- Mode 3's (provider, external_ref) idempotency + untenanted-resolver anchor: for an integrated or
-- hosted tender external_ref holds the processor's globally-unique reference, so a redelivered
-- initiate/webhook cannot double-insert. PARTIAL and provider <> 'manual': a manual datáfono's
-- external_ref is a free-form hand-keyed operation number — neither unique nor always present — so
-- manual rows (and any null external_ref) are excluded. A table-wide unique here would collide on
-- those, the exact class of bug #25's whole-branch review caught.
CREATE UNIQUE INDEX "payments_provider_external_ref_key"
  ON "payments" ("provider", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "provider" <> 'manual';
