import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  printers,
  printJobs,
  saleLines,
  sales,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant, seedDevice } from "@waitron/db/testing/seed.js";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  hashSessionToken,
  personRole,
  persons,
  startManagementSession,
} from "@waitron/identity";
import {
  stringToBasisPoints,
  stringToCents,
  stringToThousandths,
  type SaleLineClassification,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { CategoryReport, CategoryTotal } from "@waitron/reporting";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { opensDrawer, printedLines } from "./testing/decode-ticket.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

// The category report, its printer list and its print, end to end over sales seeded with the
// columns a filed line carries. Recorded names differ from today's, so a route that reads the
// wrong mode fails.
const noopLog: Logger = () => {};

const DAY1 = "2026-06-10"; // classified lines, one of them an extra
const DAY2 = "2026-06-11"; // one line recorded before classification began
const DAY3 = "2026-06-12"; // a product whose category today sits in a loop

let nodeId: string;
let locationId: string;
let tillId: string;
let deviceId: string;
let seriesId: string;
let managerCookie: string;
let supervisorCookie: string;
let staffCookie: string;
let barPrinter: string;
let narrowPrinter: string;
let inactivePrinter: string;
let elsewherePrinter: string;
const ids = {
  drinks: "",
  softs: "",
  water: "",
  cola: "",
  ice: "",
  bread: "",
  loopProduct: "",
};

const recorded = {
  drinks: "Drinks (as sold)",
  softs: "Soft drinks (as sold)",
};

let invoiceNumber = 0;

interface SeedLine {
  id?: string;
  parentLineId?: string;
  productId?: string;
  classification?: SaleLineClassification;
  category?: string;
  net: string;
  gross?: string;
  rate: string;
}

async function seedSale(db: Database, issuedAt: string, lines: SeedLine[]): Promise<void> {
  const [sale] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId,
      nodeId,
      seriesId,
      invoiceNumber: ++invoiceNumber,
      issuedAt,
      issuedOffsetMinutes: 0,
      total: stringToCents("0.00"),
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  let lineNo = 0;
  for (const line of lines) {
    await db.insert(saleLines).values({
      ...(line.id === undefined ? {} : { id: line.id }),
      saleId: sale!.id,
      lineNo: ++lineNo,
      name: "Staff name",
      descriptions: { "es-ES": "Customer text" },
      quantity: stringToThousandths("1.000"),
      unitPrice: stringToCents(line.net),
      vatRate: stringToBasisPoints(line.rate),
      lineTotal: stringToCents(line.net),
      lineGross: line.gross === undefined ? null : stringToCents(line.gross),
      productId: line.productId ?? null,
      parentLineId: line.parentLineId ?? null,
      classification: line.classification ?? null,
      category: line.category ?? null,
    });
  }
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Sala principal",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [other] = await db
      .insert(locations)
      .values({
        name: "Terraza",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const [till] = await db
      .insert(tills)
      .values({ locationId, name: "Caja 1" })
      .returning({ id: tills.id });
    tillId = till!.id;
    ({ deviceId } = await seedDevice(db, { tillId }));
    const [node] = await db
      .insert(nodes)
      .values({ locationId, name: "Nodo 1" })
      .returning({ id: nodes.id });
    nodeId = node!.id;
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;

    const printer = async (values: {
      name: string;
      location?: string;
      active?: boolean;
      paperWidth?: "58mm" | "80mm";
    }): Promise<string> => {
      const [row] = await db
        .insert(printers)
        .values({
          locationId: values.location ?? locationId,
          name: values.name,
          transport: "network_tcp",
          host: `10.0.0.${Math.floor(Math.random() * 200) + 2}`,
          port: 9100,
          active: values.active ?? true,
          paperWidth: values.paperWidth ?? "80mm",
        })
        .returning({ id: printers.id });
      return row!.id;
    };
    barPrinter = await printer({ name: "Barra" });
    narrowPrinter = await printer({ name: "Almacén", paperWidth: "58mm" });
    inactivePrinter = await printer({ name: "Antigua", active: false });
    elsewherePrinter = await printer({ name: "Terraza", location: other!.id });

    await withTransaction(db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Bar" });
      const drinks = await createCategory(tx, { name: "Bebidas" });
      const softs = await createCategory(tx, { name: "Refrescos", parentId: drinks.id });
      const loopA = await createCategory(tx, { name: "Bucle A" });
      const loopB = await createCategory(tx, { name: "Bucle B", parentId: loopA.id });
      const product = async (name: string, categoryId: string | null) =>
        (
          await createProduct(tx, {
            catalogueId: menu.id,
            categoryId,
            name,
            pricingUnit: "each",
            unitPrice: "1.00",
            vatClass: "general",
          })
        ).id;
      ids.drinks = drinks.id;
      ids.softs = softs.id;
      ids.water = await product("Water", drinks.id);
      ids.cola = await product("Cola", softs.id);
      ids.ice = await product("Ice", null);
      ids.bread = await product("Bread", null);
      ids.loopProduct = await product("Loop product", loopB.id);
      // A loop in today's tree, which a snapshot check refuses. Written directly: the catalogue's
      // own writers refuse it.
      await tx.execute(
        sql`update category_details set parent_id = ${loopB.id} where category_id = ${loopA.id}`,
      );
    });

    const colaLine = randomUUID();
    await seedSale(db, "2026-06-10T12:00:00Z", [
      {
        productId: ids.water,
        classification: { reporting: [{ id: ids.drinks, name: recorded.drinks }] },
        net: "2.00",
        gross: "2.20",
        rate: "10.00",
      },
      {
        id: colaLine,
        productId: ids.cola,
        classification: {
          reporting: [
            { id: ids.drinks, name: recorded.drinks },
            { id: ids.softs, name: recorded.softs },
          ],
        },
        net: "3.00",
        gross: "3.63",
        rate: "21.00",
      },
      {
        parentLineId: colaLine,
        productId: ids.ice,
        classification: { reporting: [] },
        net: "0.50",
        gross: "0.55",
        rate: "10.00",
      },
      {
        productId: ids.bread,
        classification: { reporting: [] },
        net: "1.00",
        gross: "1.10",
        rate: "10.00",
      },
    ]);
    await seedSale(db, "2026-06-11T12:00:00Z", [{ category: "Tapas", net: "4.00", rate: "10.00" }]);
    await seedSale(db, "2026-06-12T12:00:00Z", [
      {
        productId: ids.loopProduct,
        classification: { reporting: [] },
        net: "1.00",
        gross: "1.21",
        rate: "21.00",
      },
    ]);

    const sids = await withTransaction(db, async (tx) => {
      const mkPerson = async (
        name: string,
        role: (typeof personRole.enumValues)[number],
      ): Promise<string> => {
        const [p] = await tx
          .insert(persons)
          .values({ displayName: name, pinHash: hashPin("1234"), role })
          .returning({ id: persons.id });
        return (await startManagementSession(tx, { personId: p!.id })).token;
      };
      return {
        manager: await mkPerson("The Manager", "manager"),
        supervisor: await mkPerson("The Supervisor", "supervisor"),
        staff: await mkPerson("The Clerk", "staff"),
      };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${sids.manager}`;
    supervisorCookie = `${MANAGEMENT_COOKIE}=${sids.supervisor}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${sids.staff}`;
  },
});

function mountApp(venueLocale: "es-ES" | "en-GB" = "en-GB"): Hono {
  const app = new Hono();
  mountReportApi(app, { db: suite.db, cfg: { nodeId, locationId }, venueLocale }, noopLog);
  return app;
}

async function request(
  path: string,
  opts: {
    method?: "GET" | "POST";
    cookie?: string | null;
    body?: unknown;
    acceptLanguage?: string;
    app?: Hono;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  if (opts.acceptLanguage !== undefined) headers["accept-language"] = opts.acceptLanguage;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return (opts.app ?? mountApp()).request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function errorOf(res: Response): Promise<{ code: string; params?: Record<string, unknown> }> {
  return ((await res.json()) as { error: { code: string; params?: Record<string, unknown> } })
    .error;
}

const report = (qs: string, cookie?: string | null) =>
  request(`/management-api/reports/categories?${qs}`, { cookie });

/** A tree as `name: gross/net (direct lines)` rows, indented by depth. */
function treeRows(tree: CategoryTotal[]): string[] {
  return tree.flatMap((n) => [
    `${"  ".repeat(n.depth)}${n.kind === "category" || n.kind === "free_text" ? n.name : `(${n.kind})`}: ${n.gross}/${n.net} (${n.direct.lines})`,
    ...treeRows(n.children),
  ]);
}

async function personLocale(cookie: string, locale: string | null): Promise<void> {
  const token = cookie.split("=")[1]!;
  await suite.db.execute(sql`
    update persons set locale = ${locale}
    where id = (select person_id from management_sessions where token_hash = ${hashSessionToken(token)})`);
}

async function jobsOn(printerId: string) {
  return suite.db
    .select({
      id: printJobs.id,
      kind: printJobs.kind,
      locationId: printJobs.locationId,
      payload: printJobs.payload,
    })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId));
}

describe("GET /management-api/reports/categories", () => {
  it("reports the recorded tree at time of sale, with the recorded names", async () => {
    const res = await report(`from=${DAY1}&to=${DAY1}&mode=at_time_of_sale`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoryReport;
    expect(body.mode).toBe("at_time_of_sale");
    expect(treeRows(body.tree)).toEqual([
      "Drinks (as sold): 5.83/5.00 (1)",
      "  Soft drinks (as sold): 3.63/3.00 (1)",
      "(uncategorised): 1.65/1.50 (2)",
    ]);
    expect(body).not.toHaveProperty("labels");
    expect(body).toMatchObject({
      gross: "7.48",
      net: "6.50",
      grossComplete: true,
      linesWithoutGross: 0,
    });
  });

  it("reports today's tree in current mode", async () => {
    const res = await report(`from=${DAY1}&to=${DAY1}&mode=current`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoryReport;
    expect(body.mode).toBe("current");
    expect(treeRows(body.tree)).toEqual([
      "Bebidas: 5.83/5.00 (1)",
      "  Refrescos: 3.63/3.00 (1)",
      "(uncategorised): 1.65/1.50 (2)",
    ]);
  });

  it("counts an extra under its dish when asked to, in either mode", async () => {
    for (const mode of ["at_time_of_sale", "current"]) {
      const res = await report(`from=${DAY1}&to=${DAY1}&mode=${mode}&extrasIntoDish=true`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as CategoryReport;
      expect(treeRows(body.tree).map((row) => row.replace(/^( *)[^:]+/, "$1x"))).toEqual([
        "x: 6.38/5.50 (1)",
        "  x: 4.18/3.50 (2)",
        "x: 1.10/1.00 (1)",
      ]);
    }
    const off = (await (
      await report(`from=${DAY1}&to=${DAY1}&mode=current&extrasIntoDish=false`)
    ).json()) as CategoryReport;
    expect(treeRows(off.tree)[2]).toBe("(uncategorised): 1.65/1.50 (2)");
  });

  it("marks a range with a line recorded before classification began as incomplete, for this node", async () => {
    const res = await report(`from=${DAY1}&to=${DAY2}&mode=current`);
    const body = (await res.json()) as CategoryReport;
    expect(body).toMatchObject({ grossComplete: false, linesWithoutGross: 1, net: "10.50" });
    expect(treeRows(body.tree).at(-1)).toBe("(not_recorded): 0.00/4.00 (1)");
  });

  it("answers 409 sale_classification.invalid when today's catalogue fails the snapshot checks", async () => {
    const res = await report(`from=${DAY3}&to=${DAY3}&mode=current`);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: ids.loopProduct, reason: "repeated_id" },
    });
    // The recorded snapshot is unaffected by today's catalogue.
    expect((await report(`from=${DAY3}&to=${DAY3}&mode=at_time_of_sale`)).status).toBe(200);
  });

  it.each([
    ["missing from", `to=${DAY1}&mode=current`, "from"],
    ["malformed from", `from=2026-02-30&to=${DAY1}&mode=current`, "from"],
    ["missing to", `from=${DAY1}&mode=current`, "to"],
    ["malformed to", `from=${DAY1}&to=10-06-2026&mode=current`, "to"],
    ["an inverted range", `from=${DAY2}&to=${DAY1}&mode=current`, "range"],
    ["missing mode", `from=${DAY1}&to=${DAY1}`, "mode"],
    ["an unknown mode", `from=${DAY1}&to=${DAY1}&mode=today`, "mode"],
    [
      "a non-boolean extrasIntoDish",
      `from=${DAY1}&to=${DAY1}&mode=current&extrasIntoDish=1`,
      "extrasIntoDish",
    ],
  ])("400 management.request_invalid: %s", async (_case, qs, field) => {
    const res = await report(qs);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: "management.request_invalid",
      params: { field },
    });
  });

  it("401 without a session, 403 without report.view, 200 for a supervisor", async () => {
    const qs = `from=${DAY1}&to=${DAY1}&mode=current`;
    const none = await report(qs, null);
    expect(none.status).toBe(401);
    expect((await errorOf(none)).code).toBe("management_session.required");
    const staff = await report(qs, staffCookie);
    expect(staff.status).toBe(403);
    expect((await errorOf(staff)).code).toBe("authorization.not_permitted");
    expect((await report(qs, supervisorCookie)).status).toBe(200);
  });
});

describe("GET /management-api/reports/printers", () => {
  it("lists this location's active printers by name, to a supervisor", async () => {
    const res = await request("/management-api/reports/printers", { cookie: supervisorCookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: narrowPrinter, name: "Almacén" },
      { id: barPrinter, name: "Barra" },
    ]);
  });

  it("401 without a session, 403 without report.view", async () => {
    const none = await request("/management-api/reports/printers", { cookie: null });
    expect(none.status).toBe(401);
    expect((await errorOf(none)).code).toBe("management_session.required");
    const staff = await request("/management-api/reports/printers", { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect((await errorOf(staff)).code).toBe("authorization.not_permitted");
  });
});

describe("POST /management-api/reports/categories/print", () => {
  const print = (body: unknown, opts: { cookie?: string | null; acceptLanguage?: string } = {}) =>
    request("/management-api/reports/categories/print", { method: "POST", body, ...opts });

  it("enqueues one document job, headed with the mode and saying the gross is incomplete", async () => {
    const before = (await jobsOn(barPrinter)).length;
    const res = await print(
      { from: DAY1, to: DAY2, mode: "current", extrasIntoDish: false, printerId: barPrinter },
      { acceptLanguage: "en" },
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body).toEqual({ jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string });
    const jobs = await jobsOn(barPrinter);
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.find((j) => j.id === body.jobId)!;
    expect(job.kind).toBe("document");
    expect(job.locationId).toBe(locationId);
    // CLAUDE.md §5: a document job never carries a drawer pulse.
    expect(opensDrawer(new Uint8Array(job.payload))).toBe(false);
    const lines = printedLines(new Uint8Array(job.payload));
    expect(lines[0]).toBe("Current categories");
    expect(lines).toContain("From 2026-06-10 to 2026-06-11");
    expect(lines.find((l) => l.startsWith("Bebidas"))).toBeDefined();
    expect(lines.join(" ")).toContain(
      "Gross total incomplete: 1 line recorded before classification began",
    );
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
  });

  it("prints a complete period without the note, at time of sale, on a narrow printer's width", async () => {
    const res = await print(
      {
        from: DAY1,
        to: DAY1,
        mode: "at_time_of_sale",
        extrasIntoDish: true,
        printerId: narrowPrinter,
      },
      { acceptLanguage: "en" },
    );
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = (await jobsOn(narrowPrinter)).find((j) => j.id === jobId)!;
    const lines = printedLines(new Uint8Array(job.payload));
    expect(lines[0]).toBe("Categories at time of sale");
    expect(lines.join(" ")).toContain("Extras rolled into their dish");
    expect(lines.join(" ")).not.toContain("incomplete");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
  });

  it("prints in the person's language, else the browser's", async () => {
    const body = { from: DAY1, to: DAY1, mode: "current", printerId: barPrinter };
    const heading = async (res: Response): Promise<string> => {
      const { jobId } = (await res.json()) as { jobId: string };
      const job = (await jobsOn(barPrinter)).find((j) => j.id === jobId)!;
      return printedLines(new Uint8Array(job.payload))[0]!;
    };
    expect(await heading(await print(body, { acceptLanguage: "es" }))).toBe("Categorías actuales");
    await personLocale(managerCookie, "en-GB");
    try {
      expect(await heading(await print(body, { acceptLanguage: "es" }))).toBe("Current categories");
    } finally {
      await personLocale(managerCookie, null);
    }
  });

  it.each([
    ["an inactive printer", () => inactivePrinter],
    ["another location's printer", () => elsewherePrinter],
    ["an unknown printer", () => randomUUID()],
  ])("404 printer.not_found for %s, enqueuing nothing", async (_case, printerId) => {
    const id = printerId();
    const res = await print({ from: DAY1, to: DAY1, mode: "current", printerId: id });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toMatchObject({ code: "printer.not_found", params: { id } });
    expect(await jobsOn(id)).toEqual([]);
  });

  it("409 sale_classification.invalid enqueues nothing", async () => {
    const before = (await jobsOn(barPrinter)).length;
    const res = await print({ from: DAY3, to: DAY3, mode: "current", printerId: barPrinter });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("sale_classification.invalid");
    expect((await jobsOn(barPrinter)).length).toBe(before);
  });

  it.each([
    ["missing from", { to: DAY1, mode: "current" }, "from"],
    ["malformed to", { from: DAY1, to: "2026-13-01", mode: "current" }, "to"],
    ["an inverted range", { from: DAY2, to: DAY1, mode: "current" }, "range"],
    ["an unknown mode", { from: DAY1, to: DAY1, mode: "today" }, "mode"],
    [
      "a non-boolean extrasIntoDish",
      { from: DAY1, to: DAY1, mode: "current", extrasIntoDish: "yes" },
      "extrasIntoDish",
    ],
    [
      "a missing printerId",
      { from: DAY1, to: DAY1, mode: "current", printerId: undefined },
      "printerId",
    ],
    [
      "a malformed printerId",
      { from: DAY1, to: DAY1, mode: "current", printerId: "barra" },
      "printerId",
    ],
  ])("400 management.request_invalid: %s", async (_case, fields, field) => {
    const res = await print({ printerId: barPrinter, ...fields });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: "management.request_invalid",
      params: { field },
    });
  });

  it("401 without a session, 403 without report.view, 202 for a supervisor", async () => {
    const body = { from: DAY1, to: DAY1, mode: "current", printerId: barPrinter };
    const none = await print(body, { cookie: null });
    expect(none.status).toBe(401);
    expect((await errorOf(none)).code).toBe("management_session.required");
    const staff = await print(body, { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect((await errorOf(staff)).code).toBe("authorization.not_permitted");
    expect((await print(body, { cookie: supervisorCookie })).status).toBe(202);
  });
});
