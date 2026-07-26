import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { runCli, type CliDeps } from "./cli.js";
import { loadKeyRing, type KeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "../test/seed.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// `previous` carries the SAME key material as `RING`'s `current` above, at the version every row
// written through the default `harness()` is stamped with — so a credential `set` under `RING` is
// genuinely re-sealable, not already on `ROTATED_RING`'s current version.
const ROTATED_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
  WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
});

const STRIPE_JSON = JSON.stringify({
  secretKey: "sk_test_cli",
  webhookSecret: "whsec_cli",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
});

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
});

afterAll(async () => {
  await db.close();
});

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
}

function harness(stdin = "", files: Record<string, string> = {}, ring: KeyRing = RING): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      db,
      ring,
      io: {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
        readStdin: () => Promise.resolve(stdin),
      },
      readFile: (path) => {
        const content = files[path];
        if (content === undefined) return Promise.reject(new Error(`no such file: ${path}`));
        return Promise.resolve(content);
      },
    },
  };
}

describe("waitron-credentials set", () => {
  it("provisions a credential from stdin", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).toBe(0);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("provisions from --file", async () => {
    const tenantId = await seedTenant(db);
    const h = harness("", { "/creds.json": STRIPE_JSON });
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", "--file", "/creds.json"],
      h.deps,
    );
    expect(code).toBe(0);
  });

  it("NEVER accepts the payload as an argument", async () => {
    // The rule this test exists for: argv is world-readable in `ps` and lands in shell history. If
    // a --value flag is ever added and silently tolerated (`strict: false`), this must go red.
    //
    // Two things matter about how this is written, both load-bearing:
    //
    // - stdin carries a VALID payload — deliberately, not empty. With an empty stdin, an ignored
    //   `--value` would still fail downstream on "payload is not valid JSON", passing this test
    //   for the wrong reason even if `--value` were silently accepted.
    // - `--value=<json>` uses `=` rather than two argv entries. node:util's `parseArgs` treats an
    //   UNRECOGNIZED `--flag value` (two tokens) as the boolean flag `--flag` followed by a stray
    //   POSITIONAL, which `allowPositionals: false` rejects independently of `strict` — so that
    //   form passes this test even under `strict: false`, for the wrong reason again (verified
    //   directly against node:util). `--value=<json>` binds the value to the flag regardless of
    //   whether the flag is known, so `strict: true` is the ONLY thing standing between this and
    //   an accepted secret. That is what makes this test airtight.
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", `--value=${STRIPE_JSON}`],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("rejects an unknown purpose and names the legal ones", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(["set", "--tenant", tenantId, "--purpose", "nope"], h.deps);
    expect(code).not.toBe(0);
    // Asserts the CODE itself, not just that the message happens to mention a known purpose:
    // `USAGE` also lists every purpose, so a mutation that collapsed this whole branch to
    // `deps.io.stderr(USAGE); return 2;` would still pass a test that checked only for
    // "payments.stripe" in stderr. `credentials.unknown_purpose` is the one string that proves
    // this specific structured code — not USAGE — is what actually fired.
    expect(h.err.join("\n")).toContain("credentials.unknown_purpose");
    expect(h.err.join("\n")).toContain("payments.stripe");
  });

  it("rejects a malformed --tenant instead of throwing out of runCli", async () => {
    // `brandTenantId` throws a plain `AppError("shared.invalid_id")` on any non-UUID string, and
    // `runCli` promises to resolve with an exit code for an ordinary operator mistake, never
    // reject. Written as a plain `await`, not `.rejects`, so this itself fails loudly (an unhandled
    // rejection) if that contract is ever broken again.
    const h = harness(STRIPE_JSON);
    const code = await runCli(
      ["set", "--tenant", "not-a-uuid", "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain("shared.invalid_id");
  });

  it("rejects a missing --tenant with usage, not a UUID-format error", async () => {
    // Distinguishes "the flag was never given" (USAGE, exit 2) from "the flag was given but was
    // not a UUID" (a `shared.invalid_id` AppError, exit 1 via reportFailure) — a plain
    // `code !== 0` check cannot tell these apart, since BOTH are non-zero. This is the test that
    // must go red if `typeof tenant !== "string" ||` is ever dropped from the guard: with no
    // --tenant, `tenant` is `undefined`, which validates as neither a legal UUID (skipping past
    // the missing-check would route it into the invalid-UUID path, exit 1) nor legal usage.
    const h = harness(STRIPE_JSON);
    const code = await runCli(["set", "--purpose", "payments.stripe"], h.deps);
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("usage:");
  });

  it("rejects an unreadable --file path instead of throwing", async () => {
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", "--file", "/missing.json"],
      h.deps,
    );
    expect(code).not.toBe(0);
    // The PARAMS by value, not just the code: swapping the two ternary arms that build them is an
    // easy, operator-facing bug, and a bare `toContain(code)` stays green through it — the
    // operator would be told the failure came from stdin while `--file` sat in the same message.
    // `keyring.test.ts` already closed exactly this gap for `key_ring_incomplete`.
    expect(h.err.join("\n")).toContain(
      'credentials.payload_unreadable {"source":"file","path":"/missing.json"}',
    );
  });

  it("rejects a failed stdin read instead of throwing", async () => {
    // Simulates what bin.ts's TTY guard does — readStdin rejecting — without needing a real
    // process or terminal. Proves cli.ts's own wrapping (not just bin.ts's) is what stands between
    // this and an uncaught rejection.
    const tenantId = await seedTenant(db);
    const h = harness();
    h.deps.io.readStdin = () => Promise.reject(new Error("stdin is a TTY"));
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain(
      'credentials.payload_unreadable {"source":"stdin","path":null}',
    );
  });

  it("rejects a purpose inherited from Object.prototype, not one it actually knows", async () => {
    // Pins `isPurpose`'s hasOwnProperty check, not `purpose in PURPOSES`: every plain object
    // inherits `toString`, so `"toString" in PURPOSES` is true even though it names no purpose
    // this package provisions. If the guard is ever loosened to `in`, this must go red.
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(["set", "--tenant", tenantId, "--purpose", "toString"], h.deps);
    expect(code).not.toBe(0);
  });

  it("rejects a payload with a typo'd field", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(JSON.stringify({ secret_key: "x" }));
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("rejects malformed JSON without echoing what it read", async () => {
    const tenantId = await seedTenant(db);
    const h = harness("{not json, sk_live_LEAK");
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect([...h.out, ...h.err].join("\n")).not.toContain("sk_live_LEAK");
  });

  // One test per operand of `set`'s three-part shape guard, each asserting the EXACT exit code.
  // `not.toBe(0)` is not enough here: dropping `typeof parsed !== "object"` still rejects a bare
  // scalar, just via `validatePayload` with exit 1 instead of the guard with exit 2, so a
  // non-zero assertion stays green while the operand it is meant to pin is gone. The same guard in
  // `store.ts` already has one test per operand; this is that standard carried into the CLI.
  it("rejects valid JSON that is not an object (an array)", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(JSON.stringify(["sk_live_LEAK"]));
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).toBe(2);
    expect([...h.out, ...h.err].join("\n")).not.toContain("sk_live_LEAK");
  });

  it("rejects valid JSON that is null", async () => {
    // `typeof null === "object"`, so this reaches the guard only via its own `parsed === null`
    // operand. Without it, `null` flows to `validatePayload` and `Object.keys(null)` throws a
    // TypeError — a non-AppError that `reportFailure` rethrows, so `runCli` REJECTS instead of
    // returning an exit code, breaking the contract its own doc comment states. Reachable from a
    // `jq` filter that matched nothing, or a template rendering an unset variable.
    const tenantId = await seedTenant(db);
    const h = harness("null");
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).toBe(2);
  });

  it("rejects valid JSON that is a bare scalar", async () => {
    const tenantId = await seedTenant(db);
    const h = harness("5");
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).toBe(2);
  });

  it("rejects a missing --purpose", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(["set", "--tenant", tenantId], h.deps);
    expect(code).not.toBe(0);
  });

  it("rejects an unrecognized flag rather than silently ignoring it", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", "--bogus", "x"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("propagates an unexpected, non-AppError failure rather than swallowing it", async () => {
    // A syntactically valid but never-seeded tenant: `withTenant`'s own RLS check passes (the
    // inserted row's tenant_id matches the session's app.tenant_id), so what fails is the foreign
    // key against `tenants` — a raw database error, not one of this package's `AppError`s.
    // `reportFailure` deliberately does not swallow that: an unrecognised failure should crash
    // loudly rather than be reported as an ordinary, expected rejection.
    const neverSeeded = "00000000-0000-0000-0000-000000000000";
    const h = harness(STRIPE_JSON);
    await expect(
      runCli(["set", "--tenant", neverSeeded, "--purpose", "payments.stripe"], h.deps),
    ).rejects.toBeTruthy();
  });
});

describe("waitron-credentials list", () => {
  it("prints metadata and never a value", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    const code = await runCli(["list", "--tenant", tenantId], h.deps);
    expect(code).toBe(0);
    const printed = h.out.join("\n");
    expect(printed).toContain("payments.stripe");
    expect(printed).not.toContain("sk_test_cli");
    expect(printed).not.toContain("whsec_cli");
  });

  it("enumerates across tenants when --tenant is omitted", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    const code = await runCli(["list"], h.deps);
    expect(code).toBe(0);
    const printed = h.out.join("\n");
    expect(printed).toContain(tenantId);
    expect(printed).toContain("payments.stripe");
    expect(printed).not.toContain("sk_test_cli");
  });

  it("rejects a malformed --tenant instead of throwing out of runCli", async () => {
    const h = harness();
    const code = await runCli(["list", "--tenant", "not-a-uuid"], h.deps);
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain("shared.invalid_id");
  });

  it("rejects an unrecognized flag rather than silently ignoring it", async () => {
    const h = harness();
    const code = await runCli(["list", "--bogus", "x"], h.deps);
    expect(code).not.toBe(0);
  });
});

describe("waitron-credentials delete", () => {
  it("removes a provisioned credential", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    expect(
      await runCli(["delete", "--tenant", tenantId, "--purpose", "payments.stripe"], h.deps),
    ).toBe(0);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("reports a non-zero code when there was nothing to delete", async () => {
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(
      ["delete", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("rejects a missing --purpose", async () => {
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(["delete", "--tenant", tenantId], h.deps);
    expect(code).not.toBe(0);
  });

  it("rejects a missing --tenant with usage, not a UUID-format error", async () => {
    // Same reasoning as `set`'s equivalent test: distinguishes "the flag was never given" (USAGE,
    // exit 2) from "the flag was given but was not a UUID" (exit 1 via reportFailure) — a plain
    // `code !== 0` check cannot tell these apart. Must go red if `typeof tenant !== "string" ||`
    // is ever dropped from cli.ts's combined guard here.
    const h = harness();
    const code = await runCli(["delete", "--purpose", "payments.stripe"], h.deps);
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("usage:");
  });

  it("rejects an unknown purpose with usage, not a not-found reply", async () => {
    // Guards `!isPurpose(purpose)` in cli.ts's combined check: an unknown purpose and a
    // known-but-never-provisioned purpose both end up with `deleteCredential` finding no matching
    // row, so both currently return a non-zero code — 2/USAGE for the former, 1/"no such
    // credential" for the latter. A plain `code !== 0` check cannot tell them apart; asserting the
    // exact code and USAGE text is what makes this mutation-checkable.
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(["delete", "--tenant", tenantId, "--purpose", "nope"], h.deps);
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("usage:");
  });

  it("rejects a malformed --tenant instead of throwing out of runCli", async () => {
    const h = harness();
    const code = await runCli(
      ["delete", "--tenant", "not-a-uuid", "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain("shared.invalid_id");
  });

  it("rejects an unrecognized flag rather than silently ignoring it", async () => {
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(
      ["delete", "--tenant", tenantId, "--purpose", "payments.stripe", "--bogus", "x"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });
});

describe("waitron-credentials rotate", () => {
  it("reports what it did and never a value", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    // ROTATED_RING, not the default RING: with the single-key RING every other test in this file
    // uses, the row just written is ALREADY on the ring's current version, so rotateCredentials
    // finds nothing to decrypt and reports `rotated 0` — a run in which no plaintext ever existed
    // to leak. Verified directly: tightening the regex below to
    // /^rotated 0, already current \d+$/m against the single-key RING PASSES, meaning the old
    // version of this test would have passed identically against a stub that always returned
    // `{rotated: 0, alreadyCurrent: 0}`. ROTATED_RING's `previous` matches RING's own key material,
    // so the row genuinely gets read, decrypted and re-sealed.
    const h = harness("", {}, ROTATED_RING);
    const code = await runCli(["rotate"], h.deps);
    expect(code).toBe(0);
    const printed = [...h.out, ...h.err].join("\n");
    const match = /^rotated (\d+), already current (\d+)$/m.exec(printed);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1);
    expect(printed).not.toContain("sk_test_cli");
  });

  it("rejects rather than crashes when rows still need a key the ring no longer carries", async () => {
    // The single likeliest operator mistake: running `rotate` after `WAITRON_CREDENTIALS_KEY_PREVIOUS`
    // was already dropped, while rows are still stamped with that retired version. Same
    // fail-fast, resolve-don't-reject contract every other command in this file gets from
    // `reportFailure` — `rotate` did not have it until this test was added.
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const noPrevious = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
    });
    const h = harness("", {}, noPrevious);
    const code = await runCli(["rotate"], h.deps);
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain("credentials.key_version_unknown");
  });
});

describe("there is deliberately no `get` command", () => {
  it("refuses to print a decrypted credential", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    const code = await runCli(
      ["get", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect(h.out.join("\n")).not.toContain("sk_test_cli");
  });
});

describe("unknown commands", () => {
  it("exits non-zero with usage", async () => {
    const h = harness();
    expect(await runCli(["wat"], h.deps)).not.toBe(0);
    expect(h.err.join("\n")).toContain("set");
  });

  it("exits non-zero with no command at all", async () => {
    const h = harness();
    expect(await runCli([], h.deps)).not.toBe(0);
  });
});
