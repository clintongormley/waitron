// Runs the entry point against a real migrated venue directory. Both handles `openVenueDatabase`
// returns are one type, `Database`, so passing the node handle where the venue one belongs
// compiles; the `set`/`list` round trip below is what holds the vault to the venue file.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, openVenueDatabase, runMigrations } from "@waitron/db";
import { runBin } from "./bin.js";
import type { CliIo } from "./cli.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { tenantCredentials } from "./schema/index.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const STRIPE_JSON = JSON.stringify({
  secretKey: "sk_test_bin",
  webhookSecret: "whsec_bin",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
});

interface Captured {
  io: CliIo;
  out: string[];
  err: string[];
}

function capture(stdin = ""): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      readStdin: () => Promise.resolve(stdin),
    },
  };
}

describe("waitron-credentials against a real venue directory", () => {
  let venueDir: string;

  beforeAll(async () => {
    venueDir = await mkdtemp(join(tmpdir(), "waitron-credentials-bin-"));
    // Migrated through the product's own opener, and closed again: the entry point under test
    // opens the same directory for itself, so anything left open here would be a second handle on
    // the same files rather than part of the subject.
    const store = await openVenueDatabase(venueDir);
    try {
      await runMigrations(store.venue, CORE_MIGRATIONS);
      await runMigrations(store.venue, CREDENTIALS_MIGRATIONS);
    } finally {
      await store.close();
    }
  }, 120_000);

  afterAll(async () => {
    if (venueDir !== undefined) await rm(venueDir, { recursive: true, force: true });
  });

  async function storedPurposes(): Promise<string[]> {
    const store = await openVenueDatabase(venueDir);
    try {
      const rows = await store.venue
        .select({ purpose: tenantCredentials.purpose })
        .from(tenantCredentials);
      return rows.map((r) => r.purpose).sort();
    } finally {
      await store.close();
    }
  }

  it("the directory starts with no credentials, so a row below can only come from the command", async () => {
    expect(await storedPurposes()).toEqual([]);
  });

  it("writes a credential into the directory WAITRON_VENUE_DIR names", async () => {
    const h = capture(STRIPE_JSON);
    const code = await runBin(
      ["set", "--purpose", "payments.stripe"],
      { ...KEY_ENV, WAITRON_VENUE_DIR: venueDir },
      h.io,
    );
    expect(code).toBe(0);
    expect(h.err).toEqual([]);
    expect(await storedPurposes()).toEqual(["payments.stripe"]);
  });

  it("reads that credential back on a second invocation, and never prints its value", async () => {
    const h = capture();
    const code = await runBin(["list"], { ...KEY_ENV, WAITRON_VENUE_DIR: venueDir }, h.io);
    expect(code).toBe(0);
    expect(h.out.join("\n")).toContain("payments.stripe");
    expect(h.out.join("\n")).not.toContain("sk_test_bin");
  });

  it("refuses with exit 2, naming the variable, when WAITRON_VENUE_DIR is unset", async () => {
    const h = capture();
    expect(await runBin(["list"], { ...KEY_ENV }, h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("WAITRON_VENUE_DIR");
    expect(h.out).toEqual([]);
  });

  it("refuses an EMPTY WAITRON_VENUE_DIR rather than resolving it to the working directory", async () => {
    const h = capture();
    expect(await runBin(["list"], { ...KEY_ENV, WAITRON_VENUE_DIR: "" }, h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("WAITRON_VENUE_DIR");
  });

  it("reports a broken key ring by its domain code, without opening the venue", async () => {
    const h = capture();
    const code = await runBin(["list"], { WAITRON_VENUE_DIR: venueDir }, h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("credentials.key_missing");
  });

  it("runs beside a server that holds the venue folder", async () => {
    const script = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => db, 1000);`;
    const holder = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, join(venueDir, "venue.lock")],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.on("data", (c: Buffer) => c.toString().includes("held") && resolve());
        holder.on("exit", (code) => reject(new Error(`holder exited early (${code})`)));
      });
      const h = capture();
      expect(await runBin(["list"], { ...KEY_ENV, WAITRON_VENUE_DIR: venueDir }, h.io)).toBe(0);
      expect(h.err).toEqual([]);
    } finally {
      holder.kill("SIGKILL");
    }
  }, 20_000);
});
