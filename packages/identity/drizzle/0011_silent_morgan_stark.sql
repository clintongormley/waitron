-- Custom SQL migration file, put your code below! --

-- The per-tenant, case-insensitive, NULL-permissive uniqueness of persons.email. A functional
-- partial index rather than a column constraint: lower(email) makes it case-insensitive, the
-- (tenant_id, ...) leading column scopes it per tenant, and WHERE email IS NOT NULL lets any number
-- of PIN-only staff carry a NULL email. Drizzle's schema DSL cannot express a functional partial
-- unique index, so it is hand-written here (custom migration), which is why persons.ts documents the
-- guarantee against this index by name rather than declaring it inline.
CREATE UNIQUE INDEX "persons_tenant_email_uq"
  ON "persons" ("tenant_id", lower("email"))
  WHERE "email" IS NOT NULL;
