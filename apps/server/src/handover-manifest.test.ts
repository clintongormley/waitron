import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { NODE_LOCAL_MANIFEST, type NodeLocalItem } from "@waitron/handover";
import { canonicalize } from "@waitron/membership";
import { isAppError } from "@waitron/shared";
import { resolveBackupConfig } from "./backup-config.js";
import { loadBoxEnv } from "./box-env.js";
import { buildNodeLocalManifest, readOfferSettings } from "./handover-manifest.js";
import { ALL_MODULES } from "./modules.js";

const CURRENT_KEY = randomBytes(32);
const PREVIOUS_KEY = randomBytes(32);

const TOGGLEABLE = ALL_MODULES.filter((m) => m.tier === "toggleable").map((m) => m.name);
const [MODULE_A, MODULE_B] = TOGGLEABLE;

function ringWithRotation(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: CURRENT_KEY.toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "3",
    WAITRON_CREDENTIALS_KEY_PREVIOUS: PREVIOUS_KEY.toString("base64"),
    WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2",
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function valuesDigest(values: Record<string, string | boolean>): string {
  return sha256(canonicalize(values));
}

function row(items: NodeLocalItem[], item: string): NodeLocalItem {
  const found = items.find((entry) => entry.item === item);
  if (found === undefined) throw new Error(`no manifest row for ${item}`);
  return found;
}

function containsBytes(value: unknown): boolean {
  if (value instanceof Uint8Array) return true;
  if (Array.isArray(value)) return value.some(containsBytes);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsBytes);
  }
  return false;
}

function expectedManifest(
  ringVersions: number[],
  digests: Record<"backup.env" | "modules.json", string | null>,
): NodeLocalItem[] {
  return NODE_LOCAL_MANIFEST.map((entry) => {
    if (entry.item === "secrets.env") return { ...entry, ringVersions };
    if (entry.item === "backup.env" || entry.item === "modules.json") {
      return { ...entry, sha256: digests[entry.item] };
    }
    if (entry.item === "module-preparation-state.json") return { ...entry, revisions: [] };
    return { ...entry };
  });
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

describe("buildNodeLocalManifest", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "handover-manifest-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("the manifest carries no secret", async () => {
    const ring = ringWithRotation();
    await writeFile(
      join(stateDir, "secrets.env"),
      `WAITRON_CREDENTIALS_KEY=${CURRENT_KEY.toString("base64")}\n`,
    );
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_BUCKET=b\n");
    await writeFile(join(stateDir, "modules.json"), '{"enabled":[]}');

    const items = await buildNodeLocalManifest(stateDir, ring);
    expect(items).toStrictEqual(
      expectedManifest([2, 3], {
        "backup.env": valuesDigest({ WAITRON_BACKUP_BUCKET: "b" }),
        "modules.json": null,
      }),
    );
    const texts = [...stringsIn(items), JSON.stringify(items)];

    expect(containsBytes(items)).toBe(false);
    for (const key of [ring.current.key, ring.previous!.key]) {
      for (const encoding of ["base64", "base64url", "hex", "latin1"] as const) {
        const encoded = key.toString(encoding);
        for (const text of texts) expect(text).not.toContain(encoded);
      }
      const asNumbers = JSON.stringify(key.toJSON().data).slice(1, -1);
      for (const text of texts) expect(text).not.toContain(asNumbers);
    }
  });

  it("lists only the current version when no rotation is under way", async () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: CURRENT_KEY.toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "5",
    });
    const items = await buildNodeLocalManifest(stateDir, ring);
    expect(row(items, "secrets.env").ringVersions).toEqual([5]);
  });

  it("a missing backup.env reads sha256: null", async () => {
    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(row(items, "backup.env").sha256).toBeNull();
    expect(row(items, "modules.json").sha256).toBeNull();
  });

  it("digests backup.env's values and modules.json's overrides, not their bytes", async () => {
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_BUCKET=venue\n");
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { [MODULE_A]: false } }),
    );

    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(row(items, "backup.env").sha256).toBe(valuesDigest({ WAITRON_BACKUP_BUCKET: "venue" }));
    expect(row(items, "modules.json").sha256).toBe(valuesDigest({ [MODULE_A]: false }));
  });

  describe("settings two boxes must hold alike", () => {
    let other: string;
    beforeEach(async () => {
      other = await mkdtemp(join(tmpdir(), "handover-manifest-other-"));
    });
    afterEach(async () => {
      await rm(other, { recursive: true, force: true });
    });

    async function digests(folder: string, item: string): Promise<string | null | undefined> {
      return row(await buildNodeLocalManifest(folder, ringWithRotation()), item).sha256;
    }

    it("the same backup settings in another order, spacing or with comments digest alike", async () => {
      await writeFile(join(stateDir, "backup.env"), "A=1\nB=x=y\n");
      await writeFile(join(other, "backup.env"), "# kept by hand\n\n  B=x=y\nA=1");
      const digest = await digests(stateDir, "backup.env");
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(await digests(other, "backup.env")).toBe(digest);
    });

    it("control: one different backup value, and one extra, each digest differently", async () => {
      await writeFile(join(stateDir, "backup.env"), "A=1\nB=2\n");
      await writeFile(join(other, "backup.env"), "A=1\nB=3\n");
      const digest = await digests(stateDir, "backup.env");
      expect(await digests(other, "backup.env")).not.toBe(digest);
      await writeFile(join(other, "backup.env"), "A=1\nB=2\nC=3\n");
      expect(await digests(other, "backup.env")).not.toBe(digest);
    });

    /** The backup settings this folder's box runs on, as a start reads them. */
    async function backupSettingsRead(folder: string): Promise<string> {
      const env = await loadBoxEnv({}, folder);
      return JSON.stringify(
        resolveBackupConfig({ managedByEnvironment: true, env, sealed: null, venueId: "venue" }),
      );
    }

    const SETTINGS = `WAITRON_BACKUP_DIR=/mnt/usb\nWAITRON_BACKUP_RECOVERY_KEY=${"k".repeat(40)}\n`;

    it.each([
      ["an empty file", ""],
      ["only blank lines", "\n  \n"],
      ["only comments", "# kept by hand\n\n"],
      ["only an empty value", "WAITRON_BACKUP_RETAIN=\n"],
      ["an empty value padded with spaces", "WAITRON_BACKUP_RETAIN=   \n"],
      ["a value emptied by a later line", "WAITRON_BACKUP_RETAIN=5\nWAITRON_BACKUP_RETAIN=\n"],
    ])("backup.env holding %s digests as no file, and the box reads it so", async (_name, text) => {
      await writeFile(join(stateDir, "backup.env"), text);
      expect(await digests(stateDir, "backup.env")).toBeNull();
      expect(await digests(other, "backup.env")).toBeNull();
      expect(await backupSettingsRead(stateDir)).toBe(await backupSettingsRead(other));
    });

    it("an empty value digests as no line, and the box reads it so", async () => {
      await writeFile(join(stateDir, "backup.env"), `${SETTINGS}WAITRON_BACKUP_RETAIN=\n`);
      await writeFile(join(other, "backup.env"), SETTINGS);
      const digest = await digests(other, "backup.env");
      expect(digest).toBe(
        valuesDigest({
          WAITRON_BACKUP_DIR: "/mnt/usb",
          WAITRON_BACKUP_RECOVERY_KEY: "k".repeat(40),
        }),
      );
      expect(await digests(stateDir, "backup.env")).toBe(digest);
      expect(await backupSettingsRead(stateDir)).toBe(await backupSettingsRead(other));
    });

    it("the last line of a repeated setting decides, whichever of them is empty", async () => {
      await writeFile(join(other, "backup.env"), "A=1\n");
      await writeFile(join(stateDir, "backup.env"), "A=\nA=1\n");
      expect(await digests(stateDir, "backup.env")).toBe(await digests(other, "backup.env"));

      await writeFile(join(stateDir, "backup.env"), "B=2\nA=1\nA=\n");
      await writeFile(join(other, "backup.env"), "B=2\n");
      expect(await digests(stateDir, "backup.env")).toBe(await digests(other, "backup.env"));
    });

    it("control: a value of two quote marks is a value, for the digest and for the box", async () => {
      await writeFile(join(stateDir, "backup.env"), `${SETTINGS}WAITRON_BACKUP_AT=""\n`);
      await writeFile(join(other, "backup.env"), SETTINGS);
      expect(await digests(stateDir, "backup.env")).not.toBe(await digests(other, "backup.env"));
      await expect(backupSettingsRead(stateDir)).rejects.toMatchObject({
        code: "backup.schedule_invalid",
      });
      expect(await backupSettingsRead(other)).toContain("/mnt/usb");
    });

    it("limit: an empty value that hides another file's setting digests as no line, though the box reads them differently", async () => {
      for (const folder of [stateDir, other]) {
        await writeFile(join(folder, "trading.env"), "WAITRON_BACKUP_RETAIN=5\n");
      }
      await writeFile(join(stateDir, "backup.env"), `${SETTINGS}WAITRON_BACKUP_RETAIN=\n`);
      await writeFile(join(other, "backup.env"), SETTINGS);
      expect(await digests(stateDir, "backup.env")).toBe(await digests(other, "backup.env"));
      expect(await backupSettingsRead(stateDir)).not.toBe(await backupSettingsRead(other));
    });

    it("the same module overrides in another order or spacing digest alike", async () => {
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { [MODULE_A]: false, [MODULE_B]: false } }),
      );
      await writeFile(
        join(other, "modules.json"),
        JSON.stringify({ modules: { [MODULE_B]: false, [MODULE_A]: false } }, null, 2),
      );
      const digest = await digests(stateDir, "modules.json");
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(await digests(other, "modules.json")).toBe(digest);
    });

    it("control: a different module switched off digests differently", async () => {
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { [MODULE_A]: false } }),
      );
      await writeFile(
        join(other, "modules.json"),
        JSON.stringify({ modules: { [MODULE_B]: false } }),
      );
      expect(await digests(other, "modules.json")).not.toBe(
        await digests(stateDir, "modules.json"),
      );
    });

    it.each([['{"modules":{}}'], ["{}"]])(
      "modules.json holding %s means no overrides, the same as no file",
      async (text) => {
        await writeFile(join(stateDir, "modules.json"), text);
        expect(await digests(stateDir, "modules.json")).toBeNull();
        expect(await digests(other, "modules.json")).toBeNull();
      },
    );

    it("a module named as switched on is the same module set as one not named", async () => {
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { [MODULE_A]: true, [MODULE_B]: false } }),
      );
      await writeFile(
        join(other, "modules.json"),
        JSON.stringify({ modules: { [MODULE_B]: false } }),
      );
      expect(await digests(stateDir, "modules.json")).toBe(await digests(other, "modules.json"));

      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { [MODULE_A]: true } }),
      );
      expect(await digests(stateDir, "modules.json")).toBeNull();
    });

    it("limit: on settings the environment owns both digests are null and nothing compares them", async () => {
      const name = "WAITRON_BACKUP_BUCKET";
      const before = process.env[name];
      process.env[name] = "this-box";
      try {
        expect(await digests(stateDir, "backup.env")).toBeNull();
        process.env[name] = "that-box";
        expect(await digests(other, "backup.env")).toBeNull();
      } finally {
        if (before === undefined) delete process.env[name];
        else process.env[name] = before;
      }
    });
  });

  it("a modules.json the box could not start on is refused, not digested", async () => {
    await writeFile(join(stateDir, "modules.json"), "{ not json");
    const error = await buildNodeLocalManifest(stateDir, ringWithRotation()).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("module.config_invalid");
  });

  it("carries this box's retained selections, in the order they were written", async () => {
    const binding = {
      module: "fiscal-verifactu",
      action: "promote",
      eventId: "e1",
      sourceId: "s1",
      targetNodeId: "node-1",
    };
    const revisions = [
      { binding, value: { selected: "AAAAA" } },
      { binding: { ...binding, eventId: "e0" }, value: null },
    ];
    await writeFile(
      join(stateDir, "module-preparation-state.json"),
      JSON.stringify({ version: 1, revisions }),
    );
    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(row(items, "module-preparation-state.json").revisions).toEqual(revisions);
  });

  it("carries no retained selections for a box without the file, and needs no copy to do so", async () => {
    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(row(items, "module-preparation-state.json").revisions).toEqual([]);
  });

  it("refuses a retained-selections file it cannot read, rather than signing none", async () => {
    await writeFile(join(stateDir, "module-preparation-state.json"), "{ not json");
    const error = await buildNodeLocalManifest(stateDir, ringWithRotation()).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("setup.attempt_invalid");
  });

  it("keeps every manifest row, in order, and adds values only to the four files it reads", async () => {
    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(items).toStrictEqual(
      expectedManifest([2, 3], { "backup.env": null, "modules.json": null }),
    );
  });

  it("refuses a state file it cannot read for a reason other than its absence", async () => {
    await rm(stateDir, { recursive: true, force: true });
    await writeFile(stateDir, "not a folder");
    await expect(buildNodeLocalManifest(stateDir, ringWithRotation())).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});

describe("readOfferSettings", () => {
  let stateDir: string;
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "handover-offer-settings-"));
  });
  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it.each(["handover.settings_unreadable", "handover.destination_settings_unreadable"] as const)(
    "a state folder that is gone refuses %s, rather than reading as a box with no settings",
    async (code) => {
      const gone = join(stateDir, "gone");
      await expect(readOfferSettings(gone, ringWithRotation(), code)).rejects.toMatchObject({
        code,
        params: { file: "backup.env" },
        reason: "the state folder cannot be read",
      });
    },
  );

  it("a file where the state folder should be refuses the same way", async () => {
    const notFolder = join(stateDir, "a-file");
    await writeFile(notFolder, "");
    await expect(
      readOfferSettings(notFolder, ringWithRotation(), "handover.settings_unreadable"),
    ).rejects.toMatchObject({ code: "handover.settings_unreadable" });
  });

  it("control: a folder holding none of the files is a box with no settings", async () => {
    expect(
      await readOfferSettings(stateDir, ringWithRotation(), "handover.settings_unreadable"),
    ).toEqual({ backupSettings: null, moduleSettings: null, ringVersions: [2, 3] });
  });
});
