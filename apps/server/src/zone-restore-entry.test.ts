import {
  archiveHost,
  bucketCommand,
  node,
  recordedRecoveryRows,
  recoveryInvoices,
  suite,
} from "../test/hour-recovery-host.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { invoiceSeries, locations, openVenueDatabase } from "@waitron/db";
import { nodeId } from "@waitron/shared";
import { restoreFromArtifact } from "./restore.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { runRestore } from "./restore-command.js";
import { writeStreamRestore } from "./restore-stream.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";

async function savedZone(timeZone: string) {
  await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, node.locationId));
}

it.each(["", "Not/A_Zone", "+02:00", "UTC"])(
  "retains the raw saved zone %j through real archive preview, preparation and placement",
  async (timeZone) => {
    await recoveryInvoices();
    await savedZone(timeZone);
    const preparing = archiveHost();
    await expect(preparing).resolves.toMatchObject({
      options: { selected: { fiscalSelection: { timeZone } } },
    });
    const f = await preparing;
    expect(f.options.selected.fiscalSelection).toEqual({
      country: "ES",
      fiscalTerritory: "ES-common",
      timeZone,
      module: "fiscal-verifactu",
    });
    const before = await recordedRecoveryRows(suite.db);
    const originalSeries = await suite.db.select().from(invoiceSeries);
    await restoreFromArtifact({
      ...f.restore,
      modules: f.service.modules,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      const [location] = await placed.venue
        .select()
        .from(locations)
        .where(eq(locations.id, node.locationId));
      expect(location!.timeZone).toBe(timeZone);
      expect(await recordedRecoveryRows(placed.venue)).toEqual(before);
      const after = await placed.venue.select().from(invoiceSeries);
      for (const row of originalSeries)
        expect(after.find((entry) => entry.id === row.id)).toEqual({
          ...row,
          retiredAt: expect.any(Date),
        });
      expect(
        after
          .filter((row) => row.retiredAt === null)
          .map(({ code, nextNumber }) => ({ code, nextNumber })),
      ).toEqual([
        { code: "A-06RC", nextNumber: 1 },
        { code: "FF-06RC", nextNumber: 1 },
        { code: "R-06RC", nextNumber: 1 },
      ]);
    } finally {
      await placed.close();
    }
  },
);

it("retains an invalid zone through signed-pointer bucket preview, preparation and the restore command", async () => {
  const before = await recoveryInvoices();
  await savedZone("Not/A_Zone");
  const preparing = bucketCommand();
  await expect(preparing).resolves.toMatchObject({
    f: { options: { selected: { fiscalSelection: { timeZone: "Not/A_Zone" } } } },
  });
  const entry = await preparing;
  const output: string[] = [];
  expect(
    await runRestore({ ...entry.deps, out: (line) => output.push(line) }),
    output.join("\n"),
  ).toBe(0);
  expect(entry.failures).toEqual([]);
  const placed = await openVenueDatabase(entry.f.roots.venueDir);
  try {
    const [location] = await placed.venue
      .select()
      .from(locations)
      .where(eq(locations.id, node.locationId));
    expect(location!.timeZone).toBe("Not/A_Zone");
    expect(await recordedRecoveryRows(placed.venue)).toEqual(before);
    expect(
      (await placed.venue.select().from(invoiceSeries))
        .filter((row) => row.retiredAt === null)
        .map(({ code, nextNumber }) => ({ code, nextNumber })),
    ).toEqual([
      { code: "A-06RD", nextNumber: 1 },
      { code: "FF-06RD", nextNumber: 1 },
      { code: "R-06RD", nextNumber: 1 },
    ]);
  } finally {
    await placed.close();
  }
});

it.each(["archive", "stream"] as const)(
  "a wrong %s node key still refuses before placement with an invalid zone",
  async (kind) => {
    await savedZone("Not/A_Zone");
    const f = await archiveHost(kind);
    const destination = join(f.roots.venueDir, "venue.db");
    await writeFile(destination, "original destination");
    const service = createSelectedRecoveryPreparation({ ...f.options, secret: "wrong node key" });
    await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    const restore = {
      ...f.restore,
      modules: service.modules,
      withModuleOperations: service.runner(f.outcome.input),
    };
    await expect(
      kind === "archive"
        ? restoreFromArtifact(restore)
        : writeStreamRestore({ ...restore, databasePath: f.database, entries: f.entries }),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(await readFile(destination, "utf8")).toBe("original destination");
  },
);

it("an artifact naming an unknown recovery node still refuses before placement", async () => {
  const f = await archiveHost();
  await savedZone("Not/A_Zone");
  await suite.db.archiveTo(f.database);
  const entries = f.entries.map((entry) =>
    entry.name === "secrets/trading.env"
      ? {
          ...entry,
          bytes: Buffer.from(
            `WAITRON_TILL_NODE_ID=00000000-0000-4000-8000-000000000099\nWAITRON_TILL_LOCATION_ID=${node.locationId}\n`,
          ),
        }
      : entry,
  );
  const restore = {
    ...f.restore,
    artifact: encryptArtifact(
      packArchive([...entries, { name: "db.dump", bytes: await readFile(f.database) }]),
      "archive password",
    ),
  };
  const destination = join(f.roots.venueDir, "venue.db");
  await writeFile(destination, "original destination");
  const selected = await previewRecoveryArchive(restore);
  expect(selected.nodeRecoveryKeyName).toBeNull();
  const targetNodeId = nodeId("00000000-0000-4000-8000-000000000099");
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected,
    binding: { ...f.options.binding, sourceId: selected.sourceId, targetNodeId },
    node: { ...node, nodeId: targetNodeId },
  });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(() => service.runner(f.outcome.input)).toThrowError(
    expect.objectContaining({ code: "module.operation_invalid" }),
  );
  expect(await readFile(destination, "utf8")).toBe("original destination");
});
