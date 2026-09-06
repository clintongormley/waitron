REVOKE ALL ON "payments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "payment_refunds" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_refunds" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "payment_policy" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_policy" TO app_user;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_external_ref_key"
  ON "payments" ("provider", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "provider" <> 'manual';
--> statement-breakpoint
CREATE FUNCTION resolve_payment_tenant(p_provider text, p_external_ref text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM payments
  WHERE provider = p_provider AND external_ref = p_external_ref
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_payment_tenant(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_payment_tenant(text, text) TO app_user;
