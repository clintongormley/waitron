import { node, clock } from "../test/hour-recovery-host.js";

import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";

import { recovery, interruptedRepair } from "../test/first-setup-backup-resume-fixture.js";

vi.mock("./state-secrets.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it.each([
  "inspectionId",
  "revision",
  "ownerGeneration",
  "recoveryId",
  "oldBoxGone",
  "soleRecovery",
] as const)("resume refuses stale or missing %s authority", async (field) => {
  const f = await interruptedRepair();
  const request = structuredClone(f.resumeRequest);
  if (field === "recoveryId") request.recoveryId = "fe663c93-c1e6-4688-a294-8e11502d53ef";
  else if (field === "oldBoxGone" || field === "soleRecovery") request.context[field] = false;
  else if (field === "inspectionId") request.observation.inspectionId = "a".repeat(64);
  else request.observation[field] = 42;
  const records = await f.workspace.read();
  await expect(recovery(f.options).resume(request, { onBox: false })).rejects.toMatchObject({
    code:
      field === "oldBoxGone" || field === "soleRecovery"
        ? "module.operation_invalid"
        : "setup.attempt_conflict",
  });
  expect(await f.workspace.read()).toEqual(records);
});

it.each(["private-material", "originals", "target-verifier", "dispose"] as const)(
  "resume rechecks %s after its outside-lock key derivation",
  async (change) => {
    const f = await interruptedRepair();
    const service = recovery(f.options);
    const original = f.host.resolution.withVenueExclusion;
    let turns = 0;
    let stopping: Promise<void> | undefined;
    f.host.resolution.withVenueExclusion = (run) =>
      original(async () => {
        if (++turns === 2) {
          if (change === "dispose") stopping = service.dispose();
          else if (change === "private-material")
            await unlink(
              join(dirname(dirname(f.record.target.target.stateDir)), "publication.json"),
            );
          else if (change === "originals")
            await writeFile(
              join(f.roots.stateDir, "another-attempt.txt"),
              "keep this original evidence",
            );
          else {
            const target = await openVenueDatabase(f.record.target.target.venueDir);
            try {
              await import("./break-glass.js").then((m) =>
                m.mintBreakGlassKey({ venue: target.venue, node: target.node }, node.nodeId),
              );
            } finally {
              await target.close();
            }
          }
        }
        return run();
      });
    await expect(service.resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject({
      code: change === "dispose" ? "setup.owner_required" : "setup.attempt_conflict",
    });
    await stopping;
    await expect(
      access(join(f.record.target.target.stateDir, "trading.env")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a resumed selection expires and a later proof cannot reuse its old opaque session", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const first = await service.resume(f.resumeRequest, { onBox: false });
  const second = await service.resume(f.resumeRequest, { onBox: false });
  await expect(
    service.commit(first.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  clock.advance(15 * 60_000 + 1);
  await expect(
    service.commit(second.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("a resumed session refuses changed private publication before any replay write", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const material = JSON.parse(await readFile(path, "utf8"));
  material.ciphertext = material.ciphertext.slice(0, -4) + "AAAA";
  await writeFile(path, JSON.stringify(material));
  await expect(
    service.commit(session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it.each(["missing", "symlink"] as const)(
  "resume refuses a %s target database before opening or selecting it",
  async (change) => {
    const f = await interruptedRepair();
    const path = join(f.record.target.target.venueDir, "venue.db");
    await import("node:fs/promises").then((fs) => fs.rename(path, path + ".retained"));
    if (change === "symlink")
      await import("node:fs/promises").then((fs) => fs.symlink(path + ".retained", path));
    const before = await readFile(path + ".retained");
    await expect(
      recovery(f.options).resume(f.resumeRequest, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path + ".retained")).toEqual(before);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
    if (change === "missing") await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a target key revoked after resume proof cannot rewrite evidence or publish secrets", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const target = f.record.target.target;
  const db = await openVenueDatabase(target.venueDir);
  try {
    await import("./break-glass.js").then((m) =>
      m.mintBreakGlassKey({ venue: db.venue, node: db.node }, node.nodeId),
    );
  } finally {
    await db.close();
  }
  const path = join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json");
  const bytes = Buffer.from(
    JSON.stringify({ reference: "unpublished incoming evidence", complete: true, records: [] }),
  );
  await writeFile(path, bytes);
  const refusal = await service
    .commit(session.sessionId, f.selected.input, { onBox: false })
    .catch((error) => error);
  expect(await readFile(path)).toEqual(bytes);
  expect(refusal).toMatchObject({ code: "setup.attempt_conflict" });
  await expect(access(join(target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
