import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import "./errors.js";

// Real Postgres, not PGlite: the whole point of this probe is to tell a SUPERUSER/BYPASSRLS role
// (for which FORCE ROW LEVEL SECURITY is inert, so `pg_dump` reads the fiscal tables) apart from a
// plain app_user member (for which FORCE RLS truncates the dump silently). PGlite's only role is a
// superuser, so it could not exhibit the app_user side of that contrast — it would be a false pass.
// CLAUDE.md §4. Needs `TESTCONTAINERS_RYUK_DISABLED=true`.
const suite = useTemplateDb({ template: "manifest" });

// app_login → app_user: a NOBYPASSRLS member, the role a naive backup connection would run as.
let appDb: Database;

beforeAll(async () => {
  appDb = await suite.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  // Guard the connectAs pool teardown: it throws if read before setup ran (CLAUDE.md §4).
  if (appDb !== undefined) await appDb.close();
});

describe("assertBackupCanReadFiscal (real Postgres — the two roles must DISAGREE)", () => {
  it("resolves for the container superuser (RLS is inert, so the dump is complete)", async () => {
    await expect(assertBackupCanReadFiscal(suite.admin)).resolves.toBeUndefined();
  });

  it("throws backup.role_rls_fenced for a non-bypassing app_user member", async () => {
    await expect(assertBackupCanReadFiscal(appDb)).rejects.toMatchObject({
      code: "backup.role_rls_fenced",
    });
  });
});
