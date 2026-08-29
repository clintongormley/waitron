import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readMirrorToken, sealMirrorToken } from "./mirror-token.js";

// Real Postgres, not PGlite: the seal runs on the OWNER connection and the read as `app_user`, and the
// vault's `tenant_credentials` is under FORCE ROW LEVEL SECURITY — a superuser (PGlite's only role)
// bypasses RLS, so it could not prove the app_user read actually resolves under `withTenant`. The
// cross-box negative is a property of AES-256-GCM authentication, not of the DB, but it is proven here
// on the same real-role path the seal/read take. CLAUDE.md §4.

// Two distinct box keys — the design's load-bearing fact is that a token sealed under one box's key is
// unopenable under another's. Ring A is the "mirror's own" key; ring B stands in for a DIFFERENT box.
const RING_A = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xa).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const RING_B = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xb).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useTemplateDb({ template: "manifest" });

let appDb: Database; // app_login → app_user: the boot-time read path

beforeAll(async () => {
  appDb = await suite.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
});

describe("mirror-token vault wrappers (real Postgres)", () => {
  it("round-trips: sealed owner-side, read back as app_user under the same ring", async () => {
    const tenantId = await seedTenant(suite.admin);
    const token = "peer-token-abc123";

    await sealMirrorToken(suite.admin, RING_A, tenantId, token);

    expect(await readMirrorToken(appDb, RING_A, tenantId)).toBe(token);
  });

  it("cannot be opened under a DIFFERENT box key → credentials.decrypt_failed (the cross-box fact)", async () => {
    // A token the primary handed over and the mirror sealed under RING_A cannot be unsealed with
    // RING_B: AES-256-GCM authentication fails, `open()` returns null, and the store raises
    // `credentials.decrypt_failed`. This is why the primary cannot pre-seal the token FOR the mirror
    // (design §3) — each box holds its own random `WAITRON_CREDENTIALS_KEY`.
    const tenantId = await seedTenant(suite.admin);
    await sealMirrorToken(suite.admin, RING_A, tenantId, "peer-token-xyz789");

    await expect(readMirrorToken(appDb, RING_B, tenantId)).rejects.toMatchObject({
      code: "credentials.decrypt_failed",
    });
  });
});
