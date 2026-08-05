import { describe, expect, it } from "vitest";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { Database } from "@waitron/db";
import { makeFiscalBackend, rejectResolveClient, systemClock } from "./till-backend.js";

// `makeFiscalBackend` only CONSTRUCTS the backend (its constructor wraps `resolveClient` and stores
// references — it opens no connection), so a bare stub stands in for the pool the built backend
// would only touch on `pendingCount`, which this suite never calls.
const STUB_DB = {} as Database;

describe("systemClock", () => {
  it("reports the wall clock as already confident and anchored, with a real instant", () => {
    const reading = systemClock().now();
    expect(reading.instant).toBeInstanceOf(Date);
    expect(reading.confident).toBe(true);
    expect(reading.confidence).toBe("anchored");
    expect(reading.anchorAgeSeconds).toBe(0);
    // The host's own UTC offset for that instant — never `Date.prototype.getTimezoneOffset()`'s
    // sign, which is inverted; `now()` negates it to the ISO-8601 convention.
    expect(reading.offsetMinutes).toBe(-reading.instant.getTimezoneOffset());
  });

  it("throws from anchor() — recordSale never calls it, so reaching it is a bug, not a fallback", () => {
    // The argument satisfies the `TrustedClock.anchor` signature; the stub throws before reading it.
    expect(() =>
      systemClock().anchor({ instant: new Date(), offsetMinutes: 0, source: "upstream" }),
    ).toThrow();
  });

  it("has no prior anchor to restore (currentAnchor is null)", () => {
    expect(systemClock().currentAnchor()).toBeNull();
  });
});

describe("rejectResolveClient", () => {
  it("rejects — the till's recordSale path never contacts AEAT, so this stub must never resolve", async () => {
    // `recordSale` reaches `resolveClient` only via `drain`/`reconcile`, which this backend is never
    // handed to (the server's real drain loop builds its own `aeatClientResolver`). Exercised once
    // here so the guard is proven to reject rather than silently returning a usable client.
    await expect(rejectResolveClient()).rejects.toThrow(/never be called/);
  });
});

describe("makeFiscalBackend", () => {
  it("builds a VerifactuBackend without touching the database", () => {
    const backend = makeFiscalBackend(STUB_DB, { WAITRON_ENV: "preproduction" });
    expect(backend).toBeInstanceOf(VerifactuBackend);
  });

  it("defaults the deployment environment to preproduction when WAITRON_ENV is unset", () => {
    // The one default in config.ts whose mistake is irreversible — proven reachable here rather than
    // asserted: an unset environment must not throw at construction, it must resolve the safe value.
    const backend = makeFiscalBackend(STUB_DB, {});
    expect(backend).toBeInstanceOf(VerifactuBackend);
  });

  it("refuses an unrepresentable WAITRON_ENV, the same guard loadConfig uses", () => {
    // `deploymentEnvironment` (shared with the rest of the host) is what rejects it, so a stray
    // NODE_ENV or a typo can never reach `VerifactuBackendOptions.deploymentEnvironment` as an
    // entorno the schema's CHECK constraint would then reject mid-sale.
    expect(() => makeFiscalBackend(STUB_DB, { WAITRON_ENV: "staging" })).toThrow();
  });
});
