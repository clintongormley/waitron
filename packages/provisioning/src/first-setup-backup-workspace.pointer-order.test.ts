import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import * as durable from "./durable-host-json.js";
import * as provision from "./index.js";

vi.mock("./durable-host-json.js", { spy: true });

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const firstId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const laterId = "5b0d6c1e-8a4f-4f59-9d43-2c7a1e0b9f11";

it("writes the state folder's pointer before the venue folder's, so a cut write can be retried", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-pointer-order-")));
  directories.push(root);
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(anchor)) await mkdir(path);
  await writeFile(join(anchor.stateDir, "first-setup.json"), "opaque malformed original");
  await writeFile(join(anchor.venueDir, "venue.db"), "unchanged database bytes");
  const store = provision.createFirstSetupBackupWorkspace(anchor);
  const input = async (recoveryId: string) => {
    const base = join(anchor.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
    return {
      target: {
        recoveryId,
        anchor,
        source: anchor,
        target: {
          venueDir: join(base, "target", "venue"),
          stateDir: join(base, "target", "state"),
        },
        generation: 1,
      },
      observation: {
        inspectionId: "a".repeat(64),
        revision: null,
        ownerGeneration: null,
        originalsDigest: await store.inspect(recoveryId),
      },
      sourceId: "b".repeat(64),
      activationSourceId: "c".repeat(64),
      binding: {
        module: "synthetic",
        action: "restore" as const,
        eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8",
        sourceId: "c".repeat(64),
        targetNodeId: "47d5be37-2011-4afc-bdc8-46b5cb238deb",
      },
      input: null,
      retainedEvidenceDigest: "d".repeat(64),
      phase: "prepared" as const,
    };
  };
  await store.append(await input(firstId));
  await store.abandon(firstId);
  await provision.emptyAbandonedBackupRecovery(anchor, firstId);
  const statePointer = join(
    anchor.stateDir,
    "first-setup-resolutions",
    "backup-recovery",
    "current.json",
  );
  const { writeDurableHostJson } = await vi.importActual<typeof durable>("./durable-host-json.js");
  let cuts = 0;
  vi.mocked(durable.writeDurableHostJson).mockImplementation(async (path, ...rest) => {
    if (path === statePointer && cuts++ === 0) throw new Error("cut write");
    return writeDurableHostJson(path, ...rest);
  });
  const next = await input(laterId);
  await expect(store.append(next)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(cuts).toBe(1);
  await expect(store.append(next)).resolves.toMatchObject({ sequence: 1, target: next.target });
  expect(await provision.resolveFirstSetupBackupWorkspace(anchor)).toEqual({
    kind: "repair",
    target: next.target,
  });
});
