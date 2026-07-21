import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // The barrel file, not a directory glob. drizzle-kit's own glob is not
  // test-aware: `./src/schema/*.ts` (or a bare directory path, which it
  // expands via a plain `readdirSync`) picks up a co-located `*.test.ts` —
  // this package's convention from Task 6 onward — and `require()`s it as if
  // it were schema source, which fails outright because vitest is ESM-only
  // and refuses to load under drizzle-kit's CJS loader. Pointing at
  // `index.ts` instead resolves to exactly that one file (drizzle-kit's glob
  // returns a literal path unchanged when it already exists and is not a
  // directory), and that file only ever imports real schema modules.
  schema: "./src/schema/index.ts",
  // A single string. Drizzle's docs render this as `string | string[]`, which
  // is wrong — one config produces exactly one migration folder. That is why
  // each package needs its own drizzle.config.ts and its own journal table,
  // rather than one config emitting into several directories.
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_db", schema: "public" },
});
