import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getCountryPack } from "@waitron/country-packs";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import {
  endManagementSession,
  hashSessionToken,
  managementSessions,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import {
  mountInvoiceCustomerDataApi,
  type InvoiceCustomerDataDeps,
} from "./invoice-customer-data-api.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { ALL_MODULE_PERMISSIONS } from "./modules.js";
import {
  provisionInvoiceCustomerVenue,
  type InvoiceCustomerVenue,
} from "./testing/invoice-customer-fixture.js";

let fixture: InvoiceCustomerVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    fixture = await provisionInvoiceCustomerVenue(db);
  },
});

const SEARCH = "/management-api/invoice-customers/personal-data";
const DOWNLOAD = "/management-api/invoice-customers/personal-data/export";
const ROUTES = [SEARCH, DOWNLOAD] as const;
const logger = vi.fn();
/** A valid NIE on no invoice in the fixture. */
const UNKNOWN_VALID = "Y1234567X";
const stubPdf = () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

function mounted(patch: Partial<InvoiceCustomerDataDeps> = {}) {
  const app = new Hono();
  mountInvoiceCustomerDataApi(
    app,
    {
      db: suite.db,
      backend: fixture.venue.backend,
      till: fixture.venue.cfg,
      nodeId: fixture.venue.cfg.nodeId,
      venueLocale: "es-ES",
      render: stubPdf,
      onMirror: () => false,
      ...patch,
    },
    logger,
  );
  return app;
}
const ask = (path: string, cookie: string | null, patch: Partial<InvoiceCustomerDataDeps> = {}) =>
  mounted(patch).request(path, { headers: cookie === null ? {} : { cookie } });
const withTaxId = (path: string, taxId: string) => `${path}?taxId=${encodeURIComponent(taxId)}`;

async function refused(response: Response, status: number, error: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toEqual({ error });
}
const notPermitted = {
  code: "authorization.not_permitted",
  params: { permission: "personal_data.export" },
};
const sessionRequired = { code: "management_session.required", params: {} };

let ownAdmins = 0;
/** An administrator of the case's own, so changing them leaves the shared people alone. */
async function ownAdmin() {
  ownAdmins += 1;
  return withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: `Case Admin ${ownAdmins}`, role: "admin" })
      .returning({ id: persons.id });
    const { token } = await startManagementSession(tx, { personId: person!.id });
    return { id: person!.id, token, cookie: `${MANAGEMENT_COOKIE}=${token}` };
  });
}

async function readme(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return strFromU8(files["README.txt"]!);
}

beforeAll(() => {
  registerModulePermissions(ALL_MODULE_PERMISSIONS);
});

beforeEach(() => {
  logger.mockClear();
});

describe("the invoice customer search", () => {
  it("finds an administrator Jordi's three invoices however the number is typed", async () => {
    const response = await ask(withTaxId(SEARCH, "es 12345678z"), fixture.venue.adminDashboard);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const issued = (
      await suite.db.withWriteLock(async () =>
        suite.db.all<{ id: string; issued_at: string }>(sql`select id, issued_at from sales`),
      )
    ).reduce<Record<string, string>>((all, row) => ({ ...all, [row.id]: row.issued_at }), {});
    const { j1, j2, j3 } = fixture.sales;
    expect(await response.json()).toEqual({
      taxId: "12345678Z",
      invoices: [
        { invoice: "FF/1", issuedAt: issued[j1], name: "Jordi Puig", total: "48.35" },
        { invoice: "FF/3", issuedAt: issued[j2], name: "Jordi Puig Electrician", total: "112.40" },
        { invoice: "FF/6", issuedAt: issued[j3], name: "Jordi Puig Electrician", total: "23.95" },
      ],
    });
  });

  it("finds the company that shares Jordi's surname alone", async () => {
    const response = await ask(withTaxId(SEARCH, "B76543214"), fixture.venue.adminDashboard);
    expect(response.status).toBe(200);
    const [issued] = await suite.db.withWriteLock(async () =>
      suite.db.all<{ issued_at: string }>(
        sql`select issued_at from sales where id = ${fixture.sales.p1}`,
      ),
    );
    expect(await response.json()).toEqual({
      taxId: "B76543214",
      invoices: [
        {
          invoice: "FF/2",
          issuedAt: issued!.issued_at,
          name: "Puig Electrical Ltd",
          total: "310.07",
        },
      ],
    });
  });

  it("answers an unknown number with no invoices", async () => {
    expect(getCountryPack("ES")!.taxIdentifier!.validate(UNKNOWN_VALID).valid).toBe(true);
    const response = await ask(withTaxId(SEARCH, UNKNOWN_VALID), fixture.venue.adminDashboard);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taxId: "Y1234567X", invoices: [] });
  });
});

describe("both routes", () => {
  const callers = () =>
    ({
      manager: fixture.people.managerDashboard,
      supervisor: fixture.venue.supervisorDashboard,
      staff: fixture.venue.staffDashboard,
    }) as const;

  for (const route of ROUTES) {
    // A number on invoices and a valid one on none: a refused caller gets one answer for both,
    // and nothing is read or rendered for them.
    for (const taxId of ["12345678Z", UNKNOWN_VALID])
      it.each(["manager", "supervisor", "staff"] as const)(
        `refuses a %s asking for ${taxId} at ${route}, building nothing`,
        async (role) => {
          const render = vi.fn(stubPdf);
          const readDocument = vi.fn(readInvoiceDocument);
          await refused(
            await ask(withTaxId(route, taxId), callers()[role], { render, readDocument }),
            403,
            notPermitted,
          );
          expect(render).not.toHaveBeenCalled();
          expect(readDocument).not.toHaveBeenCalled();
        },
      );

    it(`checks the permission before the query at ${route}`, async () => {
      for (const query of ["?taxId=%%%", "?other=1"])
        await refused(
          await ask(`${route}${query}`, fixture.people.managerDashboard),
          403,
          notPermitted,
        );
    });

    it.each(["?other=1", "?taxId=1&taxId=2", "?taxId=12345678Z&other=1"])(
      `refuses an administrator's query %s at ${route} as the query`,
      async (query) => {
        await refused(await ask(`${route}${query}`, fixture.venue.adminDashboard), 400, {
          code: "management.request_invalid",
          params: { field: "query" },
        });
        expect(logger.mock.calls).toEqual([
          ["warn", "management.request_invalid", { field: "query", requestId: undefined }],
        ]);
      },
    );

    it.each(["", "?taxId=ES", "?taxId=12345678%C3%91"])(
      `refuses an administrator's tax number %s at ${route}, keeping it out of the log`,
      async (query) => {
        await refused(await ask(`${route}${query}`, fixture.venue.adminDashboard), 400, {
          code: "management.request_invalid",
          params: { field: "taxId" },
        });
        expect(logger.mock.calls).toEqual([
          ["warn", "management.request_invalid", { field: "taxId", requestId: undefined }],
        ]);
      },
    );

    it(`refuses a request with no cookie at ${route}`, async () => {
      await refused(await ask(withTaxId(route, "12345678Z"), null), 401, sessionRequired);
    });

    it(`refuses an ended session at ${route}`, async () => {
      const admin = await ownAdmin();
      await withTransaction(suite.db, (tx) => endManagementSession(tx, admin.token));
      await refused(await ask(withTaxId(route, "12345678Z"), admin.cookie), 401, sessionRequired);
    });

    it(`refuses a disabled administrator's live session at ${route}`, async () => {
      const admin = await ownAdmin();
      suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, admin.id)).run();
      await refused(await ask(withTaxId(route, "12345678Z"), admin.cookie), 403, {
        code: "person.suspended",
        params: { personId: admin.id },
      });
    });

    it(`refuses on a mirror before any other check at ${route}`, async () => {
      const readOnly = { code: "node.read_only", params: {} };
      const onMirror = () => true;
      await refused(
        await ask(withTaxId(route, "12345678Z"), fixture.venue.adminDashboard, { onMirror }),
        403,
        readOnly,
      );
      await refused(await ask(`${route}?other=1`, null, { onMirror }), 403, readOnly);
    });

    it(`answers on a node that is not a mirror at ${route}`, async () => {
      const response = await ask(withTaxId(route, "12345678Z"), fixture.venue.adminDashboard, {
        onMirror: () => false,
      });
      expect(response.status).toBe(200);
    });
  }
});

describe("the invoice customer download", () => {
  it("answers a number on no invoice as a missing customer", async () => {
    await refused(
      await ask(withTaxId(DOWNLOAD, UNKNOWN_VALID), fixture.venue.adminDashboard),
      404,
      {
        code: "invoice_customer.not_found",
        params: {},
      },
    );
  });

  it("changes no row, not the administrator's last-seen time nor a waiting change", async () => {
    const admin = await ownAdmin();
    suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(managementSessions.tokenHash, hashSessionToken(admin.token)))
      .run();
    suite.db.run(
      sql`insert into change_log (id, payload) values ('ic1', '{"resource":"zz","id":"1"}')`,
    );
    const lastSeen = () =>
      suite.db
        .select({ lastSeenAt: managementSessions.lastSeenAt })
        .from(managementSessions)
        .where(eq(managementSessions.tokenHash, hashSessionToken(admin.token)))
        .get()!.lastSeenAt;
    const changes = () => suite.db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
    const before = lastSeen();
    const changesBefore = changes();
    expect((await ask(withTaxId(SEARCH, "12345678Z"), admin.cookie)).status).toBe(200);
    const download = await ask(withTaxId(DOWNLOAD, "12345678Z"), admin.cookie);
    expect(download.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await download.arrayBuffer())))).toHaveLength(5);
    expect(lastSeen()).toBe(before);
    expect(changes()).toBe(changesBefore);
    expect(suite.db.all(sql`select id from change_log where id = 'ic1'`)).toEqual([{ id: "ic1" }]);
    expect(suite.db.all(sql`select id from invoice_pdf_downloads`)).toEqual([]);
  });

  for (const [venueLocale, language] of [
    ["es-ES", "es"],
    ["en-GB", "en"],
  ] as const) {
    it(`writes the README in the venue's language (${venueLocale})`, async () => {
      const text = await readme(
        await ask(withTaxId(DOWNLOAD, "12345678Z"), fixture.venue.adminDashboard, { venueLocale }),
      );
      expect(text.split("\n")[0]).toBe(
        PERSONAL_DATA_README_WORDS[language].title.replace("{venue}", "Tarjetas SL"),
      );
    });
  }

  it("writes the README in the venue's language, not the administrator's saved one", async () => {
    const text = await readme(
      await ask(withTaxId(DOWNLOAD, "12345678Z"), fixture.people.otherAdminDashboard, {
        venueLocale: "en-GB",
      }),
    );
    expect(text.split("\n")[0]).toBe(
      PERSONAL_DATA_README_WORDS.en.title.replace("{venue}", "Tarjetas SL"),
    );
  });

  it("checks the permission again after the PDFs, and sends nothing to a demoted admin", async () => {
    const admin = await ownAdmin();
    const render = async () => {
      await withTransaction(suite.db, async (tx) => {
        await tx.update(persons).set({ role: "manager" }).where(eq(persons.id, admin.id));
      });
      return stubPdf();
    };
    await refused(
      await ask(withTaxId(DOWNLOAD, "12345678Z"), admin.cookie, { render }),
      403,
      notPermitted,
    );
  });

  it("checks again after the PDFs, and sends nothing to an admin disabled meanwhile", async () => {
    const admin = await ownAdmin();
    const render = async () => {
      await withTransaction(suite.db, async (tx) => {
        await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, admin.id));
      });
      return stubPdf();
    };
    await refused(await ask(withTaxId(DOWNLOAD, "12345678Z"), admin.cookie, { render }), 403, {
      code: "person.suspended",
      params: { personId: admin.id },
    });
  });

  it("checks again after the PDFs, and sends nothing once the session has ended", async () => {
    const admin = await ownAdmin();
    const render = async () => {
      await withTransaction(suite.db, (tx) => endManagementSession(tx, admin.token));
      return stubPdf();
    };
    await refused(
      await ask(withTaxId(DOWNLOAD, "12345678Z"), admin.cookie, { render }),
      401,
      sessionRequired,
    );
  });
});
