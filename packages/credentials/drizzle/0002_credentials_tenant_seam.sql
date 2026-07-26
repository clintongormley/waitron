-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies, SECURITY DEFINER functions or ownership, so none of this survives a later `generate`.
-- Adds no table/column; the accompanying snapshot is a byte-for-byte copy of the previous one.
--
-- WHAT THIS CLOSES. The host must ask "which tenants have credentials for purpose X" to build the
-- tenant list it hands to the scheduler — a question with no tenant context, asked before any
-- tenant is scoped. `tenant_credentials` carries FORCE ROW LEVEL SECURITY and its isolation policy
-- fails closed (current_tenant_id() is NULL with no `app.tenant_id` GUC), so that query returns
-- nothing under the non-superuser app_user role.
--
-- This is the THIRD instance of one pattern, and a deliberate clone rather than a new invention:
-- fiscal's envios_tenants_with_work (fiscal 0004) and payments' resolve_payment_tenant
-- (payments 0008). A dedicated NOLOGIN role + a per-role permissive SELECT policy + a SECURITY
-- DEFINER function owned by that role, returning ONLY tenant ids — never ciphertext, never an iv,
-- never a key version.
--
-- Deliberately NOT "grant a role BYPASSRLS": granting BYPASSRLS requires the grantor to already
-- hold it, which the hardened migration role does not.
--
-- tenant_id is `uuid` here (tenant_credentials.tenant_id, packages/credentials/src/schema/
-- tenant-credentials.ts), not `text` — so the function RETURNS SETOF uuid, matching
-- resolve_payment_tenant's and envios_tenants_with_work's own uuid-typed tenant_id columns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'credentials_enumerator') THEN
    CREATE ROLE credentials_enumerator NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'credentials_enumerator' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'credentials_enumerator already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s sealed credentials';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO credentials_enumerator;--> statement-breakpoint
GRANT SELECT ON "tenant_credentials" TO credentials_enumerator;--> statement-breakpoint

-- Role-scoped bypass: visible only when the CURRENT role is credentials_enumerator, which nothing
-- but credential_tenants's SECURITY DEFINER context ever runs as. FOR SELECT only, and additive to
-- tenant_credentials_tenant_isolation (Postgres ORs permissive policies), so every other role's
-- isolation is unchanged.
CREATE POLICY "credentials_enumerator_lookup" ON "tenant_credentials"
  FOR SELECT
  TO credentials_enumerator
  USING (true);--> statement-breakpoint

-- Returns ONLY tenant ids. A wider return — even key_version — would leak one tenant's
-- provisioning state to every other, for no caller that needs it.
CREATE FUNCTION credential_tenants(p_purpose text)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM tenant_credentials
  WHERE purpose = p_purpose
  ORDER BY tenant_id
$$;--> statement-breakpoint

-- Reassign ownership to the NOLOGIN role via the temporary-grant dance (fiscal 0004 / payments 0008
-- document why it is required even for a CREATEROLE-holding non-superuser migration role). Both
-- grants are revoked immediately, so no standing privilege from this bootstrap survives.
GRANT CREATE ON SCHEMA public TO credentials_enumerator;--> statement-breakpoint
GRANT credentials_enumerator TO CURRENT_USER WITH INHERIT FALSE;--> statement-breakpoint
ALTER FUNCTION credential_tenants(text) OWNER TO credentials_enumerator;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM credentials_enumerator;--> statement-breakpoint
REVOKE credentials_enumerator FROM CURRENT_USER;--> statement-breakpoint

-- The application role calls the seam; the SECURITY DEFINER context does the crossing. EXECUTE is
-- named to app_user only; PUBLIC's default EXECUTE is revoked so no other role can invoke it.
REVOKE EXECUTE ON FUNCTION credential_tenants(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION credential_tenants(text) TO app_user;
