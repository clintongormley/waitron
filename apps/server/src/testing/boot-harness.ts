import { cp, mkdtemp } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Agent } from "undici";
import {
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Helpers shared by `boot.test.ts`, `boot.restore.test.ts` and `boot.setup-routes.test.ts`. Each of
 * those files mocks its own modules: `vi.mock` is hoisted per test file, so no mock lives here.
 */

// The venue's fiscal identity. Boot's trading branch requires it, so every trading boot carries
// these through `KEY_ENV`; `seedSharedVenue` seeds the tenant, location and node they name, which boot
// reads at startup.
export const TILL_ENV = {
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",

  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
// Resolves the fiscal slot to Veri*Factu: `ALL_MODULES` holds two fiscal-slot members, so the
// default-on set would refuse `module.fiscal_slot_ambiguous`. A test needing a different set overrides
// `WAITRON_STATE_DIR` after the `...KEY_ENV` spread.
export const TRADING_STATE_DIR = mkdtempSync(join(tmpdir(), "waitron-boot-trading-state-"));
writeFileSync(
  join(TRADING_STATE_DIR, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
export const KEY_ENV = {
  // Keeps the plain-HTTP landing listener (default port 80, privileged) out of every boot test.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: TRADING_STATE_DIR,
  // Required by `loadConfig` in production.
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  ...TILL_ENV,
};

/** Seeds the shared venue directory with the tenant, location and node `TILL_ENV` names. */
export async function seedSharedVenue(db: Database): Promise<void> {
  // A distinctive NIF (90M base) stays clear of every other seed generator.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90000000K", legalName: "Boot Till SL" });
  await db.insert(locations).values({
    id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Barra",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta en establecimiento",
  });
  // `startServer` reads `nodes.filing_module` at boot (`readFilingModule`) and cross-checks it
  // against the enabled fiscal module.
  await db.insert(nodes).values({
    id: TILL_ENV.WAITRON_TILL_NODE_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Boot Till",
    filingModule: "verifactu",
  });
}

/**
 * Builds in `into` the layout `scripts/copy-migrations.mjs` builds beside the bundle, for
 * `WAITRON_MIGRATIONS_DIR`: `boot.ts`'s default migrations root exists only there.
 */
export async function copyMigrationsRoot(into: string): Promise<void> {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(into, set.name), {
      recursive: true,
    });
  }
}

/**
 * A fresh, migrated venue directory and an open handle on it, for the provision tests:
 * `provisionVenue` stamps the `deployment` singleton and mints a venue, which would pollute the
 * shared directory every other test boots against.
 */
export async function freshVenue(): Promise<{ directory: string; store: VenueDatabase }> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-boot-provision-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  return { directory, store: await openVenueDatabase(directory) };
}

/**
 * Waits until `port` accepts a TCP connection. `startServer` resolves before its listener has bound,
 * and closing an unbound server rejects with `ERR_SERVER_NOT_RUNNING`.
 */
export async function awaitListening(port: number): Promise<void> {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (up) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`the listener never bound 127.0.0.1:${port} within the poll budget`);
}

/** A `fetch` init that trusts `ca` for an HTTPS dial against a self-signed leaf. */
export function httpsVia(ca: string | Buffer): {
  via: RequestInit & { dispatcher: Agent };
  close: () => Promise<void>;
} {
  const dispatcher = new Agent({ connect: { ca } });
  return {
    via: { dispatcher } as RequestInit & { dispatcher: Agent },
    close: () => dispatcher.close(),
  };
}

/** Polls `predicate` for its first defined result, or `undefined` once the budget is spent. */
export const POLL_TRIES = 200;
export const POLL_INTERVAL_MS = 50;

export async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}

/**
 * GETs a `/health` URL until it answers 200: `/health` answers 503 until each duty's first clean
 * pass (`health.ts`), which a slow runner can still be waiting on.
 */
export async function fetchHealthOk(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < POLL_TRIES; i += 1) {
    try {
      const r = await fetch(url, init);
      if (r.status === 200) return r;
      // An unconsumed body pins its connection, and across POLL_TRIES that would starve the pool.
      await r.body?.cancel();
    } catch (error) {
      // A connection error before the listener is up is the not-ready condition being polled for.
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `/health did not return 200 within the poll budget (${POLL_TRIES} x ${POLL_INTERVAL_MS}ms): ${url}${
      lastError === undefined ? "" : ` (last error: ${String(lastError)})`
    }`,
  );
}

export interface LogLine {
  event: string;
  [key: string]: unknown;
}

/**
 * `boot.ts` logs to `process.stdout.write` with no injection seam. Every chunk is still forwarded to
 * the real writer; `fn` sees the captured lines live as they arrive.
 */
export async function withCapturedStdout<T>(fn: (lines: string[]) => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    return await fn(lines);
  } finally {
    process.stdout.write = original;
  }
}

/**
 * Records `process.kill` calls instead of letting the setup branch's default `requestRestart`
 * SIGTERM this process.
 */
export async function withMockedKill<T>(
  fn: (kills: { pid: number; signal: string | number | undefined }[]) => Promise<T>,
): Promise<T> {
  const original = process.kill;
  const kills: { pid: number; signal: string | number | undefined }[] = [];
  process.kill = ((pid: number, signal?: string | number) => {
    kills.push({ pid, signal });
    return true;
  }) as typeof process.kill;
  try {
    return await fn(kills);
  } finally {
    process.kill = original;
  }
}

/** A valid ES-common venue body for `POST /setup-api/provision`, with plaintext admin secrets (the
 * endpoint hashes them). */
export function provisionVenueBody(taxId: string) {
  return {
    country: "ES",
    taxId,
    legalName: "Deli Test SL",
    taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
    location: {
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Administradora",
      pin: "1234",
      password: "dashPass123",
      email: "admin@waitron.dev",
    },
  };
}

/** Parses a `KEY=value` env file, splitting on the FIRST `=` so a value's own `=` survives. */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** The first captured line naming `event`, waiting for it to arrive rather than assuming it already
 * has — `lines` is being appended to concurrently by the loop running in the background. */
export async function waitForEvent(lines: readonly string[], event: string): Promise<LogLine> {
  const found = await poll(() => {
    for (const line of lines) {
      let parsed: LogLine | undefined;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue; // Not a JSON line — this logger only ever writes JSON, but don't assume it here.
      }
      if (parsed.event === event) return parsed;
    }
    return undefined;
  });
  if (found === undefined) {
    throw new Error(
      `expected a "${event}" log line within the wait window, saw: ${lines.join("\n")}`,
    );
  }
  return found;
}

/**
 * A minimal SMTP receiver on loopback: enough of the dialogue for one message per connection, and
 * every message's raw text kept in arrival order.
 */
export async function startFakeSmtp(): Promise<{
  port: number;
  messages: string[];
  close: () => Promise<void>;
}> {
  const messages: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let pending = "";
    let data: string | undefined;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf("\r\n"); end !== -1; end = pending.indexOf("\r\n")) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            messages.push(data);
            data = undefined;
            socket.write("250 queued\r\n");
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "DATA") {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The tenant, location, node and till `KEY_ENV`'s ids name, seeded into `db` the way
 * `seedSharedVenue` seeds the shared directory. */
export async function seedTradingVenue(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90000001R", legalName: "Route Wiring SL" });
  await db.insert(locations).values({
    id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Barra",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta en establecimiento",
  });
  await db.insert(nodes).values({
    id: TILL_ENV.WAITRON_TILL_NODE_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Route Wiring Till",
    filingModule: "verifactu",
  });
}
