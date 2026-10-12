import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS, contentLanguages } from "@waitron/catalogue";
import {
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MEDIA_MIGRATIONS, mediaImages, uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  departmentReceipts,
  departmentSalePolicies,
} from "@waitron/venue-service";
import { locationId, nodeId, seriesId, type DepartmentReceiptWrite } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import { mountDepartmentReceiptSettingsApi } from "./department-receipt-api.js";
import * as logoModule from "./receipt-logo.js";
import type { TillConfig } from "./till-config.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    MEDIA_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
});
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
const policy = { receiptPrintMode: "auto", printTradingName: true } as const;
const savedReceipt = {
  operationDescription: "Meals",
  footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Antes" },
};
afterEach(() => {
  vi.restoreAllMocks();
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
});
async function fixture(
  role: "manager" | "staff" = "manager",
  managementFloor: "manager" | "admin" = "manager",
  withFiscal = true,
) {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: managementFloor }]);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: randomUUID(),
      invoiceLocales: ["gl-ES"],
      operationDescription: "Bootstrap",
      addressLine1: "Calle Uno 1",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    })
    .returning();
  const cfg: TillConfig = {
    locationId: locationId(location!.id),
    nodeId: nodeId(randomUUID()),
    seriesId: seriesId(randomUUID()),
    locale: "es-ES",
    invoiceLocales: ["gl-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  await suite.db
    .insert(contentLanguages)
    .values({ defaultLanguage: "es", languages: ["es", "ca", "en"] });
  const [department] = await suite.db
    .insert(departments)
    .values({ locationId: cfg.locationId, name: randomUUID(), tradingName: "Deli" })
    .returning();
  await suite.db.insert(departmentSalePolicies).values({ departmentId: department!.id, ...policy });
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId: department!.id, receipt: savedReceipt });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: randomUUID(), role })
    .returning();
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  const app = new Hono();
  mountDepartmentReceiptSettingsApi(
    app,
    {
      db: suite.db,
      venueCfg: () => cfg,
      ...(withFiscal ? { validateOperationDescription: fiscal.validateOperationDescription } : {}),
    },
    () => {},
  );
  const path = `/management-api/venue-service/departments/${department!.id}/receipt`;
  const headers = {
    cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
    "content-type": "application/json",
  };
  return {
    app,
    path,
    headers,
    cfg,
    departmentId: department!.id,
    personId: person!.id,
    put: (body: unknown) =>
      app.request(path, { method: "PUT", headers, body: JSON.stringify(body) }),
  };
}
const body = (extra: Partial<DepartmentReceiptWrite> = {}): DepartmentReceiptWrite => ({
  receipt: { operationDescription: "Deli meals" },
  policy,
  ...extra,
});
async function rows() {
  return {
    receipts: await suite.db.select().from(departmentReceipts),
    policies: await suite.db.select().from(departmentSalePolicies),
  };
}
async function refusal(
  response: Response,
  status: number,
  code: string,
  params: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, params } });
}
async function libraryImage() {
  const image = await samplePreparedImage({ width: 48, height: 12, format: "png" });
  return (
    await withTransaction(suite.db, (tx) => uploadImage(tx, { image, names: { es: "Logo" } }))
  ).image.filename;
}

describe("replacement department receipt HTTP contract", () => {
  it("returns policy and offered languages without dropping hidden stored text or adding venue defaults", async () => {
    const f = await fixture();
    const response = await f.app.request(f.path, { headers: f.headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      receipt: savedReceipt,
      policy,
      receiptLanguage: "gl-ES",
      languages: ["gl-ES", "es-ES", "ca-ES"],
      warningLanguages: ["gl-ES", "ca-ES"],
      venueAddress: ["Calle Uno 1", "28013 Madrid"],
    });
  });
  it("saves receipt and policy together and retains unchanged hidden text", async () => {
    const f = await fixture();
    const input = body({
      receipt: {
        operationDescription: "Deli meals",
        printAddress: true,
        footerMessage: { "eu-ES": "Eskerrik asko", "es-ES": "Gracias" },
      },
      policy: { receiptPrintMode: "on_request", printTradingName: false },
    });
    expect((await f.put(input)).status).toBe(204);
    const saved = await rows();
    expect(saved.receipts[0]!.receipt).toEqual(input.receipt);
    expect(saved.policies[0]).toMatchObject(input.policy);
  });
  it("allows decoration changes without policy permission and refuses a policy change atomically", async () => {
    const f = await fixture("manager", "admin");
    expect((await f.put(body())).status).toBe(204);
    const before = await rows();
    await refusal(
      await f.put(body({ policy: { ...policy, printTradingName: false } })),
      403,
      "authorization.not_permitted",
      { permission: "venue_service.manage" },
    );
    expect(await rows()).toEqual(before);
  });
  it.each(["", " ", "x".repeat(501), "bad\u0000text"])(
    "refuses a submitted fiscal description %j before writes",
    async (description) => {
      const f = await fixture();
      const before = await rows();
      await refusal(
        await f.put(body({ receipt: { operationDescription: description } })),
        400,
        "management.request_invalid",
        { field: "operationDescription" },
      );
      expect(await rows()).toEqual(before);
    },
  );
  it("allows an empty authored receipt when no fiscal description contribution is installed", async () => {
    const f = await fixture("manager", "manager", false);
    expect((await f.put(body({ receipt: {} }))).status).toBe(204);
    expect((await rows()).receipts[0]!.receipt).toEqual({});
  });
  it.each([{ receipt: {} }, { ...body(), extra: true }, { ...body(), policy: null }])(
    "refuses a malformed envelope %j",
    async (input) => {
      const f = await fixture();
      const before = await rows();
      const response = await f.put(input);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid" },
      });
      expect(await rows()).toEqual(before);
    },
  );
  it("refuses changed hidden translations without overwriting the stored receipt", async () => {
    const f = await fixture();
    const before = await rows();
    await refusal(
      await f.put(
        body({
          receipt: { operationDescription: "Deli meals", footerMessage: { "eu-ES": "Changed" } },
        }),
      ),
      400,
      "receipt.invalid",
      { reason: "invalid_language", field: "footerMessage", language: "eu-ES" },
    );
    expect(await rows()).toEqual(before);
  });
  it("retains saved printable rasters without decoding a kept logo", async () => {
    const f = await fixture();
    const logo = await libraryImage();
    expect(
      (await f.put(body({ receipt: { operationDescription: "Deli meals", logo } }))).status,
    ).toBe(204);
    const before = (await rows()).receipts[0]!.logoRasters;
    const decode = vi
      .spyOn(logoModule, "drawLogoRasters")
      .mockRejectedValue(new Error("must reuse saved pictures"));
    expect(
      (await f.put(body({ receipt: { operationDescription: "More meals", logo } }))).status,
    ).toBe(204);
    expect((await rows()).receipts[0]!.logoRasters).toEqual(before);
    expect(decode).not.toHaveBeenCalled();
  });
  it.each(["permission", "department", "languages", "policy", "hidden-text", "image"])(
    "rechecks %s after logo decoding and preserves the concurrent change",
    async (kind) => {
      const f = await fixture("manager", kind === "policy" ? "admin" : "manager");
      const logo = await libraryImage();
      const input = body({
        receipt: {
          operationDescription: "Deli meals",
          logo,
          footerMessage: { "eu-ES": "Eskerrik asko", "ca-ES": "Benvinguts" },
        },
      });
      const original = logoModule.drawLogoRasters;
      let concurrent: Awaited<ReturnType<typeof rows>> | undefined;
      vi.spyOn(logoModule, "drawLogoRasters").mockImplementation(async (bytes) => {
        await withTransaction(suite.db, async (tx) => {
          if (kind === "permission")
            await tx.update(persons).set({ role: "staff" }).where(eq(persons.id, f.personId));
          if (kind === "department")
            await tx
              .update(departments)
              .set({ active: false })
              .where(eq(departments.id, f.departmentId));
          if (kind === "languages")
            await tx.update(contentLanguages).set({ languages: ["es", "en"] });
          if (kind === "policy")
            await tx
              .update(departmentSalePolicies)
              .set({ printTradingName: false })
              .where(eq(departmentSalePolicies.departmentId, f.departmentId));
          if (kind === "hidden-text")
            await tx
              .update(departmentReceipts)
              .set({ receipt: { ...savedReceipt, footerMessage: { "eu-ES": "New hidden text" } } })
              .where(eq(departmentReceipts.departmentId, f.departmentId));
          if (kind === "image") await tx.delete(mediaImages).where(eq(mediaImages.filename, logo));
        });
        concurrent = await rows();
        return original(bytes);
      });
      const response = await f.put(input);
      if (kind === "permission" || kind === "policy")
        await refusal(response, 403, "authorization.not_permitted", {
          permission: kind === "permission" ? "layout.configure" : "venue_service.manage",
        });
      if (kind === "department")
        await refusal(response, 404, "department.not_found", { departmentId: f.departmentId });
      if (kind === "languages" || kind === "hidden-text")
        await refusal(response, 400, "receipt.invalid", {
          reason: "invalid_language",
          field: "footerMessage",
          language: kind === "languages" ? "ca-ES" : "eu-ES",
        });
      if (kind === "image")
        await refusal(response, 400, "receipt.invalid", {
          reason: "image_not_found",
          field: "logo",
        });
      expect(concurrent).toBeDefined();
      expect(await rows()).toEqual(concurrent);
    },
  );
  it.each(["deleted", "other-location"])(
    "refuses %s departments for both methods without writing",
    async (kind) => {
      const f = await fixture();
      if (kind === "deleted")
        await suite.db
          .update(departments)
          .set({ active: false })
          .where(eq(departments.id, f.departmentId));
      else {
        const [other] = await suite.db
          .insert(locations)
          .values({
            name: "Other",
            invoiceLocales: ["es-ES"],
            operationDescription: "Other bootstrap",
          })
          .returning();
        f.cfg.locationId = locationId(other!.id);
      }
      const before = await rows();
      await refusal(
        await f.app.request(f.path, { headers: f.headers }),
        404,
        "department.not_found",
        { departmentId: f.departmentId },
      );
      await refusal(await f.put(body()), 404, "department.not_found", {
        departmentId: f.departmentId,
      });
      expect(await rows()).toEqual(before);
    },
  );
  it("refuses an unknown logo and never begins decoding", async () => {
    const f = await fixture();
    const before = await rows();
    const decode = vi.spyOn(logoModule, "drawLogoRasters");
    await refusal(
      await f.put(
        body({ receipt: { operationDescription: "Deli meals", logo: `${"a".repeat(64)}.png` } }),
      ),
      400,
      "receipt.invalid",
      { reason: "image_not_found", field: "logo" },
    );
    expect(decode).not.toHaveBeenCalled();
    expect(await rows()).toEqual(before);
  });
  it("does not decode a logo for a policy change without permission", async () => {
    const f = await fixture("manager", "admin");
    const logo = await libraryImage();
    const before = await rows();
    const decode = vi.spyOn(logoModule, "drawLogoRasters");
    await refusal(
      await f.put(
        body({
          receipt: { operationDescription: "Deli meals", logo },
          policy: { ...policy, printTradingName: false },
        }),
      ),
      403,
      "authorization.not_permitted",
      { permission: "venue_service.manage" },
    );
    expect(decode).not.toHaveBeenCalled();
    expect(await rows()).toEqual(before);
  });
  it("saves a 500-character fiscal description without substituting or trimming it", async () => {
    const f = await fixture();
    const description = " " + "x".repeat(498) + " ";
    expect((await f.put(body({ receipt: { operationDescription: description } }))).status).toBe(
      204,
    );
    expect((await rows()).receipts[0]!.receipt).toEqual({ operationDescription: description });
  });
  it("requires a real authorised session for reads and writes", async () => {
    const f = await fixture("staff");
    await refusal(await f.app.request(f.path), 401, "management_session.required", {});
    await refusal(
      await f.app.request(f.path, { headers: f.headers }),
      403,
      "authorization.not_permitted",
      { permission: "layout.configure" },
    );
    await refusal(await f.put(body()), 403, "authorization.not_permitted", {
      permission: "layout.configure",
    });
  });
});
