import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import {
  collectSealedEntries,
  createSealedStateRefresher,
  readSealedStateRow,
  sealNodeState,
  unsealNodeState,
  type SealedStateDeps,
} from "./sealed-state.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const KEY = "recovery-key-one-strong";
const OTHER_KEY = "recovery-key-two-different";
const NODE_ID = "33333333-3333-4333-8333-333333333333";
const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-23T00:00:00.000Z",
  environment: "preproduction",
  modules: { core: 1 },
};
const REQUIRED = RECOVERY_FILES.map((rel) => `secrets/${rel}`);

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "sealed-state-"));
  for (const rel of RECOVERY_FILES) {
    await mkdir(join(stateDir, dirname(rel)), { recursive: true });
    await writeFile(join(stateDir, rel), `${rel}-contents`);
  }
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

const names = (entries: ArchiveEntry[]) => entries.map((e) => e.name);
const text = (entries: ArchiveEntry[], name: string) =>
  Buffer.from(entries.find((e) => e.name === name)!.bytes).toString("utf8");

/** The code an AppError carries, or the thrown value itself when nothing was a code. */
function codeThrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as { code?: unknown }).code ?? error;
  }
  return "nothing thrown";
}

const deps = (over: Partial<SealedStateDeps> = {}): SealedStateDeps => ({
  db: suite.db,
  nodeId: NODE_ID,
  stateDir,
  modules: ALL_MODULES,
  resolvers: {},
  environment: "preproduction",
  readRecoveryKey: async () => KEY,
  now: () => new Date("2026-09-23T10:00:00.000Z"),
  log: vi.fn(),
  ...over,
});

const row = () => withTransaction(suite.db, (tx) => readSealedStateRow(tx, NODE_ID));

describe("collectSealedEntries", () => {
  it("carries every archive entry except the database copy, in the archive's order", async () => {
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_RECOVERY_KEY=x\n");
    await writeFile(join(stateDir, "modules.json"), '{"modules":{}}\n');
    const entries = await collectSealedEntries({
      stateDir,
      modules: ALL_MODULES,
      resolvers: {},
      manifest: MANIFEST,
    });
    expect(names(entries)).toEqual([
      "manifest.json",
      ...REQUIRED,
      "secrets/backup.env",
      "secrets/modules.json",
    ]);
    expect(JSON.parse(text(entries, "manifest.json"))).toEqual(MANIFEST);
    expect(text(entries, "secrets/secrets.env")).toBe("secrets.env-contents");
  });
});

describe("sealNodeState / unsealNodeState", () => {
  const entries: ArchiveEntry[] = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(MANIFEST)) },
    { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_CREDENTIALS_KEY=abc\n") },
  ];

  it("gives back the same entries under the key it was sealed with", async () => {
    const opened = unsealNodeState(await sealNodeState(entries, KEY), KEY);
    expect(names(opened)).toEqual(names(entries));
    expect(text(opened, "secrets/secrets.env")).toBe("WAITRON_CREDENTIALS_KEY=abc\n");
  });

  it("opens nothing under a different recovery key", async () => {
    const sealed = await sealNodeState(entries, KEY);
    expect(codeThrownBy(() => unsealNodeState(sealed, OTHER_KEY))).toBe(
      "recovery.passphrase_invalid",
    );
  });

  it("opens nothing once a byte of the sealed row has changed", async () => {
    const sealed = Buffer.from(await sealNodeState(entries, KEY));
    sealed[sealed.length - 1] ^= 0xff;
    expect(codeThrownBy(() => unsealNodeState(sealed, KEY))).toBe("recovery.passphrase_invalid");
  });

  it("refuses bytes that are not a sealed row at all by the frame's own code", () => {
    expect(codeThrownBy(() => unsealNodeState(Buffer.from("not sealed"), KEY))).toBe(
      "backup.artifact_invalid",
    );
  });

  it("lets other work run while it derives the key", async () => {
    const order: string[] = [];
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        order.push("timer");
        resolve();
      }, 0),
    );
    // Promise.resolve so a synchronous seal, which returns only after the derivation, is ordered too.
    const sealing = Promise.resolve(sealNodeState(entries, KEY)).then(() => order.push("sealed"));
    await Promise.all([timer, sealing]);
    expect(order).toEqual(["timer", "sealed"]);
  });

  it("does not carry the plaintext in the sealed bytes", async () => {
    const sealed = Buffer.from(await sealNodeState(entries, KEY));
    expect(sealed.includes(Buffer.from("WAITRON_CREDENTIALS_KEY"))).toBe(false);
  });
});

describe("createSealedStateRefresher", () => {
  it("writes this node's row, which the key opens to the state files and a manifest read off the database", async () => {
    const log = vi.fn();
    expect(await createSealedStateRefresher(deps({ log })).refresh()).toBe("sealed");
    const entries = unsealNodeState((await row())!, KEY);
    expect(names(entries)).toEqual(["manifest.json", ...REQUIRED]);
    const manifest = JSON.parse(text(entries, "manifest.json")) as BackupManifest;
    expect(manifest.environment).toBe("preproduction");
    expect(manifest.createdAt).toBe("2026-09-23T10:00:00.000Z");
    // Read off the migrated database, not a fixture: core is applied, so its version is above 0.
    expect(manifest.modules.core).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith("info", "backup.sealed_state_refreshed", {
      entries: entries.length,
    });
  });

  it("replaces the row rather than adding one, and carries each file as it now reads", async () => {
    const refresher = createSealedStateRefresher(deps());
    await refresher.refresh();
    await writeFile(join(stateDir, "modules.json"), '{"modules":{"fiscal-none":false}}\n');
    await refresher.refresh();
    const count = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from node_sealed_state`,
    );
    expect(count.rows[0]!.n).toBe(1);
    expect(text(unsealNodeState((await row())!, KEY), "secrets/modules.json")).toBe(
      '{"modules":{"fiscal-none":false}}\n',
    );
  });

  it("writes nothing when the box has no recovery key", async () => {
    const log = vi.fn();
    const outcome = await createSealedStateRefresher(
      deps({ readRecoveryKey: async () => undefined, log }),
    ).refresh();
    expect(outcome).toBe("no_key");
    expect(await row()).toBeNull();
    expect(log).toHaveBeenCalledWith("info", "backup.sealed_state_skipped", {
      reason: "no_recovery_key",
    });
  });

  it("reports a missing state file by its code, never throws, and keeps the row it had", async () => {
    const log = vi.fn();
    const refresher = createSealedStateRefresher(deps({ log }));
    await refresher.refresh();
    await rm(join(stateDir, "secrets.env"));
    expect(await refresher.refresh()).toBe("failed");
    expect(log).toHaveBeenCalledWith("warn", "backup.sealed_state_failed", {
      errorCode: "recovery.state_incomplete",
    });
    // A failed refresh must not blank the row a rebuild would need.
    expect(text(unsealNodeState((await row())!, KEY), "secrets/secrets.env")).toBe(
      "secrets.env-contents",
    );
  });

  it("logs a system error's code beside its own, and never its message or path", async () => {
    const log = vi.fn();
    const refresher = createSealedStateRefresher(deps({ log }));
    // A directory where a state file should be: reading it fails with EISDIR, not ENOENT.
    await rm(join(stateDir, "secrets.env"));
    await mkdir(join(stateDir, "secrets.env"));
    expect(await refresher.refresh()).toBe("failed");
    expect(log).toHaveBeenCalledWith("warn", "backup.sealed_state_failed", {
      errorCode: "unknown",
      errno: "EISDIR",
    });
  });

  it("logs no errno for a thrown value whose code is not a system error's", async () => {
    const log = vi.fn();
    const leak = Object.assign(new Error("boom"), { code: `open ${stateDir}/secrets.env` });
    const refresher = createSealedStateRefresher(
      deps({
        log,
        readRecoveryKey: () => Promise.reject(leak),
      }),
    );
    expect(await refresher.refresh()).toBe("failed");
    expect(log).toHaveBeenCalledWith("warn", "backup.sealed_state_failed", {
      errorCode: "unknown",
    });
  });

  it("answers failed when the logger throws, and the next refresh still runs and seals", async () => {
    let calls = 0;
    const log = vi.fn(() => {
      calls += 1;
      if (calls <= 2) throw new Error("log sink down");
    });
    let reads = 0;
    const refresher = createSealedStateRefresher(
      deps({
        log,
        readRecoveryKey: async () => {
          reads += 1;
          return reads === 1 ? KEY : OTHER_KEY;
        },
      }),
    );
    expect(await refresher.refresh()).toBe("failed");
    expect(await refresher.refresh()).toBe("sealed");
    // The second refresh read the second key, so the row it left opens under that key alone.
    const sealedNow = await row();
    expect(codeThrownBy(() => unsealNodeState(sealedNow!, OTHER_KEY))).toBe("nothing thrown");
  });

  it("runs one refresh at a time, so a slow refresh cannot land after a newer one", async () => {
    // The first refresh reads the OLD key and is held there; the second reads the new one. Run side
    // by side, the second would finish first and the first would then overwrite it with a row only
    // the old key opens.
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    let reads = 0;
    const refresher = createSealedStateRefresher(
      deps({
        readRecoveryKey: async () => {
          reads += 1;
          if (reads === 1) {
            await firstHeld;
            return KEY;
          }
          return OTHER_KEY;
        },
      }),
    );
    const first = refresher.refresh();
    const second = refresher.refresh();
    // Give the second every chance to finish on its own; queued behind the first, it cannot.
    await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 3000))]);
    releaseFirst();
    await Promise.all([first, second]);
    const sealedNow = await row();
    expect(codeThrownBy(() => unsealNodeState(sealedNow!, OTHER_KEY))).toBe("nothing thrown");
  }, 20_000);
});
