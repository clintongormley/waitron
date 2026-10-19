import { eq } from "drizzle-orm";
import { departments, departmentReceipts } from "@waitron/venue-service";
import { mountDepartmentReceiptSettingsApi } from "./department-receipt-api.js";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { recordTillSaleOrchestration as recordTillSale } from "./testing/whole-payment-fixture.js";
import type { FiscalContribution } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { getCountryPack } from "@waitron/country-packs";
import { deviceRequestCfg } from "./testing/session-device.js";

// The full manifest, because the first case files a real fiscal record through `recordTillSale`.
// `resetPerTest: false`: the venue set up once in `beforeAll` is read by every case, and each case
// that writes the description restores it in a `finally`.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
let venue: Venue;
let offers: ZoneOffers;
let departmentId: string;
const policy = { receiptPrintMode: "auto", printTradingName: true } as const;
const departmentPath = () => `/management-api/venue-service/departments/${departmentId}/receipt`;
const resetDescription = () =>
  suite.db
    .update(departmentReceipts)
    .set({ receipt: { operationDescription: "Venta en establecimiento" } })
    .where(eq(departmentReceipts.departmentId, departmentId));
beforeAll(async () => {
  venue = await setupVenue(suite.db);
  const [department] = await suite.db
    .select()
    .from(departments)
    .where(eq(departments.locationId, venue.cfg.locationId));
  departmentId = department!.id;
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId, receipt: { operationDescription: "Venta en establecimiento" } });
  offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
});
function app(locationId?: string) {
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: { ...venue.cfg, locationId: locationId ?? venue.cfg.locationId },
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  mountDepartmentReceiptSettingsApi(
    app,
    {
      db: suite.db,
      venueCfg: () => ({
        ...venue.cfg,
        locationId: (locationId ?? venue.cfg.locationId) as typeof venue.cfg.locationId,
      }),
      validateOperationDescription: realFiscal().venueFields?.validateOperationDescription,
    },
    () => {},
  );
  return app;
}
function appWithFiscal(fiscal: FiscalContribution) {
  const app = new Hono();
  mountDepartmentReceiptSettingsApi(
    app,
    {
      db: suite.db,
      venueCfg: () => venue.cfg,
      validateOperationDescription: fiscal.venueFields?.validateOperationDescription,
    },
    () => {},
  );
  return app;
}
const realFiscal = () => venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
const request = (cookie: string, operationDescription: unknown) => ({
  method: "PUT",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ receipt: { operationDescription }, policy }),
});
async function sell() {
  const clock: TrustedClock = {
    now: () => ({
      instant: new Date(),
      offsetMinutes: 0,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("This test supplies an anchored clock");
    },
    currentAnchor: () => null,
  };
  const backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => Promise.reject(new Error("A local sale must not contact AEAT")),
  });
  const saleCfg = await deviceRequestCfg(suite.db, venue.cfg);
  return recordTillSale({ db: suite.db, backend, clock }, saleCfg, {
    zoneId: offers.zoneId,
    lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
    tender: { method: "cash", amount: "1.50" },
  });
}

describe("department invoice settings", () => {
  it("uses an edited department description for the next fiscal record while retaining the earlier record", async () => {
    await suite.db.execute(
      sql`update locations set operation_description = 'Unrelated generic bootstrap' where id = ${venue.cfg.locationId}`,
    );
    try {
      await sell();
      expect(
        (
          await app().request(
            departmentPath(),
            request(venue.managerCookie, "  Venta de comidas  "),
          )
        ).status,
      ).toBe(204);
      await sell();
      const descriptions = await suite.db.execute<{ description: string }>(sql`
        select descripcion_operacion as description from registros_facturacion
        order by secuencia`);
      expect(descriptions.rows).toEqual([
        { description: "Venta en establecimiento" },
        { description: "  Venta de comidas  " },
      ]);
    } finally {
      await suite.db.execute(
        sql`update locations set operation_description = 'Venta en establecimiento' where id = ${venue.cfg.locationId}`,
      );
      await resetDescription();
    }
  });
  it.each([undefined, "", "   "])(
    "with no default offered, a cash sale refuses missing department description %j before recording anything",
    async (description) => {
      await suite.db
        .update(departmentReceipts)
        .set({ receipt: description === undefined ? {} : { operationDescription: description } })
        .where(eq(departmentReceipts.departmentId, departmentId));
      const snapshot = async () =>
        (
          await suite.db.execute(sql`
      select (select count(*) from sales) as sales,
        (select count(*) from registros_facturacion) as records,
        (select count(*) from print_jobs) as jobs,
        (select group_concat(next_number) from invoice_series) as numbers`)
        ).rows;
      const before = await snapshot();
      try {
        await expect(sell()).rejects.toMatchObject({
          code: "department.operation_description_required",
          params: { departmentId },
        });
        expect(await snapshot()).toEqual(before);
      } finally {
        await resetDescription();
      }
    },
  );
  it("requires a session and configuration permission for reads and writes", async () => {
    for (const method of ["GET", "PUT"]) {
      const headers = { "content-type": "application/json" };
      expect(
        (
          await app().request(departmentPath(), {
            method,
            headers,
            ...(method === "PUT"
              ? { body: JSON.stringify({ receipt: { operationDescription: "Venta" }, policy }) }
              : {}),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app().request(departmentPath(), {
            method,
            headers: { ...headers, cookie: venue.staffCookie },
            ...(method === "PUT"
              ? { body: JSON.stringify({ receipt: { operationDescription: "Venta" }, policy }) }
              : {}),
          })
        ).status,
      ).toBe(403);
    }
  });
  it("reads and updates the selected department description", async () => {
    const response = await app().request(departmentPath(), {
      headers: { cookie: venue.managerCookie },
    });
    expect(await response.json()).toEqual({
      receipt: { operationDescription: "Venta en establecimiento" },
      operationDescriptionRequired: true,
      policy,
      receiptLanguage: "es-ES",
      languages: ["es-ES"],
      warningLanguages: [],
      venueAddress: ["Calle Mayor 1", "28013 Madrid"],
    });
    try {
      expect(
        (await app().request(departmentPath(), request(venue.managerCookie, "Venta de comidas")))
          .status,
      ).toBe(204);
      const read = await app().request(departmentPath(), {
        headers: { cookie: venue.managerCookie },
      });
      expect(await read.json()).toEqual({
        receipt: { operationDescription: "Venta de comidas" },
        operationDescriptionRequired: true,
        policy,
        receiptLanguage: "es-ES",
        languages: ["es-ES"],
        warningLanguages: [],
        venueAddress: ["Calle Mayor 1", "28013 Madrid"],
      });
    } finally {
      await resetDescription();
    }
  });
  it.each(["", "   ", null, 12, "Venta\u0001aqui", "a".repeat(501)])(
    "refuses invalid descriptions without writing: %j",
    async (description) => {
      const response = await app().request(
        departmentPath(),
        request(venue.managerCookie, description),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error:
          typeof description === "string"
            ? { code: "management.request_invalid", params: { field: "operationDescription" } }
            : {
                code: "receipt.invalid",
                params: { reason: "not_string", field: "operationDescription" },
              },
      });
      const read = await app().request(departmentPath(), {
        headers: { cookie: venue.managerCookie },
      });
      expect((await read.json()).receipt.operationDescription).toBe("Venta en establecimiento");
    },
  );
  it.each(["GET", "PUT"])(
    "the retired location settings %s route stays absent without writing",
    async (method) => {
      const before = await suite.db.select().from(departmentReceipts);
      const response = await app("no-such-location").request(
        "/management-api/location-settings",
        method === "PUT"
          ? request(venue.managerCookie, "Venta de comidas")
          : { headers: { cookie: venue.managerCookie } },
      );
      expect(response.status).toBe(404);
      expect(await suite.db.select().from(departmentReceipts)).toEqual(before);
    },
  );

  it.each([
    ["an object without the field", {}],
    ["a bare string", "Venta de comidas"],
    ["null", null],
  ])("refuses a body that is %s", async (_label, body) => {
    const response = await app().request(departmentPath(), {
      method: "PUT",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "receipt" } },
    });
  });

  it("passes on a validator refusal that is not a field refusal instead of blaming the field", async () => {
    const real = realFiscal();
    const response = await appWithFiscal({
      ...real,
      venueFields: {
        ...real.venueFields!,
        validateOperationDescription: () => {
          throw new AppError("authorization.not_permitted", { permission: "venue.configure" });
        },
      },
    }).request(departmentPath(), request(venue.managerCookie, "Venta"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
  });

  it("answers an internal error when the validator fails unexpectedly", async () => {
    const real = realFiscal();
    const response = await appWithFiscal({
      ...real,
      venueFields: {
        ...real.venueFields!,
        validateOperationDescription: () => {
          throw new Error("validator crashed");
        },
      },
    }).request(departmentPath(), request(venue.managerCookie, "Venta"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    const read = await app().request(departmentPath(), {
      headers: { cookie: venue.managerCookie },
    });
    expect((await read.json()).receipt.operationDescription).toBe("Venta en establecimiento");
  });

  it("saves an empty authored receipt when the fiscal regime declares no description field", async () => {
    const withoutRules: FiscalContribution = { ...realFiscal(), venueFields: undefined };
    try {
      const response = await appWithFiscal(withoutRules).request(departmentPath(), {
        ...request(venue.managerCookie, ""),
        body: JSON.stringify({ receipt: {}, policy }),
      });
      expect(response.status).toBe(204);
      const read = await app().request(departmentPath(), {
        headers: { cookie: venue.managerCookie },
      });
      expect((await read.json()).receipt).toEqual({});
    } finally {
      await resetDescription();
    }
  });
});

describe("receipt language", () => {
  const SPAIN_RECEIPT = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
  const CATALONIA = getCountryPack("ES")!.administrativeAreas.find(({ code }) => code === "08")!;
  const PATH = "/management-api/receipt-language";
  const WRITE_PATH = "/management-api/venue-defaults";

  const read = (cookie = venue.managerCookie) => app().request(PATH, { headers: { cookie } });
  const write = (body: unknown, cookie = venue.managerCookie) =>
    app().request(WRITE_PATH, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const stored = async (): Promise<string[]> => {
    const { rows } = await suite.db.execute<{ invoice_locales: string }>(
      sql`select invoice_locales from locations where id = ${venue.cfg.locationId}`,
    );
    return JSON.parse(rows[0]!.invoice_locales) as string[];
  };
  /** The shared location placed in `province` with `invoiceLocales`, put back afterwards. */
  async function at(province: string, invoiceLocales: string[], fn: () => Promise<void>) {
    await suite.db.execute(
      sql`update locations set province = ${province}, invoice_locales = ${JSON.stringify(invoiceLocales)} where id = ${venue.cfg.locationId}`,
    );
    try {
      await fn();
    } finally {
      await suite.db.execute(
        sql`update locations set province = 'Madrid', invoice_locales = '["es-ES"]' where id = ${venue.cfg.locationId}`,
      );
    }
  }

  it("answers Barcelona's language, the pack's choices and why it is fixed", async () => {
    expect(CATALONIA.fixedReceiptLocale?.locale).toBe("ca-ES");
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await read();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        language: "ca-ES",
        choices: SPAIN_RECEIPT,
        fixed: { locale: "ca-ES", reason: CATALONIA.fixedReceiptLocale!.reason },
      });
    });
  });

  it("no longer serves a write: the venue-defaults route saves the receipt language", async () => {
    const response = await app().request(PATH, {
      method: "PUT",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify({ language: "gl-ES" }),
    });
    expect(response.status).toBe(404);
    expect(await stored()).toEqual(["es-ES"]);
    expect((await read()).status).toBe(200);
  });

  it("answers no fixed language for Madrid", async () => {
    expect(await (await read()).json()).toEqual({
      language: "es-ES",
      choices: SPAIN_RECEIPT,
      fixed: null,
    });
  });

  it("refuses another language in Barcelona, naming the fixed one, and leaves the row alone", async () => {
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await write({ receiptLanguage: "gl-ES" });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "receipt.language_fixed",
          params: { field: "receiptLanguage", language: "ca-ES" },
        },
      });
      expect(await stored()).toEqual(["ca-ES"]);
    });
  });

  it("saves Galician for Madrid as the location's one language", async () => {
    try {
      const saved = await write({ receiptLanguage: "gl-ES" });
      expect(saved.status).toBe(200);
      expect((await saved.json()).receiptLanguage).toBe("gl-ES");
      expect((await (await read()).json()).language).toBe("gl-ES");
      expect(await stored()).toEqual(["gl-ES"]);
    } finally {
      await suite.db.execute(
        sql`update locations set invoice_locales = '["es-ES"]' where id = ${venue.cfg.locationId}`,
      );
    }
  });

  it("writes one language over a two-language row", async () => {
    await at("Madrid", ["es-ES", "ca-ES"], async () => {
      const saved = await write({ receiptLanguage: "es-ES" });
      expect(saved.status).toBe(200);
      expect((await saved.json()).receiptLanguage).toBe("es-ES");
      expect(await stored()).toEqual(["es-ES"]);
    });
  });

  it.each([
    ["a language the pack does not offer", { receiptLanguage: "en-GB" }],
    ["an empty language", { receiptLanguage: "" }],
    ["a number", { receiptLanguage: 12 }],
    ["a list", { receiptLanguage: ["gl-ES"] }],
  ])("refuses %s without writing", async (_label, body) => {
    const response = await write(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "receiptLanguage" } },
    });
    expect(await stored()).toEqual(["es-ES"]);
  });

  it("refuses English in Barcelona as a language the pack does not offer", async () => {
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await write({ receiptLanguage: "en-GB" });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("management.request_invalid");
    });
  });

  it("answers a Barcelona row stored in Spanish as it is, and accepts only Catalan over it", async () => {
    await at("Barcelona", ["es-ES"], async () => {
      expect(await (await read()).json()).toEqual({
        language: "es-ES",
        choices: SPAIN_RECEIPT,
        fixed: { locale: "ca-ES", reason: CATALONIA.fixedReceiptLocale!.reason },
      });
      const refused = await write({ receiptLanguage: "gl-ES" });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe("receipt.language_fixed");
      expect(await stored()).toEqual(["es-ES"]);
      const saved = await write({ receiptLanguage: "ca-ES" });
      expect(saved.status).toBe(200);
      expect((await saved.json()).receiptLanguage).toBe("ca-ES");
      expect(await stored()).toEqual(["ca-ES"]);
    });
  });

  it("answers a stored language outside the choices as it is", async () => {
    await at("Madrid", ["en-GB"], async () => {
      expect((await (await read()).json()).language).toBe("en-GB");
    });
  });

  it("reads and writes in one transaction per request", async () => {
    let opened = 0;
    const counting = new Proxy(suite.db, {
      get(target, key) {
        if (key === "withWriteLock")
          return (fn: Parameters<typeof target.withWriteLock>[0]) => {
            opened += 1;
            return target.withWriteLock(fn);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    });
    const counted = new Hono();
    mountLocationSettingsApi(
      counted,
      { db: counting, cfg: venue.cfg, fiscal: realFiscal() },
      () => {},
    );
    const answers = [];
    for (const [path, init] of [
      [PATH, { headers: { cookie: venue.managerCookie } }],
      [
        WRITE_PATH,
        {
          method: "PUT",
          headers: { cookie: venue.managerCookie, "content-type": "application/json" },
          body: JSON.stringify({ receiptLanguage: "es-ES" }),
        },
      ],
    ] as const) {
      opened = 0;
      const response = await counted.request(path, init);
      answers.push([response.status, opened]);
    }
    expect(answers).toEqual([
      [200, 1],
      [200, 1],
    ]);
  });

  it("requires a session and configuration permission for reads and writes", async () => {
    expect((await app().request(PATH)).status).toBe(401);
    expect((await read(venue.staffCookie)).status).toBe(403);
    const anonymous = await app().request(WRITE_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiptLanguage: "gl-ES" }),
    });
    expect(anonymous.status).toBe(401);
    expect((await write({ receiptLanguage: "gl-ES" }, venue.staffCookie)).status).toBe(403);
    expect(await stored()).toEqual(["es-ES"]);
  });

  it("refuses a read and a write when the configured location does not exist", async () => {
    const missing = app("no-such-location");
    const answers = [
      await missing.request(PATH, { headers: { cookie: venue.managerCookie } }),
      await missing.request(WRITE_PATH, {
        method: "PUT",
        headers: { cookie: venue.managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ receiptLanguage: "gl-ES" }),
      }),
    ];
    for (const response of answers) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "locationId" } },
      });
    }
  });
});

describe("venue defaults", () => {
  const SPAIN_RECEIPT = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
  const PATH = "/management-api/venue-defaults";

  const read = (cookie = venue.managerCookie) => app().request(PATH, { headers: { cookie } });
  const write = (body: unknown, cookie = venue.managerCookie) =>
    app().request(PATH, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  let initialVatClass: string;
  beforeAll(async () => {
    initialVatClass = (await stored()).vatClass;
    expect(initialVatClass).not.toBe("zero");
  });
  const stored = async (): Promise<{ languages: string[]; vatClass: string }> => {
    const { rows } = await suite.db.execute<{ invoice_locales: string }>(
      sql`select invoice_locales from locations where id = ${venue.cfg.locationId}`,
    );
    const settings = await suite.db.execute<{ default_product_vat_class: string }>(
      sql`select default_product_vat_class from catalogue_settings where id = 1`,
    );
    return {
      languages: JSON.parse(rows[0]!.invoice_locales) as string[],
      vatClass: settings.rows[0]?.default_product_vat_class ?? "general",
    };
  };
  const untouched = () => ({ languages: ["es-ES"], vatClass: initialVatClass });
  /** The shared location placed in `province` with `invoiceLocales`; both values put back afterwards. */
  async function at(province: string, invoiceLocales: string[], fn: () => Promise<void>) {
    await suite.db.execute(
      sql`update locations set province = ${province}, invoice_locales = ${JSON.stringify(invoiceLocales)} where id = ${venue.cfg.locationId}`,
    );
    try {
      await fn();
    } finally {
      await suite.db.execute(
        sql`update locations set province = 'Madrid', invoice_locales = '["es-ES"]' where id = ${venue.cfg.locationId}`,
      );
      await suite.db.execute(
        sql`update catalogue_settings set default_product_vat_class = ${initialVatClass}`,
      );
    }
  }

  it("answers Barcelona's fixed language, the pack's choices and the VAT class", async () => {
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await read();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        receiptLanguage: "ca-ES",
        receiptLanguageChoices: SPAIN_RECEIPT,
        fixedReceiptLanguage: "ca-ES",
        defaultProductVatClass: initialVatClass,
      });
    });
  });

  it("answers no fixed language for Madrid", async () => {
    await at("Madrid", ["es-ES"], async () => {
      expect(await (await read()).json()).toEqual({
        receiptLanguage: "es-ES",
        receiptLanguageChoices: SPAIN_RECEIPT,
        fixedReceiptLanguage: null,
        defaultProductVatClass: initialVatClass,
      });
    });
  });

  it("answers a stored language outside the choices as it is", async () => {
    await at("Madrid", ["en-GB"], async () => {
      expect((await (await read()).json()).receiptLanguage).toBe("en-GB");
    });
  });

  it("saves the receipt language alone and leaves the VAT class", async () => {
    await at("Madrid", ["es-ES"], async () => {
      const response = await write({ receiptLanguage: "gl-ES" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        receiptLanguage: "gl-ES",
        receiptLanguageChoices: SPAIN_RECEIPT,
        fixedReceiptLanguage: null,
        defaultProductVatClass: initialVatClass,
      });
      expect(await stored()).toEqual({ languages: ["gl-ES"], vatClass: initialVatClass });
    });
  });

  it("saves the VAT class alone and leaves the receipt language", async () => {
    await at("Madrid", ["es-ES"], async () => {
      const response = await write({ defaultProductVatClass: "zero" });
      expect(response.status).toBe(200);
      expect((await response.json()).defaultProductVatClass).toBe("zero");
      expect(await stored()).toEqual({ languages: ["es-ES"], vatClass: "zero" });
    });
  });

  it("refuses a non-Catalan language in Barcelona and writes no VAT class", async () => {
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await write({ receiptLanguage: "es-ES", defaultProductVatClass: "zero" });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "receipt.language_fixed",
          params: { field: "receiptLanguage", language: "ca-ES" },
        },
      });
      expect(await stored()).toEqual({ languages: ["ca-ES"], vatClass: initialVatClass });
    });
  });

  it("takes back the language it wrote when the VAT class is refused", async () => {
    await at("Madrid", ["es-ES"], async () => {
      const response = await write({ receiptLanguage: "gl-ES", defaultProductVatClass: "bogus" });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "product.invalid", params: { field: "defaultProductVatClass" } },
      });
      expect(await stored()).toEqual(untouched());
    });
  });

  it.each([
    ["receiptLanguage", null, "management.request_invalid"],
    ["receiptLanguage", [], "management.request_invalid"],
    ["receiptLanguage", 10, "management.request_invalid"],
    ["defaultProductVatClass", null, "product.invalid"],
    ["defaultProductVatClass", [], "product.invalid"],
    ["defaultProductVatClass", 10, "product.invalid"],
    ["defaultProductVatClass", ["reduced"], "product.invalid"],
    ["defaultProductVatClass", "unknown", "product.invalid"],
  ])("refuses %s of %j as %s without writing", async (field, value, code) => {
    const response = await write({ [field]: value });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code, params: { field } } });
    expect(await stored()).toEqual(untouched());
  });

  it.each([
    ["an empty body", {}],
    ["another key", { other: 1 }],
    ["another key beside a valid one", { defaultProductVatClass: "zero", other: 1 }],
    ["a list", ["gl-ES"]],
    ["null", null],
    ["a bare string", "gl-ES"],
  ])("refuses %s as an invalid body without writing", async (_label, body) => {
    const response = await write(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await stored()).toEqual(untouched());
  });

  it("requires a session and configuration permission for reads and writes", async () => {
    expect((await app().request(PATH)).status).toBe(401);
    expect((await read(venue.staffCookie)).status).toBe(403);
    const anonymous = await app().request(PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultProductVatClass: "zero" }),
    });
    expect(anonymous.status).toBe(401);
    expect((await write({ defaultProductVatClass: "zero" }, venue.staffCookie)).status).toBe(403);
    expect(await stored()).toEqual(untouched());
  });

  it("reads and writes in one transaction per request", async () => {
    let opened = 0;
    const counting = new Proxy(suite.db, {
      get(target, key) {
        if (key === "withWriteLock")
          return (fn: Parameters<typeof target.withWriteLock>[0]) => {
            opened += 1;
            return target.withWriteLock(fn);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    });
    const counted = new Hono();
    mountLocationSettingsApi(
      counted,
      { db: counting, cfg: venue.cfg, fiscal: realFiscal() },
      () => {},
    );
    const answers: [number, number][] = [];
    await at("Madrid", ["es-ES"], async () => {
      for (const init of [
        { headers: { cookie: venue.managerCookie } } as RequestInit,
        {
          method: "PUT",
          headers: { cookie: venue.managerCookie, "content-type": "application/json" },
          body: JSON.stringify({ receiptLanguage: "es-ES", defaultProductVatClass: "zero" }),
        },
      ]) {
        opened = 0;
        const response = await counted.request(PATH, init);
        answers.push([response.status, opened]);
      }
    });
    expect(answers).toEqual([
      [200, 1],
      [200, 1],
    ]);
  });
});
