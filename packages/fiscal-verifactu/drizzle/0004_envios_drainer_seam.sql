-- Hand-written custom migration (drizzle-kit `generate --custom`), same reason
-- 0001_registros_inmutables.sql / 0003_envio_flujo_rls.sql give: drizzle-kit diffs against its own
-- snapshot and has no concept of roles, policies, SECURITY DEFINER functions or ownership, so none
-- of this would survive a later `generate` run if it lived in a generated file — and it does not
-- need to, because a generated migration never touches it again. `0004_snapshot.json` is therefore
-- a byte-for-byte copy of 0003's table set (this migration adds no table/column).
--
-- WHAT THIS CLOSES. `drain.ts`'s top-level `tenantsWithWork` must enumerate EVERY tenant's due work
-- to decide which tenants to drain — a deliberately cross-tenant read. But `envios` carries FORCE
-- ROW LEVEL SECURITY (0001_registros_inmutables.sql) and its `envios_tenant_isolation` policy fails
-- closed: `current_tenant_id()` returns NULL when `app.tenant_id` is unset, so the predicate
-- `tenant_id = current_tenant_id()` matches ZERO rows. Under the hardened non-superuser `app_user`
-- role a plain `select distinct tenant_id from envios` therefore returns nothing, and the drainer is
-- a silent no-op in a real deployment (spec §7.1/§11). This migration builds the seam that lets that
-- one enumeration cross tenants, and NOTHING else, under exactly that constrained role.
--
-- THE MECHANISM is the one 0005_sales.sql already proved live for `sales_assert_tenders_cover` (read
-- that file's long comment for the full rationale, verified against a genuine non-superuser,
-- non-BYPASSRLS owner): a dedicated NOLOGIN role + a per-role permissive `FOR SELECT` policy on the
-- table + a SECURITY DEFINER function reassigned to OWN by that role. Because the function runs with
-- the owner's privileges and `current_user` becomes `envios_drainer` inside it, the SELECT below
-- sees rows through the role-scoped permissive policy (Postgres ORs every applicable permissive
-- policy: `(tenant_id = current_tenant_id()) OR true` = true) regardless of `app.tenant_id`.
--
-- Deliberately NOT "grant the owner BYPASSRLS": granting BYPASSRLS requires the grantor to already
-- hold BYPASSRLS (0005_sales.sql verified even a CREATEROLE-holding non-superuser is refused), so it
-- cannot be granted by a migration running under the exact hardened role FORCE ROW LEVEL SECURITY
-- exists for — it would need a separate superuser bootstrap. A per-role permissive SELECT policy
-- needs only ordinary GRANT/CREATE POLICY on a table the migration role already owns, so it deploys
-- under that same constrained role with no extra step.

-- Bootstraps the role the enumeration runs as. Kept separate from app_user: never granted to the
-- application, NOLOGIN, and exists solely so `envios_tenants_with_work` (below) can be reassigned to
-- it. Idempotent for the same reason app_user's / sales_coverage_checker's creation is: roles are
-- cluster-global, and the postgres test target shares one cluster across every database in the
-- suite. A pre-existing role WITH LOGIN would be a real hole — anyone who could authenticate as it
-- would read every tenant's envios unfiltered through the permissive policy below — so that specific
-- case is rejected rather than silently reused, mirroring app_user's / sales_coverage_checker's guard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'envios_drainer') THEN
    CREATE ROLE envios_drainer NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'envios_drainer' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'envios_drainer already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s envios unfiltered';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO envios_drainer;--> statement-breakpoint
GRANT SELECT ON "envios" TO envios_drainer;--> statement-breakpoint

-- The role-scoped bypass: visible only when the CURRENT role during query execution is
-- envios_drainer, which nothing but envios_tenants_with_work's SECURITY DEFINER context ever runs
-- as. FOR SELECT only (this seam never writes) and additive to envios_tenant_isolation above — for
-- every other role that policy still applies exactly as written, because Postgres ORs together every
-- applicable permissive policy for a command.
CREATE POLICY "envios_drainer_enumeration" ON "envios"
  FOR SELECT
  TO envios_drainer
  USING (true);--> statement-breakpoint

-- The enumeration seam. Returns the distinct set of tenant ids with DUE work as of `p_now`, matching
-- `tenantsWithWork`'s (drain.ts) predicate EXACTLY:
--   - a due `pendiente` row (estado = 'pendiente' AND proximo_intento_en <= p_now), OR
--   - a recoverable stale `enviando` row (estado = 'enviando' AND enviado_en older than the
--     RECUPERACION_ENVIANDO_MS window) — the lone-stuck-`enviando`-with-no-`pendiente` tenant that
--     drain.ts's own doc comment explains must still be swept so recoverStaleClaims can reach it.
--
-- THRESHOLD COUPLING: `interval '300000 milliseconds'` is RECUPERACION_ENVIANDO_MS (`5 * 60_000` ms)
-- in drain.ts, expressed as a literal so it needs no GUC/param. These two MUST stay in sync — if you
-- change RECUPERACION_ENVIANDO_MS, change this interval to the same number of milliseconds (and vice
-- versa). They cannot be derived from one source across the TS/SQL boundary, so the value is stated
-- once in each place with this cross-reference; drain.concurrency.test.ts proves the seam end to end.
--
-- SECURITY DEFINER + `SET search_path = pg_catalog, public`: runs with the owner's (envios_drainer's)
-- privileges and a fixed, injection-proof search path (same shape as sales_assert_tenders_cover).
-- It returns ONLY tenant ids (setof uuid) — never any wider envios column — so app_user gains the
-- cross-tenant enumeration it needs and nothing more.
CREATE FUNCTION envios_tenants_with_work(p_now timestamptz)
  RETURNS setof uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT tenant_id
  FROM envios
  WHERE (estado = 'pendiente' AND proximo_intento_en <= p_now)
     OR (estado = 'enviando' AND enviado_en < p_now - interval '300000 milliseconds')
$$;--> statement-breakpoint

-- Reassigns ownership to the role created above — the SAME temporary-grant dance 0005_sales.sql
-- documents and verified live is required even for a CREATEROLE-holding non-superuser migration role:
-- an ownership transfer checks both that the acting role can SET ROLE to the new owner AND that the
-- new owner holds CREATE on the function's schema. Both grants are revoked immediately after, so no
-- standing privilege from this bootstrap survives (not CREATE on schema public for envios_drainer,
-- and not membership in envios_drainer for whichever role ran this migration).
GRANT CREATE ON SCHEMA public TO envios_drainer;--> statement-breakpoint
GRANT envios_drainer TO CURRENT_USER WITH INHERIT FALSE;--> statement-breakpoint
ALTER FUNCTION envios_tenants_with_work(timestamptz) OWNER TO envios_drainer;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM envios_drainer;--> statement-breakpoint
REVOKE envios_drainer FROM CURRENT_USER;--> statement-breakpoint

-- The application role calls the seam; the SECURITY DEFINER context does the crossing. EXECUTE is
-- granted explicitly to app_user (rather than left to PUBLIC's default) so the one intended caller is
-- named; PUBLIC's default EXECUTE is also revoked so no other role can invoke the cross-tenant
-- enumeration.
REVOKE EXECUTE ON FUNCTION envios_tenants_with_work(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION envios_tenants_with_work(timestamptz) TO app_user;
