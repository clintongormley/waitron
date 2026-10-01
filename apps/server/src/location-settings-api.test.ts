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
import { recordTillSale } from "./till-sale.js";
import type { FiscalContribution } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { getCountryPack } from "@waitron/country-packs";

/** The venue's invoice operation description, over the route. */
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
beforeAll(async () => {
  venue = await setupVenue(suite.db);
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
  return app;
}
function appWithFiscal(fiscal: FiscalContribution) {
  const app = new Hono();
  mountLocationSettingsApi(app, { db: suite.db, cfg: venue.cfg, fiscal }, () => {});
  return app;
}
const realFiscal = () => venueFiscalSelection(ALL_MODULES, "ES-common").contribution!;
const request = (cookie: string, operationDescription: unknown) => ({
  method: "PUT",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ operationDescription }),
});
describe("location invoice settings", () => {
  it("uses an edited description for the next fiscal record while retaining the earlier record", async () => {
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
    const sell = () =>
      recordTillSale({ db: suite.db, backend, clock }, venue.cfg, {
        zoneId: offers.zoneId,
        lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      });
    await sell();
    try {
      expect(
        (
          await app().request(
            "/management-api/location-settings",
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
    }
  });
  it("requires a session and configuration permission for reads and writes", async () => {
    for (const method of ["GET", "PUT"]) {
      const headers = { "content-type": "application/json" };
      expect(
        (
          await app().request("/management-api/location-settings", {
            method,
            headers,
            ...(method === "PUT"
              ? { body: JSON.stringify({ operationDescription: "Venta" }) }
              : {}),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app().request("/management-api/location-settings", {
            method,
            headers: { ...headers, cookie: venue.staffCookie },
            ...(method === "PUT"
              ? { body: JSON.stringify({ operationDescription: "Venta" }) }
              : {}),
          })
        ).status,
      ).toBe(403);
    }
  });
  it("reads and updates the deployed location", async () => {
    const response = await app().request("/management-api/location-settings", {
      headers: { cookie: venue.managerCookie },
    });
    expect(await response.json()).toEqual({
      name: "Sala principal",
      operationDescription: "Venta en establecimiento",
    });
    try {
      expect(
        (
          await app().request(
            "/management-api/location-settings",
            request(venue.managerCookie, "Venta de comidas"),
          )
        ).status,
      ).toBe(204);
      const read = await app().request("/management-api/location-settings", {
        headers: { cookie: venue.managerCookie },
      });
      expect(await read.json()).toEqual({
        name: "Sala principal",
        operationDescription: "Venta de comidas",
      });
    } finally {
      await suite.db.execute(
        sql`update locations set operation_description = 'Venta en establecimiento' where id = ${venue.cfg.locationId}`,
      );
    }
  });
  it.each(["", "   ", null, 12, "Venta\u0001aqui", "a".repeat(501)])(
    "refuses invalid descriptions without writing: %j",
    async (description) => {
      const response = await app().request(
        "/management-api/location-settings",
        request(venue.managerCookie, description),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "operationDescription" } },
      });
      const read = await app().request("/management-api/location-settings", {
        headers: { cookie: venue.managerCookie },
      });
      expect((await read.json()).operationDescription).toBe("Venta en establecimiento");
    },
  );
  it("refuses a read when the configured location does not exist", async () => {
    const response = await app("no-such-location").request("/management-api/location-settings", {
      headers: { cookie: venue.managerCookie },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "locationId" } },
    });
  });

  it("refuses a write when the configured location does not exist", async () => {
    const response = await app("no-such-location").request(
      "/management-api/location-settings",
      request(venue.managerCookie, "Venta de comidas"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "locationId" } },
    });
  });

  it.each([
    ["an object without the field", {}],
    ["a bare string", "Venta de comidas"],
    ["null", null],
  ])("refuses a body that is %s", async (_label, body) => {
    const response = await app().request("/management-api/location-settings", {
      method: "PUT",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "operationDescription" } },
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
    }).request("/management-api/location-settings", request(venue.managerCookie, "Venta"));
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
    }).request("/management-api/location-settings", request(venue.managerCookie, "Venta"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    const read = await app().request("/management-api/location-settings", {
      headers: { cookie: venue.managerCookie },
    });
    expect((await read.json()).operationDescription).toBe("Venta en establecimiento");
  });

  it("saves any non-blank description when the fiscal regime declares no venue-field rules", async () => {
    const withoutRules: FiscalContribution = { ...realFiscal(), venueFields: undefined };
    try {
      const response = await appWithFiscal(withoutRules).request(
        "/management-api/location-settings",
        request(venue.managerCookie, "a".repeat(501)),
      );
      expect(response.status).toBe(204);
      const read = await app().request("/management-api/location-settings", {
        headers: { cookie: venue.managerCookie },
      });
      expect((await read.json()).operationDescription).toBe("a".repeat(501));
    } finally {
      await suite.db.execute(
        sql`update locations set operation_description = 'Venta en establecimiento' where id = ${venue.cfg.locationId}`,
      );
    }
  });
});

describe("receipt language", () => {
  const SPAIN_RECEIPT = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
  const CATALONIA = getCountryPack("ES")!.administrativeAreas.find(({ code }) => code === "08")!;
  const PATH = "/management-api/receipt-language";

  const read = (cookie = venue.managerCookie) => app().request(PATH, { headers: { cookie } });
  const write = (body: unknown, cookie = venue.managerCookie) =>
    app().request(PATH, {
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

  it("answers no fixed language for Madrid", async () => {
    expect(await (await read()).json()).toEqual({
      language: "es-ES",
      choices: SPAIN_RECEIPT,
      fixed: null,
    });
  });

  it("refuses another language in Barcelona, naming the fixed one, and leaves the row alone", async () => {
    await at("Barcelona", ["ca-ES"], async () => {
      const response = await write({ language: "gl-ES" });
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
      expect((await write({ language: "gl-ES" })).status).toBe(204);
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
      expect((await write({ language: "es-ES" })).status).toBe(204);
      expect(await stored()).toEqual(["es-ES"]);
    });
  });

  it.each([
    ["a language the pack does not offer", { language: "en-GB" }],
    ["an empty language", { language: "" }],
    ["a number", { language: 12 }],
    ["a list", { language: ["gl-ES"] }],
    ["a body without the field", {}],
    ["a bare string", "gl-ES"],
    ["null", null],
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
      const response = await write({ language: "en-GB" });
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
      const refused = await write({ language: "gl-ES" });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe("receipt.language_fixed");
      expect(await stored()).toEqual(["es-ES"]);
      expect((await write({ language: "ca-ES" })).status).toBe(204);
      expect(await stored()).toEqual(["ca-ES"]);
    });
  });

  it("answers a stored language outside the choices as it is", async () => {
    await at("Madrid", ["en-GB"], async () => {
      expect((await (await read()).json()).language).toBe("en-GB");
    });
  });

  it("requires a session and configuration permission for reads and writes", async () => {
    expect((await app().request(PATH)).status).toBe(401);
    expect((await read(venue.staffCookie)).status).toBe(403);
    const anonymous = await app().request(PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "gl-ES" }),
    });
    expect(anonymous.status).toBe(401);
    expect((await write({ language: "gl-ES" }, venue.staffCookie)).status).toBe(403);
    expect(await stored()).toEqual(["es-ES"]);
  });

  it("refuses a read and a write when the configured location does not exist", async () => {
    const missing = app("no-such-location");
    const answers = [
      await missing.request(PATH, { headers: { cookie: venue.managerCookie } }),
      await missing.request(PATH, {
        method: "PUT",
        headers: { cookie: venue.managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ language: "gl-ES" }),
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
