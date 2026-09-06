import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import type { TrustedClock } from "@waitron/fiscal";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_SLOT, rejectResolveClient } from "./slot.js";

// `makeBackend` only CONSTRUCTS the backend (no connection is opened until a method runs).
const STUB_DB = {} as Database;
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("slot.test: anchor() is unused");
  },
  currentAnchor: () => null,
};

describe("FISCAL_SLOT", () => {
  it("builds a VerifactuBackend whose id is the slot's id", () => {
    const backend = FISCAL_SLOT.makeBackend({ db: STUB_DB, clock, environment: "preproduction" });
    expect(backend).toBeInstanceOf(VerifactuBackend);
    expect(backend.id).toBe(FISCAL_SLOT.id);
    expect(FISCAL_SLOT.id).toBe("verifactu");
  });

  it("never resolves an AEAT client on the sale path", async () => {
    await expect(rejectResolveClient()).rejects.toThrow(/never be called/);
  });
});

// The runtime submission seat: the host injects the vault ring, deployment identity and cadence, and
// the regime owns the transport it builds inside the pass. A pass with no due work builds no per-tenant
// transport (resolveClient is called lazily, only for tenants with work) and returns the empty result.
describe("FISCAL_SLOT.drain", () => {
  const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });

  it("returns the empty result when nothing is due", async () => {
    const result = await FISCAL_SLOT.drain(
      { db: pg.db, ring, environment: "preproduction", skipRetryMs: 300_000 },
      new Date(),
    );
    expect(result.batchesSent).toBe(0);
    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toBeNull();
  });
});
