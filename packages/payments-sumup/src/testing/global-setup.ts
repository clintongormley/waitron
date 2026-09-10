import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/payments-sumup real-Postgres tier
 * and migrates the single `core_payments` template its suites clone, instead of booting and
 * migrating a container per file. One shared container, one migrated template: cluster-global
 * roles must be distinct across every package sharing a container, so this package names its own
 * (`sumup_probe`, not stripe's `rls_probe`).
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/payments-sumup's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite connects as a superuser holding every grant, so it cannot show that the " +
      "adapter's writes land as an app_user member.",
    templates: {
      core_payments: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN role inheriting app_user's grants — what the adapter suites connect as.
      { name: "sumup_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
