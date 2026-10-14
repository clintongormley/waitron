import { createHash } from "node:crypto";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withEmergencyAttempt } from "./emergency-attempt.js";

let directory: string;
let path: string;
const consumption = {
  version: 1,
  binding: {
    eventId: "outside-event",
    sourceId: "selected-backup-digest",
    targetNodeId: "replacement",
  },
  allocation: {
    installationIdentity: "E00000000000000000000000000",
    source: "emergency",
    issuedAt: "2026-10-14T19:00:00.000Z",
    series: [{ code: "A-E00000000000000000000000000", purpose: "standard" }],
    reservationEvidence: { checksum: "ABC" },
  },
  approval: { incidentEvidence: "outside/current-event" },
  knownIdentities: null,
  uncertaintyRecorded: true,
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "emergency-handover-"));
  path = join(directory, "event.json");
  await writeFile(path, JSON.stringify({ ...consumption, attempts: [] }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await rm(directory, { recursive: true, force: true });
});
async function handover() {
  return readFile(`${path}.txt`, "utf8");
}
async function expectCurrentRecord() {
  const json = await readFile(path, "utf8");
  const text = await handover();
  expect(text).toContain(createHash("sha256").update(json).digest("hex"));
  expect(text).toContain(JSON.stringify(JSON.parse(json), null, 2));
  expect(text).toContain("Emergency recovery / Recuperación de emergencia");
  expect(text).toContain("Keep this record outside the box and its backups.");
  expect(text).toContain("Guarda este registro fuera del equipo y sus copias de seguridad.");
  expect(text).toContain("Check the local activation separately from this attempt result.");
  expect(text).toContain("Comprueba la activación local aparte del resultado de este intento.");
  expect((await stat(`${path}.txt`)).mode & 0o777).toBe(0o600);
}
it("retains the generated record in readable form before entering activation, then updates its outcome", async () => {
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      await expectCurrentRecord();
      expect(await handover()).toContain('"outcome": "started"');
      expect(await handover()).toContain('"finishedAt": null');
      return "activated";
    }),
  ).resolves.toBe("activated");
  await expectCurrentRecord();
  expect(await handover()).toContain('"outcome": "returned"');
  expect((await readdir(directory)).sort()).toEqual(["event.json", "event.json.txt"]);
});
it("presents a thrown result without copying an exception message or describing it as rollback", async () => {
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      throw new Error("synthetic-secret-not-for-handover");
    }),
  ).rejects.toThrow("synthetic-secret-not-for-handover");
  await expectCurrentRecord();
  expect(await handover()).toContain('"outcome": "threw"');
  expect(await handover()).not.toContain("synthetic-secret-not-for-handover");
});
it("reports unavailable outside recording when the restore and its result write both fail", async () => {
  const secretMessage = "synthetic-private-restore-error";
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      await mkdir(`${path}.next`);
      throw new Error(secretMessage);
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  const retained = await readFile(path, "utf8");
  expect(JSON.parse(retained).attempts).toMatchObject([{ outcome: "started", finishedAt: null }]);
  expect(retained).not.toContain(secretMessage);
  expect(await handover()).not.toContain(secretMessage);
});
it("refuses activation when the readable record cannot be published, retaining consumed history", async () => {
  await mkdir(`${path}.txt`);
  let entered = false;
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      entered = true;
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(entered).toBe(false);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    ...consumption,
    attempts: [{ outcome: "started" }],
  });
  expect((await readdir(directory)).sort()).toEqual(["event.json", "event.json.txt"]);
});
it("refuses success when the final readable outcome cannot be published after activation returned", async () => {
  let entered = false;
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      entered = true;
      await rm(`${path}.txt`, { force: true });
      await mkdir(`${path}.txt`);
      return "local-commit";
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(entered).toBe(true);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    attempts: [{ outcome: "returned" }],
  });
});
it("preserves earlier attempts and refreshes the printable record on confirmed replay", async () => {
  await withEmergencyAttempt(directory, path, consumption, async () => "first");
  const first = JSON.parse(await readFile(path, "utf8"));
  await withEmergencyAttempt(directory, path, consumption, async () => "replay");
  await expectCurrentRecord();
  const final = JSON.parse(await readFile(path, "utf8"));
  expect(final.attempts).toHaveLength(2);
  expect(final.attempts[0]).toEqual(first.attempts[0]);
  expect(await handover()).toContain(
    JSON.stringify(first.attempts[0], null, 2).split("\n")[1]!.trim(),
  );
});

it("keeps a foreign printable staging file and refuses activation instead of overwriting it", async () => {
  await writeFile(`${path}.txt.next`, "foreign-writer");
  let entered = false;
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => {
      entered = true;
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(entered).toBe(false);
  expect(await readFile(`${path}.txt.next`, "utf8")).toBe("foreign-writer");
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    ...consumption,
    attempts: [{ outcome: "started" }],
  });
});
it("leaves the older readable copy recognisably stale if a later publication fails", async () => {
  await withEmergencyAttempt(directory, path, consumption, async () => "first");
  const before = await handover();
  await writeFile(`${path}.txt.next`, "interrupted-writer");
  await expect(
    withEmergencyAttempt(directory, path, consumption, async () => "must-not-activate"),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  const json = await readFile(path, "utf8");
  expect(await handover()).toBe(before);
  expect(before).not.toContain(createHash("sha256").update(json).digest("hex"));
  expect(JSON.parse(json).attempts).toHaveLength(2);
  expect(JSON.parse(json).attempts[1].outcome).toBe("started");
});

it.each(["write", "sync"] as const)(
  "refuses activation on a readable-record %s failure and cleans only its own staging file",
  async (failure) => {
    const realOpen = nativeFs.open;
    vi.spyOn(nativeFs, "open").mockImplementation(
      async (...args: Parameters<typeof nativeFs.open>) => {
        const handle = await realOpen(...args);
        if (args[0] === `${path}.txt.next`) {
          if (failure === "write")
            vi.spyOn(handle, "writeFile").mockRejectedValueOnce(
              new Error("injected handover write refusal"),
            );
          else
            vi.spyOn(handle, "sync").mockRejectedValueOnce(
              new Error("injected handover sync refusal"),
            );
        }
        return handle;
      },
    );
    syncBuiltinESMExports();
    let entered = false;
    await expect(
      withEmergencyAttempt(directory, path, consumption, async () => {
        entered = true;
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(entered).toBe(false);
    expect((await readdir(directory)).sort()).toEqual(["event.json"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      ...consumption,
      attempts: [{ outcome: "started" }],
    });
  },
);
