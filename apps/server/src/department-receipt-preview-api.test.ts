import { registerModulePermissions } from "@waitron/identity";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locations, printJobs, sales, tenantReceipts } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { contentLanguages } from "@waitron/catalogue";
import { departments, departmentReceipts, departmentSalePolicies } from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import {
  mountDepartmentReceiptDraftPreviewApi,
  type ReceiptPreviewResponse,
} from "./receipt-preview-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
let venue: Venue;
let departmentId: string;
const policy = { receiptPrintMode: "auto", printTradingName: true } as const;
afterEach(() =>
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]),
);
beforeEach(async () => {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
  venue = await setupVenue(suite.db);
  const [department] = await suite.db
    .select()
    .from(departments)
    .where(eq(departments.locationId, venue.cfg.locationId));
  departmentId = department!.id;
  await suite.db
    .update(departments)
    .set({ tradingName: "Deli counter" })
    .where(eq(departments.id, departmentId));
  await suite.db
    .update(departmentSalePolicies)
    .set(policy)
    .where(eq(departmentSalePolicies.departmentId, departmentId));
  await suite.db
    .update(locations)
    .set({ invoiceLocales: ["gl-ES"] })
    .where(eq(locations.id, venue.cfg.locationId));
  await suite.db
    .update(contentLanguages)
    .set({ defaultLanguage: "es", languages: ["es", "ca", "en"] });
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId, receipt: { footerMessage: { "eu-ES": "Hidden Basque" } } })
    .onConflictDoUpdate({
      target: departmentReceipts.departmentId,
      set: { receipt: { footerMessage: { "eu-ES": "Hidden Basque" } } },
    });
  await suite.db.insert(tenantReceipts).values({
    receipt: {
      headerSubtitle: "Global subtitle",
      footerMessage: "Global footer",
      phone: "910000000",
      email: "global@example.test",
      printAddress: true,
    },
  });
});
function ask(input: unknown, cookie = venue.managerCookie) {
  const app = new Hono();
  mountDepartmentReceiptDraftPreviewApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      validateOperationDescription: fiscal.validateOperationDescription,
    },
    () => {},
  );
  return app.request("/management-api/receipt-preview", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
function draft() {
  return { departmentId, receipt: { operationDescription: "Private tax description" }, policy };
}
async function drawn(input: unknown) {
  const response = await ask(input);
  expect(response.status).toBe(200);
  return (await response.json()) as ReceiptPreviewResponse;
}
function lines(answer: ReceiptPreviewResponse) {
  return answer.preview.blocks.flatMap((block) =>
    block.kind === "image" && block.text ? [block.text.trim()] : [],
  );
}
async function snapshot() {
  return {
    receipts: await suite.db.select().from(departmentReceipts),
    policies: await suite.db.select().from(departmentSalePolicies),
    defaults: await suite.db.select().from(tenantReceipts),
    sales: await suite.db.select().from(sales),
    jobs: await suite.db.select().from(printJobs),
  };
}

describe("replacement department receipt preview", () => {
  it("draws authored draft text and policy without printing descriptions or venue defaults", async () => {
    const before = await snapshot();
    const answer = await drawn({
      ...draft(),
      receipt: {
        ...draft().receipt,
        headerSubtitle: { "gl-ES": "Benvidos", "ca-ES": "Benvinguts" },
        footerMessage: { "eu-ES": "Hidden Basque", "ca-ES": "Gràcies" },
        printAddress: true,
      },
      policy: { receiptPrintMode: "on_request", printTradingName: false },
      language: "ca-ES",
    });
    const printed = lines(answer).join("\n");
    expect(printed).toContain("Benvinguts");
    expect(printed).toContain("Gràcies");
    expect(printed).toContain("Calle Mayor 1");
    expect(printed).toContain("Deli Test SL");
    for (const absent of [
      "Deli counter",
      "Global subtitle",
      "Global footer",
      "910000000",
      "global@example.test",
      "Private tax description",
      "Benvidos",
      "Hidden Basque",
    ])
      expect(printed).not.toContain(absent);
    expect(answer.marks.address).not.toBeNull();
    expect(answer.marks.headerSubtitle).not.toBeNull();
    expect(answer.marks.footerMessage).not.toBeNull();
    expect(await snapshot()).toEqual(before);
  });
  it("uses only requested or current department wording and absent address means off", async () => {
    const current = await drawn({
      ...draft(),
      receipt: {
        ...draft().receipt,
        headerSubtitle: { "gl-ES": "Current Galician", "es-ES": "Third Spanish" },
      },
      language: "ca-ES",
    });
    expect(lines(current)).toContain("Current Galician");
    expect(lines(current)).not.toContain("Third Spanish");
    expect(lines(current)).toContain("Deli counter");
    expect(current.marks.address).toBeNull();
    const omitted = await drawn({
      ...draft(),
      receipt: { ...draft().receipt, headerSubtitle: { "es-ES": "Third Spanish" } },
      language: "ca-ES",
    });
    expect(lines(omitted).join("\n")).not.toContain("Third Spanish");
    expect(lines(omitted).join("\n")).not.toContain("Global subtitle");
  });
  it.each(["58mm", "80mm"])(
    "draws an explicit %s without an installed printer",
    async (paperWidth) => {
      const answer = await drawn({ ...draft(), paperWidth });
      expect(answer.paperWidth).toBe(paperWidth);
      expect(answer.preview.columns).toBe(paperWidth === "58mm" ? 30 : 42);
      expect(answer.preview.truncated).toBe(false);
    },
  );
  it.each([null, "en-GB", "eu-ES"])(
    "refuses a language not offered for new edits (%j)",
    async (language) => {
      const response = await ask({ ...draft(), language });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "language" } },
      });
    },
  );
  it("refuses a changed hidden translation", async () => {
    const response = await ask({
      ...draft(),
      receipt: { ...draft().receipt, footerMessage: { "eu-ES": "Changed" } },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "receipt.invalid",
        params: { reason: "invalid_language", field: "footerMessage", language: "eu-ES" },
      },
    });
  });
  it("keeps passive preview activity from extending the session", async () => {
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = ${new Date(Date.now() - 300_000).toISOString()}`,
    );
    const seen = async () =>
      (
        await suite.db.execute<{ seen: string }>(
          sql`select last_seen_at as seen from management_sessions order by id`,
        )
      ).rows;
    const before = await seen();
    expect((await ask({ ...draft(), passive: true })).status).toBe(200);
    expect(await seen()).toEqual(before);
    expect((await ask(draft())).status).toBe(200);
    expect(await seen()).not.toEqual(before);
  });
  it("refuses a null department and a legacy settings payload", async () => {
    for (const input of [
      { ...draft(), departmentId: null },
      { ...draft(), settings: {} },
    ]) {
      const response = await ask(input);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid" },
      });
    }
  });
  it("refuses a deleted department without persisting or printing", async () => {
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, departmentId));
    const before = await snapshot();
    const response = await ask(draft());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "department.not_found", params: { departmentId } },
    });
    expect(await snapshot()).toEqual(before);
  });
  it("refuses missing session and staff before malformed draft validation", async () => {
    const empty = await ask(null, "");
    expect(empty.status).toBe(401);
    expect(await empty.json()).toEqual({
      error: { code: "management_session.required", params: {} },
    });
    const staff = await ask(null, venue.staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "layout.configure" } },
    });
  });
});
