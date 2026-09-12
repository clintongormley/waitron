import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { MEDIA_MIGRATIONS } from "../migrations.js";

export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "Image deletion concurrency and application-role privileges require real PostgreSQL.",
    templates: {
      media: (uri) =>
        runMigrationSets(uri, [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
