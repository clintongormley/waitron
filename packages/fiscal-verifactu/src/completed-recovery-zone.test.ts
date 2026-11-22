import { loadRecoveryPackFonts } from "./recovery-pdf-node.js";
import { readSettings, BUSINESS_DAY_SETTINGS } from "@waitron/db";
import { sql } from "drizzle-orm";
import { renderRecoveryPack } from "@waitron/recovery-pack";
import { beforeEach, expect, it } from "vitest";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { withTransaction, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_RECOVERY_PACK_PAGE } from "./completed-recovery-document.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TAXPAYER_A.nodeId };
const nodeKey = {
  nodeId: node.nodeId,
  name: "2026-10-18 · TEST",
  secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
};
beforeEach(async () => {
  await seedTaxpayers(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await seedFixtureSif(suite.db, {
    nodeId: node.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "0CNNW",
  });
});

for (const locale of ["en", "es"] as const)
  it.each([
    ["", "12:00", "UTC"],
    ["Not/A_Zone", "12:00", "UTC"],
    [" Europe/Madrid", "12:00", "UTC"],
    ["Europe/Madrid ", "12:00", "UTC"],
    ["+02:00", "12:00", "UTC"],
    ["UTC", "12:00", "UTC"],
    ["Europe/Madrid", "14:00", "CEST"],
    ["America/New_York", locale === "en" ? "08:00" : "8:00", "GMT-4"],
  ])(
    `the %s saved zone keeps completed ${locale} recovery evidence readable without modifying history`,
    async (timeZone, time, zone) => {
      await suite.db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${timeZone}) where module = 'business_day'`,
      );
      const before = await suite.db.select().from(verifactuIdentities);
      const part = await withTransaction(suite.db, (tx) =>
        FISCAL_RECOVERY_PACK_PAGE(tx, node, {
          keyInForce: { nodeId: nodeKey.nodeId, name: nodeKey.name },
          newKey: { name: nodeKey.name, secret: nodeKey.secret },
          locale,
          createdAt: "2026-10-18T12:00:00.000Z",
          evidence: {},
        }),
      );
      const bytes = await renderRecoveryPack({
        locale,
        timeZone: "UTC",
        loadFonts: loadRecoveryPackFonts,
        cover: {
          legalName: "Waitron SL",
          taxId: "89890001K",
          venueName: "Local principal",
          madeAt: "2026-10-18T12:00:00.000Z",
          madeBy: null,
          number: 1,
        },
        parts: [{ kind: "server-key", state: "included", page: part.page }],
        file: {
          kind: "waitron-recovery-pack",
          version: 1,
          number: 1,
          madeAt: "2026-10-18T12:00:00.000Z",
          bucketCode: null,
          archiveCode: null,
          backupKey: null,
          serverKey: part.keyFile!,
          serverKeyName: nodeKey.name,
          serverKeyHeldBy: null,
        },
      });
      const task = getDocument({
        data: bytes.slice(),
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        useWasm: false,
      });
      try {
        const pdf = await task.promise;
        expect(pdf.numPages).toBe(2);
        const text = (await (await pdf.getPage(2)).getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ");
        expect(text).toContain(`${time} ${zone}`);
        expect(text).not.toContain("Not/A_Zone");
        const attachment = JSON.parse(
          Buffer.from((await pdf.getAttachmentContent("waitron-recovery-pack-v1.json"))!).toString(
            "utf8",
          ),
        );
        expect(attachment.serverKey).toEqual({
          kind: "waitron-recovery-document",
          version: 1,
          scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
          taxpayerName: "Waitron SL",
          venueName: "Local principal",
          createdAt: "2026-10-18T12:00:00.000Z",
          nodeKey,
        });
      } finally {
        await task.destroy();
      }
      expect(
        (await readSettings(suite.db, BUSINESS_DAY_SETTINGS).then(({ doc }) => [doc]))[0]!.timeZone,
      ).toBe(timeZone);
      expect(await suite.db.select().from(verifactuIdentities)).toEqual(before);
    },
  );
