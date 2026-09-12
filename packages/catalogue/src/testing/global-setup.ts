import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "../migrations.js";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/** Content-language privileges and concurrent authoring need independent PostgreSQL backends. */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "Catalogue content-language privilege and concurrency tests require real PostgreSQL.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
