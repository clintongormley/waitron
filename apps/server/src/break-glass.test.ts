import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampDeployment, readBreakGlassVerifier, type Database } from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
} from "@waitron/db/testing/lifecycle.js";
import { type RealPostgres } from "@waitron/db/testing/postgres.js";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";

// Real Postgres, not PGlite (CLAUDE.md §4): mint WRITES the verifier on the owner connection while
// verify READS it as the non-superuser app pool — the owner-vs-app split PGlite's single superuser
// connection cannot model. A fresh CORE clone per test (each mint mutates the shared deployment
// singleton, and one case wants the verifier still unset), stamped so `setBreakGlassVerifierTx`'s
// UPDATE has the singleton row to hit.
let clone: RealPostgres;
let ownerDb: Database; // owner connection: mint's verifier write
let appDb: Database; // app_login → app_user: verify's verifier read

beforeEach(async () => {
  const handle = resolveSharedHandle(undefined);
  clone = await cloneTemplate(handle.uri, pickTemplate(handle, "core"), nextCloneName());
  ownerDb = await clone.connect();
  appDb = await clone.connectAs("app_login", "app_pw");
  await stampDeployment(ownerDb, "preproduction"); // create the id=1 singleton row for the UPDATE
});

afterEach(async () => {
  const app = appDb;
  const owner = ownerDb;
  const c = clone;
  appDb = undefined as unknown as Database;
  ownerDb = undefined as unknown as Database;
  clone = undefined as unknown as RealPostgres;
  if (app !== undefined) await app.close();
  if (owner !== undefined) await owner.close();
  if (c !== undefined) await c.stop();
});

describe("break-glass mint + verify", () => {
  it("mints a secret, stores only a verifier, and verifies it", async () => {
    const secret = await mintBreakGlassSecret(ownerDb);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, high-entropy
    const stored = await readBreakGlassVerifier(appDb);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret); // the raw secret is NEVER stored
    expect(stored!.startsWith("scrypt$")).toBe(true);
    expect(await verifyBreakGlass(appDb, secret)).toBe(true);
    expect(await verifyBreakGlass(appDb, "wrong")).toBe(false);
  });

  it("re-minting invalidates the previous secret", async () => {
    const first = await mintBreakGlassSecret(ownerDb);
    const second = await mintBreakGlassSecret(ownerDb);
    expect(await verifyBreakGlass(appDb, first)).toBe(false);
    expect(await verifyBreakGlass(appDb, second)).toBe(true);
  });

  it("verify returns false when no verifier is set", async () => {
    expect(await verifyBreakGlass(appDb, "anything")).toBe(false);
  });
});
