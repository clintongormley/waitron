import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // `out` is a SINGLE STRING. The published types render it `string | string[]`; the second arm
  // does not work. One config produces exactly one migration folder, which is precisely why this
  // package needs its own config rather than an entry in core's.
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob. drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list in `schema/index.ts` IS the
  // snapshot's table list. A glob would sweep up anything a schema file happened to re-export —
  // and, as packages/db's own drizzle.config.ts found first, a bare directory glob also picks up
  // a co-located `*.test.ts` and tries to `require()` it as schema source.
  schema: "./src/schema/index.ts",
  // Its own journal table. Sharing core's would make each package's `generate` see the other's
  // applied migrations as unknown and silently attempt to re-apply its own from zero.
  migrations: { table: "__drizzle_migrations_fiscal", schema: "public" },
});
