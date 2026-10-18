import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { deployment, invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_RECOVERY_DOCUMENT } from "./completed-recovery-document.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { locationId } from "@waitron/shared";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((m) => ["core", "fiscal-verifactu"].includes(m.name)),
    null,
  ),
});
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const nodeKey = {
  nodeId: node.nodeId,
  name: "2026-10-18 · TEST",
  secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
};
const row = {
  reference: "earlier-setup",
  kind: "intent",
  taxpayerNif: "89890001K",
  environment: "preproduction",
  softwareId: "W2",
  nodeId: node.nodeId,
  identity: "06RD",
  recordedAtMs: Date.parse("2026-10-16T13:00:00Z"),
};
beforeEach(async () => {
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  for (const [nodeId, code] of [
    [node.nodeId, "06RB"],
    [TENANT_A.nodeId2, "06RC"],
  ] as const) {
    await seedFixtureSif(suite.db, {
      nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: code,
    });
    await suite.db.insert(invoiceSeries).values(
      [
        { code: `A-${code}`, purpose: "standard" as const },
        { code: `FF-${code}`, purpose: "full" as const },
        { code: `R-${code}`, purpose: "rectificative" as const },
      ].map((value) => ({ ...value, nodeId, nextNumber: 123 })),
    );
  }
  await suite.db
    .update(registroSif)
    .set({ revocadoEn: new Date("2026-10-16T12:30:00Z") })
    .where(eq(registroSif.nodeId, TENANT_A.nodeId2));
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: new Date("2026-10-16T12:30:00Z") })
    .where(eq(invoiceSeries.nodeId, TENANT_A.nodeId2));
});
async function snapshot() {
  return {
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
    chains: await suite.db.select().from(cadenas),
    allocations: await suite.db.select().from(fiscalAllocations),
  };
}
async function render(
  locale: "en" | "es",
  evidence: Record<string, unknown> = {
    "hour-history": { reference: "prepared-hours", complete: true, records: [row] },
  },
) {
  return withTransaction(suite.db, (tx) =>
    FISCAL_RECOVERY_DOCUMENT(tx, node, {
      nodeKey,
      createdAt: "2026-10-18T12:00:00.000Z",
      locale,
      evidence,
    }),
  );
}
it.each(["en", "es"] as const)(
  "the composed %s document includes current, retired and retained codes without allocating or changing counters",
  async (locale) => {
    const before = await snapshot();
    const bytes = await render(locale);
    const task = getDocument({
      data: bytes.slice(),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
    });
    try {
      const pdf = await task.promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      expect(text).toContain(
        locale === "en"
          ? "Installation codes: 06RB, 06RC, 06RD"
          : "Códigos de instalación: 06RB, 06RC, 06RD",
      );
      const attachment = JSON.parse(
        Buffer.from((await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!).toString(
          "utf8",
        ),
      );
      expect(attachment).toEqual({
        kind: "waitron-recovery-document",
        version: 1,
        scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
        taxpayerName: "Waitron SL",
        venueName: "Local principal",
        createdAt: "2026-10-18T12:00:00.000Z",
        installationCodes: ["06RB", "06RC", "06RD"],
        nodeKey,
      });
      expect(text).not.toContain(nodeKey.secret);
    } finally {
      await task.destroy();
    }
    expect(await snapshot()).toEqual(before);
  },
);

it.each([
  { "hour-history": { reference: "prepared-hours", complete: false, records: [] } },
  {
    "hour-history": {
      reference: "prepared-hours",
      complete: true,
      records: [{ ...row, identity: "wrong" }],
    },
  },
  { "hour-history": null },
])("refuses damaged history without changing fiscal state: %j", async (evidence) => {
  const before = await snapshot();
  await expect(render("en", evidence)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
  expect(await snapshot()).toEqual(before);
});
it("a missing environment stamp refuses before rendering a recovery sheet", async () => {
  await suite.db.delete(deployment);
  await expect(render("en")).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
});
it("unrelated taxpayer and target-environment codes are excluded, while duplicate known codes are printed once", async () => {
  const bytes = await render("en", {
    "hour-history": {
      reference: "prepared-hours",
      complete: true,
      records: [
        row,
        { ...row, reference: "duplicate" },
        { ...row, reference: "other-taxpayer", taxpayerNif: "B12345674", identity: "ZZZZ" },
        { ...row, reference: "other-environment", environment: "production", identity: "ZZZY" },
      ],
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
    const attached = JSON.parse(
      Buffer.from((await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!).toString(
        "utf8",
      ),
    );
    expect(attached.installationCodes).toEqual(["06RB", "06RC", "06RD"]);
  } finally {
    await task.destroy();
  }
});
