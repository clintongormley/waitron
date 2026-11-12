// Runs the entry point against a real migrated venue directory. The node handle's type extends
// `Database`, so passing it where the venue handle belongs compiles; the round trip below is what
// holds the vault to the venue file.
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  runMigrations,
  withNodeTransaction,
  tenantCredentials,
} from "@waitron/db";
import { NODE_MIGRATIONS, nodeSigningKey } from "@waitron/node-db";
import { runBin } from "./bin.js";
import type { CliIo } from "./cli.js";
import { loadKeyRing } from "./keyring.js";
import { sealNodeSigningKeyTx } from "./node-signing-key.js";

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
      await runMigrations(store.node, NODE_MIGRATIONS);
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

  it("rotate re-seals the box's signing key in the directory's node.db", async () => {
    const node = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const store = await openVenueDatabase(venueDir, { exclusive: false });
    try {
      await withNodeTransaction(store.node, (tx) =>
        sealNodeSigningKeyTx(tx, loadKeyRing(KEY_ENV), node, "AAAA"),
      );
    } finally {
      await store.close();
    }
    const rotatedEnv = {
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: KEY_ENV.WAITRON_CREDENTIALS_KEY,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    };
    const h = capture();
    expect(await runBin(["rotate"], { ...rotatedEnv, WAITRON_VENUE_DIR: venueDir }, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    const after = await openVenueDatabase(venueDir, { exclusive: false });
    try {
      const rows = await after.node
        .select({ keyVersion: nodeSigningKey.keyVersion })
        .from(nodeSigningKey);
      expect(rows).toEqual([{ keyVersion: 2 }]);
    } finally {
      await after.close();
    }
  });

  it("rotate waits for another process's uncommitted pair link, then refuses and re-seals nothing", async () => {
    async function keyVersions(): Promise<unknown[]> {
      const store = await openVenueDatabase(venueDir, { exclusive: false });
      try {
        return [
          ...store.venue.all(sql`select key_version from tenant_credentials`),
          ...store.node.all(sql`select key_version from node_signing_key`),
        ];
      } finally {
        await store.close();
      }
    }
    const before = await keyVersions();
    expect(before).not.toEqual([]);
    // As the server's join does: node.db's write lock held with the link written, committed a
    // second later by the writer's own clock, since the command's wait for the lock blocks this
    // process.
    const script = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("begin immediate");
const at = new Date().toISOString();
db.prepare("insert into node_pair_link (node_id, role, state, peer_node_id, peer_public_key, store_url, venue_id, access_key_id, secret_ciphertext, secret_iv, secret_auth_tag, key_version, ring_version, created_at, updated_at) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'streams', 'pending', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'pub', 'https://spare.example:7443', 'venue-a', 'key', x'00', zeroblob(12), zeroblob(16), 1, 1, ?, ?)").run(at, at);
process.stdout.write("written");
setTimeout(() => { db.exec("commit"); db.close(); }, 1000);`;
    const writer = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, join(venueDir, "node.db")],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = new Promise<number | null>((resolve) => writer.on("exit", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        writer.stdout.on("data", (c: Buffer) => c.toString().includes("written") && resolve());
        writer.on("exit", (code) => reject(new Error(`writer exited early (${code})`)));
      });
      const h = capture();
      const ringEnv = {
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "3",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2",
      };
      expect(await runBin(["rotate"], { ...ringEnv, WAITRON_VENUE_DIR: venueDir }, h.io)).toBe(1);
      expect(h.err[0]).toBe('credentials.rotation_spare_joined {"role":"streams"}');
      expect(await exited).toBe(0);
      expect(await keyVersions()).toEqual(before);
    } finally {
      writer.kill("SIGKILL");
    }
  }, 20_000);
});
