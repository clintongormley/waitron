import { registerModulePermissions } from "@waitron/identity";
import { contentLanguages } from "@waitron/catalogue";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { locations, sales, printJobs, tenantReceipts } from "@waitron/db";
import { departments, departmentReceipts } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { withTransaction } from "@waitron/db";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { mountReceiptPreviewApi, type ReceiptPreviewResponse } from "./receipt-preview-api.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let venue: Venue;
let departmentId: string;
beforeEach(async () => {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
  venue = await setupVenue(suite.db);
  await suite.db
    .update(contentLanguages)
    .set({ defaultLanguage: "es", languages: ["es", "ca", "gl", "eu"] });
  [{ id: departmentId }] = await suite.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.locationId, venue.cfg.locationId));
});
function ask(body: unknown, cookie = venue.managerCookie) {
  const app = new Hono();
  mountReceiptPreviewApi(app, { db: suite.db, cfg: venue.cfg }, () => {});
  return app.request("/management-api/receipt-preview", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const policy = { receiptPrintMode: "auto", printTradingName: true } as const;
const draft = () => ({ departmentId, receipt: {}, policy });
async function drawn(body: unknown) {
  const response = await ask(body);
  expect(response.status).toBe(200);
  return (await response.json()) as ReceiptPreviewResponse;
}
function lines(answer: ReceiptPreviewResponse) {
  return answer.preview.blocks.flatMap((block) =>
    block.kind === "image" && block.text ? [block.text.trim()] : [],
  );
}

describe("POST receipt draft preview", () => {
  it("composes unsaved translated department text before the issuer, with independent language", async () => {
    const answer = await drawn({
      ...draft(),
      receipt: {
        headerSubtitle: { "es-ES": "Bar español", "ca-ES": "Bar català" },
        footerMessage: { "es-ES": "Gracias", "ca-ES": "Gràcies" },
        phone: "+34912345678",
      },
      policy,

      language: "ca-ES",
    });
    const printed = lines(answer);
    const issuer = printed.indexOf("Deli Test SL");
    expect(issuer).toBeGreaterThan(0);
    expect(printed[issuer + 1]).toMatch(/^NIF: /u);
    expect(printed.indexOf("Bar català")).toBeLessThan(issuer);
    expect(printed).toContain("Gràcies");
    expect(printed).not.toContain("Bar español");
    expect(printed).not.toContain("Venue subtitle");
    expect(printed).not.toContain("Calle Mayor 1");
    expect(answer.marks.headerSubtitle).not.toBeNull();
    expect(answer.marks.footerMessage).not.toBeNull();
    expect(answer.marks.address).toBeNull();
    const saved = await suite.db
      .select()
      .from(locations)
      .where(eq(locations.id, venue.cfg.locationId));
    expect(saved[0]!.invoiceLocales).toEqual(["es-ES"]);
  });
  it("falls back to the current department language, then nothing, never a third map entry", async () => {
    const current = await drawn({
      ...draft(),
      receipt: { headerSubtitle: { "es-ES": "Current", "gl-ES": "Third" } },
      language: "ca-ES",
    });
    expect(lines(current)).toContain("Current");
    const inherited = await drawn({
      ...draft(),
      receipt: { headerSubtitle: { "gl-ES": "Third" } },
      language: "ca-ES",
    });
    expect(lines(inherited)).not.toContain("Venue");
    expect(lines(inherited)).not.toContain("Third");
    const omitted = await drawn({
      ...draft(),
      receipt: { headerSubtitle: { "es-ES": "Current", "ca-ES": "Other" } },
    });
    expect(lines(omitted)).toContain("Current");
  });
  it("renders an explicitly picked live department", async () => {
    await suite.db
      .update(departments)
      .set({ tradingName: "Closed counter" })
      .where(eq(departments.id, departmentId));
    const answer = await drawn({
      ...draft(),
      receipt: { headerSubtitle: { "es-ES": "Closed draft" } },
    });
    expect(lines(answer)).toContain("Closed counter");
    expect(lines(answer)).toContain("Closed draft");
  });
  it("refuses an explicitly picked deleted department without persisting drafts", async () => {
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, departmentId));
    const snapshot = async () => ({
      departments: await suite.db.select().from(departments),
      receipts: await suite.db.select().from(departmentReceipts),
      defaults: await suite.db.select().from(tenantReceipts),
      sales: await suite.db.select().from(sales),
      jobs: await suite.db.select().from(printJobs),
    });
    const before = await snapshot();
    const response = await ask({
      ...draft(),
      receipt: { headerSubtitle: { "es-ES": "Closed draft" } },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({
      code: "department.not_found",
      params: { departmentId },
    });
    expect(await snapshot()).toEqual(before);
  });
  it("refuses null department drafts without reading stored department or global decoration", async () => {
    await suite.db
      .insert(departmentReceipts)
      .values({ departmentId, receipt: { headerSubtitle: { "es-ES": "Stored department" } } });
    await suite.db.insert(tenantReceipts).values({
      receipt: {
        phone: "910000000",
        email: "venue@example.test",
        headerSubtitle: "Saved venue text",
      },
    });
    const before = {
      own: await suite.db.select().from(departmentReceipts),
      global: await suite.db.select().from(tenantReceipts),
    };
    const response = await ask({
      departmentId: null,
      receipt: { headerSubtitle: { "es-ES": "Unsaved venue" }, printAddress: true },
      policy,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "departmentId" } },
    });
    expect({
      own: await suite.db.select().from(departmentReceipts),
      global: await suite.db.select().from(tenantReceipts),
    }).toEqual(before);
  });
  it("department previews never inherit current venue contacts or text", async () => {
    await suite.db.insert(tenantReceipts).values({
      receipt: {
        phone: "910000000",
        email: "venue@example.test",
        headerSubtitle: "Saved venue text",
      },
    });
    const picked = await drawn(draft());
    expect(lines(picked).join("\n")).not.toContain("910000000");
    expect(lines(picked).join("\n")).not.toContain("venue@example.test");
    expect(lines(picked)).not.toContain("Saved venue text");
  });

  it("does not persist the draft, a sale or a print job", async () => {
    const snapshot = async () => ({
      receipt: await suite.db.select().from(departmentReceipts),
      defaults: await suite.db.select().from(tenantReceipts),
      sales: await suite.db.select().from(sales),
      jobs: await suite.db.select().from(printJobs),
    });
    const before = await snapshot();
    await drawn({
      ...draft(),
      receipt: { footerMessage: { "es-ES": "Draft" } },
    });
    expect(await snapshot()).toEqual(before);
  });
  it.each(["58mm", "80mm"])(
    "draws an explicit %s without needing an installed printer",
    async (paperWidth) => {
      const answer = await drawn({ ...draft(), paperWidth });
      expect(answer.paperWidth).toBe(paperWidth);
      expect(answer.preview.columns).toBe(paperWidth === "58mm" ? 30 : 42);
      expect(answer.preview.truncated).toBe(false);
    },
  );
  it.each([
    ["", 401, "management_session.required"],
    ["staff", 403, "authorization.not_permitted"],
  ])("refuses cookie %s before draft validation", async (cookie, status, code) => {
    const response = await ask(
      { ...draft(), receipt: { headerSubtitle: 5 } },
      cookie === "staff" ? venue.staffCookie : cookie,
    );
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });
  it("refuses unknown and other-location departments with the same code", async () => {
    for (const id of [randomUUID(), departmentId]) {
      if (id === departmentId) {
        const [location] = await suite.db
          .insert(locations)
          .values({
            name: "Other",
            fiscalTerritory: "ES-common",
            invoiceLocales: ["es-ES"],
            operationDescription: "Other",
          })
          .returning();
        await suite.db
          .update(departments)
          .set({ locationId: location!.id })
          .where(eq(departments.id, id));
      }
      const response = await ask({ ...draft(), departmentId: id });
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("department.not_found");
    }
  });
  it.each([
    [{}, "management.request_invalid"],
    [null, "management.request_invalid"],
    [() => ({ ...draft(), departmentId: "wrong" }), "shared.invalid_id"],
    [
      () => ({ ...draft(), departmentId: null, receipt: { phone: "+34912345678" } }),
      "management.request_invalid",
    ],
    [() => ({ ...draft(), receipt: { phone: [] } }), "receipt.invalid"],
    [() => ({ ...draft(), receipt: { printAddress: null } }), "receipt.invalid"],
    [() => ({ ...draft(), language: null }), "management.request_invalid"],
    [() => ({ ...draft(), language: "xx" }), "management.request_invalid"],
    [() => ({ ...draft(), paperWidth: null }), "management.request_invalid"],
    [() => ({ ...draft(), extra: true }), "management.request_invalid"],
  ])("refuses malformed draft %#", async (body, code) => {
    const response = await ask(typeof body === "function" ? body() : body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
  });
  it("rejects disallowed map languages and oversized text", async () => {
    for (const receipt of [
      { headerSubtitle: { xx: "Bad" } },
      { headerSubtitle: { "es-ES": "x".repeat(201) } },
    ]) {
      const response = await ask({ ...draft(), receipt });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("receipt.invalid");
    }
  });
  it("uses department-owned saved logos and clearing never inherits venue defaults", async () => {
    const image = await samplePreparedImage({ width: 40, height: 12 });
    const { image: stored } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image, names: { es: "Preview logo" } }),
    );
    const own = {
      widthDots: 16,
      heightDots: 2,
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
    };
    const global = { widthDots: 8, heightDots: 1, data: Buffer.from([255]).toString("base64") };
    await suite.db.insert(departmentReceipts).values({
      departmentId,
      receipt: { logo: stored.filename },
      logoRasters: { "58mm": own, "80mm": own },
    });
    await suite.db.insert(tenantReceipts).values({
      receipt: { logo: stored.filename, logoRasters: { "58mm": global, "80mm": global } },
    });
    const ownPreview = await drawn({
      ...draft(),
      receipt: { logo: stored.filename },
    });
    const ownMark = ownPreview.marks.logo!;
    expect(ownPreview.preview.blocks[ownMark.start + 1]).toMatchObject({
      kind: "image",
      width: 16,
      height: 2,
    });
    const cleared = await drawn(draft());
    expect(cleared.marks.logo).toBeNull();
    expect(
      cleared.preview.blocks.some(
        (block) => block.kind === "image" && block.width === 8 && block.height === 1,
      ),
    ).toBe(false);
  });
  it("draws an unsaved library logo without saving rasters and omits missing or corrupt images", async () => {
    const image = await samplePreparedImage({ width: 40, height: 12 });
    const { image: stored } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image, names: { es: "Draft logo" } }),
    );
    const before = await suite.db.select().from(departmentReceipts);
    const answer = await drawn({ ...draft(), receipt: { logo: stored.filename } });
    expect(answer.marks.logo).not.toBeNull();
    expect(answer.preview.blocks[answer.marks.logo!.start + 1]).toMatchObject({
      kind: "image",
      width: 504,
      height: 151,
    });
    expect(await suite.db.select().from(departmentReceipts)).toEqual(before);
    await suite.db.execute(
      sql`update media_image_data set bytes = ${Buffer.from([1, 2, 3])} where image_id = ${stored.id}`,
    );
    expect((await drawn({ ...draft(), receipt: { logo: stored.filename } })).marks.logo).toBeNull();
    expect(
      (await drawn({ ...draft(), receipt: { logo: "ab".repeat(32) + ".png" } })).marks.logo,
    ).toBeNull();
  });
  it("refuses empty and malformed raw JSON bodies", async () => {
    for (const body of ["", "{", "null", "[]"]) {
      const app = new Hono();
      mountReceiptPreviewApi(app, { db: suite.db, cfg: venue.cfg }, () => {});
      const response = await app.request("/management-api/receipt-preview", {
        method: "POST",
        headers: { cookie: venue.managerCookie },
        body,
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("management.request_invalid");
    }
  });

  it("bounds a chunked JSON body even without content-length", async () => {
    const app = new Hono();
    mountReceiptPreviewApi(app, { db: suite.db, cfg: venue.cfg }, () => {});
    const request = new Request("http://localhost/management-api/receipt-preview", {
      method: "POST",
      headers: { cookie: venue.managerCookie },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(draft())));
          for (let i = 0; i < 20; i++)
            controller.enqueue(new TextEncoder().encode(" ".repeat(4096)));
          controller.close();
        },
      }),
      // @ts-expect-error Node's streaming request requires duplex.
      duplex: "half",
    });
    const response = await app.request(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("management.request_invalid");
  });
});

it("authenticates passive previews without extending the session while explicit previews extend it", async () => {
  const before = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await suite.db.execute(sql`update management_sessions set last_seen_at = ${before}`);
  const seen = async () =>
    (
      await suite.db.execute<{ seen: string }>(
        sql`select last_seen_at as seen from management_sessions order by id`,
      )
    ).rows.map((row) => row.seen);
  const original = await seen();
  const automatic = await ask({ ...draft(), passive: true });
  expect(automatic.status).toBe(200);
  expect(await seen()).toEqual(original);
  const explicit = await ask(draft());
  expect(explicit.status).toBe(200);
  expect(await seen()).not.toEqual(original);
});

it.each([null, "true", 1, []])("refuses a non-boolean passive preview flag %#", async (passive) => {
  const response = await ask({ ...draft(), passive });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({
    code: "management.request_invalid",
    params: { field: "passive" },
  });
});

it("keeps department contacts in the draft and never replaces them with stored venue contacts", async () => {
  const contact = { phone: "+34 912 345 678", email: "venue@example.com" };
  await suite.db.insert(tenantReceipts).values({ receipt: contact });
  const answer = await drawn({
    ...draft(),
    receipt: {
      headerSubtitle: { "es-ES": "Department draft" },
      footerMessage: { "es-ES": "Thanks" },
      phone: "+34 911 000 000",
      email: "own@deli.test",
      printAddress: false,
    },
  });
  const phone = lines(answer).indexOf("Tel. +34 911 000 000");
  expect(phone).not.toBe(-1);
  expect(lines(answer).slice(phone, phone + 2)).toEqual(["Tel. +34 911 000 000", "own@deli.test"]);
  expect(lines(answer).join("\n")).not.toContain("venue@example.com");
  expect(lines(answer)).toContain("Department draft");
  expect(lines(answer)).toContain("Thanks");
  expect(answer.marks.address).toBeNull();
  expect((await suite.db.select().from(tenantReceipts))[0]!.receipt).toEqual(contact);
});

it("retires GET previews while the authored POST still draws without saving or printing", async () => {
  const app = new Hono();
  mountReceiptPreviewApi(app, { db: suite.db, cfg: venue.cfg }, () => {});
  const get = await app.request("/management-api/receipt-preview?receipt=%7B%7D", {
    headers: { cookie: venue.managerCookie },
  });
  expect(get.status).toBe(404);
  const response = await app.request("/management-api/receipt-preview", {
    method: "POST",
    headers: { cookie: venue.managerCookie, "content-type": "application/json" },
    body: JSON.stringify({
      ...draft(),
      receipt: {
        headerSubtitle: { "es-ES": "Unsaved POST" },
        footerMessage: { "es-ES": "Still a sample" },
      },
    }),
  });
  expect(response.status).toBe(200);
  const answer = (await response.json()) as ReceiptPreviewResponse;
  expect(lines(answer)).toContain("Unsaved POST");
  expect(lines(answer)).toContain("Still a sample");
  expect(await suite.db.select().from(tenantReceipts)).toEqual([]);
  expect(await suite.db.select().from(printJobs)).toEqual([]);
  expect(await suite.db.select().from(sales)).toEqual([]);
});
