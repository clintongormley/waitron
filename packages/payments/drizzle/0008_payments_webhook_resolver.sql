-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies, SECURITY DEFINER functions or ownership, so none of this survives a later `generate`.
-- Adds no table/column; 0008_snapshot.json is a byte-for-byte copy of 0007's.
--
-- WHAT THIS CLOSES. A Mode 3 inbound webhook has NO tenant context. `payments` carries FORCE ROW
-- LEVEL SECURITY and `payments_tenant_isolation` fails closed (current_tenant_id() is NULL with no
-- `app.tenant_id` GUC), so a lookup by (provider, external_ref) under the non-superuser app_user
-- role returns nothing. This builds a seam that lets ONE lookup — (provider, external_ref) ->
-- tenant_id — cross tenants, and nothing else, mirroring fiscal's envios_tenants_with_work
-- (fiscal 0004): a dedicated NOLOGIN role + a per-role permissive SELECT policy + a SECURITY DEFINER
-- function owned by that role, returning ONLY tenant_id.
--
-- Deliberately NOT "grant a role BYPASSRLS": granting BYPASSRLS requires the grantor to already hold
-- it, which the hardened migration role does not. A per-role permissive SELECT policy needs only
-- ordinary GRANT/CREATE POLICY on a table the migration role already owns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payments_webhook_resolver') THEN
    CREATE ROLE payments_webhook_resolver NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'payments_webhook_resolver' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'payments_webhook_resolver already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s payments unfiltered';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO payments_webhook_resolver;--> statement-breakpoint
GRANT SELECT ON "payments" TO payments_webhook_resolver;--> statement-breakpoint

-- Role-scoped bypass: visible only when the CURRENT role is payments_webhook_resolver, which nothing
-- but resolve_payment_tenant's SECURITY DEFINER context ever runs as. FOR SELECT only, and additive
-- to payments_tenant_isolation (Postgres ORs permissive policies: (tenant_id = current_tenant_id())
-- OR true = true), so every other role's isolation is unchanged.
CREATE POLICY "payments_webhook_resolver_lookup" ON "payments"
  FOR SELECT
  TO payments_webhook_resolver
  USING (true);--> statement-breakpoint

-- SECURITY DEFINER + fixed search_path: runs with the owner's (payments_webhook_resolver's)
-- privileges, so the SELECT sees rows through the role-scoped permissive policy regardless of
-- app.tenant_id. Returns ONLY tenant_id (uuid) — never a wider payments column.
CREATE FUNCTION resolve_payment_tenant(p_provider text, p_external_ref text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM payments
  WHERE provider = p_provider AND external_ref = p_external_ref
  LIMIT 1
$$;--> statement-breakpoint

-- Reassign ownership to the NOLOGIN role via the temporary-grant dance (0004/0005 document why it is
-- required even for a CREATEROLE-holding non-superuser migration role). Both grants are revoked
-- immediately, so no standing privilege from this bootstrap survives.
GRANT CREATE ON SCHEMA public TO payments_webhook_resolver;--> statement-breakpoint
GRANT payments_webhook_resolver TO CURRENT_USER WITH INHERIT FALSE;--> statement-breakpoint
ALTER FUNCTION resolve_payment_tenant(text, text) OWNER TO payments_webhook_resolver;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM payments_webhook_resolver;--> statement-breakpoint
REVOKE payments_webhook_resolver FROM CURRENT_USER;--> statement-breakpoint

-- The application role calls the seam; the SECURITY DEFINER context does the crossing. EXECUTE is
-- named to app_user only; PUBLIC's default EXECUTE is revoked so no other role can invoke it.
REVOKE EXECUTE ON FUNCTION resolve_payment_tenant(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_payment_tenant(text, text) TO app_user;
