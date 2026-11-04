import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { NODE_LOCAL_MANIFEST, type NodeLocalItem } from "@waitron/handover";
import { buildNodeLocalManifest } from "./handover-manifest.js";

const CURRENT_KEY = randomBytes(32);
const PREVIOUS_KEY = randomBytes(32);

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
        "backup.env": sha256("WAITRON_BACKUP_BUCKET=b\n"),
        "modules.json": sha256('{"enabled":[]}'),
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

  it("digests backup.env and modules.json as their bytes' SHA-256", async () => {
    const backup = "WAITRON_BACKUP_BUCKET=venue\n";
    const modules = '{"enabled":["payments"]}';
    await writeFile(join(stateDir, "backup.env"), backup);
    await writeFile(join(stateDir, "modules.json"), modules);

    const items = await buildNodeLocalManifest(stateDir, ringWithRotation());
    expect(row(items, "backup.env").sha256).toBe(sha256(backup));
    expect(row(items, "modules.json").sha256).toBe(sha256(modules));
  });

  it("a changed modules.json changes its digest", async () => {
    const ring = ringWithRotation();
    await writeFile(join(stateDir, "modules.json"), '{"enabled":["payments"]}');
    const before = row(await buildNodeLocalManifest(stateDir, ring), "modules.json").sha256;
    await writeFile(join(stateDir, "modules.json"), '{"enabled":["payments","bookings"]}');
    const after = row(await buildNodeLocalManifest(stateDir, ring), "modules.json").sha256;

    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });

  it("keeps every manifest row, in order, and adds values only to the three compared files", async () => {
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
