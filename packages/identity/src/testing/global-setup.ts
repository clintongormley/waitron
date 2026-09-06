import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "../migrations.js";

/**
 * The passkey redemption race needs independent PostgreSQL backends. One migrated template is
 * shared by the package; returning teardown stops its container after the workers finish.
 * Global setup precedes all workers, so Docker is also required for PGlite-only selections.
 *
 * The template migrates CORE then IDENTITY: identity's schema builds on core, and nothing enforces
 * that order across packages, so it is explicit in the array below.
 *
 * The probe login is declared here rather than per suite because roles are cluster-global — the
 * shared container is one cluster, so a per-file `CREATE ROLE` would fail `role … already exists`.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/identity's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite serialises every query onto one backend, so it cannot stage the two-backend " +
      "row-lock race passkey.concurrency.test.ts exists to prove.",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
    // These logins exercise the grants inherited from app_user.
    roles: [{ name: "identity_rls_probe", password: "probe", inRole: "app_user" }],
  });
  provide("sharedPg", handle);
  return teardown;
}
