import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS, contentLanguages } from "@waitron/catalogue";
import {
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import {
  MEDIA_MIGRATIONS,
  MEDIA_MODULE,
  mediaImages,
  mediaImageBlobs,
  uploadImage,
  prepareImage,
  saveImage,
  readCurrentImage,
} from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  departmentReceipts,
  departmentSalePolicies,
} from "@waitron/venue-service";
import { locationId, nodeId, type DepartmentReceiptWrite } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import { mountDepartmentReceiptSettingsApi } from "./department-receipt-api.js";
import * as logoModule from "./receipt-logo.js";
import { VENUE_SERVICE } from "./modules.js";
import { moduleCoreServices } from "./parties.js";
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
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Venue SL" });
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

describe("the fiscal seat's default description", () => {
  async function withoutStoredDescription(operationDescriptionDefault?: string) {
    const f = await fixture();
    if (operationDescriptionDefault !== undefined)
      f.cfg.operationDescriptionDefault = operationDescriptionDefault;
    await suite.db
      .delete(departmentReceipts)
      .where(eq(departmentReceipts.departmentId, f.departmentId));
    return f;
  }
  const read = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const response = await f.app.request(f.path, { headers: f.headers });
    expect(response.status).toBe(200);
    return ((await response.json()) as { receipt: { operationDescription?: string } }).receipt;
  };
  it("answers the default for a department with no stored description", async () => {
    const f = await withoutStoredDescription("Seat default");
    expect((await read(f)).operationDescription).toBe("Seat default");
  });
  it("answers a stored description over the default", async () => {
    const f = await fixture();
    f.cfg.operationDescriptionDefault = "Seat default";
    expect((await read(f)).operationDescription).toBe("Meals");
  });
  it("answers no description when there is neither a stored one nor a default", async () => {
    const f = await withoutStoredDescription();
    expect(await read(f)).not.toHaveProperty("operationDescription");
  });
  it("saving the untouched default stores it", async () => {
    const f = await withoutStoredDescription("Seat default");
    const shown = await read(f);
    expect((await f.put({ receipt: shown, policy })).status).toBe(204);
    expect((await rows()).receipts[0]!.receipt).toEqual({ operationDescription: "Seat default" });
    f.cfg.operationDescriptionDefault = "Another default";
    expect((await read(f)).operationDescription).toBe("Seat default");
  });
});

describe("replacement department receipt HTTP contract", () => {
  it.each([true, false])("reports the installed description field (%s)", async (withFiscal) => {
    const f = await fixture("manager", "manager", withFiscal);
    const response = await f.app.request(f.path, { headers: f.headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ operationDescriptionRequired: withFiscal });
  });

  it("returns policy and offered languages without dropping hidden stored text or adding venue defaults", async () => {
    const f = await fixture();
    const response = await f.app.request(f.path, { headers: f.headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      receipt: savedReceipt,
      policy,
      receiptLanguage: "gl-ES",
      operationDescriptionRequired: true,
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
  it("a description without a fiscal field round trips its readable 500-character bound", async () => {
    const f = await fixture("manager", "manager", false);
    const operationDescription = "x".repeat(500);
    expect((await f.put(body({ receipt: { operationDescription } }))).status).toBe(204);
    const read = await f.app.request(f.path, { headers: f.headers });
    expect(read.status).toBe(200);
    expect((await read.json()).receipt).toEqual({ operationDescription });
  });
  it.each(["x".repeat(501), "bad\u0000text"])(
    "a description without a fiscal field still refuses unreadable authored text %j",
    async (operationDescription) => {
      const f = await fixture("manager", "manager", false);
      const before = await rows();
      const response = await f.put(body({ receipt: { operationDescription } }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "receipt.invalid",
          params: { field: "operationDescription", reason: "invalid_description" },
        },
      });
      expect(await rows()).toEqual(before);
    },
  );
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

  async function splitPicture(reversed = false) {
    const pixels = Buffer.alloc(800 * 200 * 3);
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 800; x++) {
        const value = x < 400 !== reversed ? 255 : 0;
        pixels.fill(value, (y * 800 + x) * 3, (y * 800 + x + 1) * 3);
      }
    const bytes = await sharp(pixels, { raw: { width: 800, height: 200, channels: 3 } })
      .png()
      .toBuffer();
    return prepareImage(new Uint8Array(bytes), { maxUploadBytes: 20 * 1024 * 1024 });
  }
  it.each([false, true])(
    "settings prepares the current framed source (replacement=%s)",
    async (replacement) => {
      const f = await fixture();
      const original = await splitPicture();
      const { image } = await withTransaction(suite.db, (tx) =>
        uploadImage(tx, { image: original, names: { es: "Logo" } }),
      );
      const next = replacement ? await splitPicture(true) : null;
      await withTransaction(suite.db, (tx) =>
        saveImage(
          tx,
          image.id,
          {
            names: image.names,
            expectedRevision: image.revision,
            framing: { x: 7500, y: 5000, zoom: 200 },
          },
          next,
          undefined,
          "es",
        ),
      );
      expect(
        (
          await f.put(
            body({ receipt: { operationDescription: "Deli meals", logo: image.filename } }),
          )
        ).status,
      ).toBe(204);
      const rasters = (await rows()).receipts[0]!.logoRasters!;
      for (const width of ["58mm", "80mm"] as const) {
        expect(new Set(Buffer.from(rasters[width].data, "base64"))).toEqual(
          new Set([replacement ? 0 : 255]),
        );
      }
      expect((await rows()).receipts[0]!.receipt.logo).toBe(image.filename);
    },
  );

  it("refuses a photo revision changed during raster preparation without overwriting settings", async () => {
    const f = await fixture();
    const original = await splitPicture();
    const next = await splitPicture(true);
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: original, names: { es: "Logo" } }),
    );
    const before = await rows();
    const draw = logoModule.drawLogoRasters;
    vi.spyOn(logoModule, "drawLogoRasters").mockImplementation(async (bytes) => {
      await withTransaction(suite.db, (tx) =>
        saveImage(
          tx,
          image.id,
          {
            names: image.names,
            expectedRevision: image.revision,
            framing: { x: 5000, y: 5000, zoom: 100 },
          },
          next,
          undefined,
          "es",
        ),
      );
      return draw(bytes);
    });
    await refusal(
      await f.put(body({ receipt: { operationDescription: "New meals", logo: image.filename } })),
      409,
      "image.changed",
      { imageId: image.id },
    );
    expect(await rows()).toEqual(before);
  });

  it("a kept-raster shortcut refuses a replacement queued between its snapshot and final write", async () => {
    const f = await fixture();
    const source = await splitPicture();
    const replacement = await splitPicture(true);
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: source, names: { es: "Logo" } }),
    );
    expect(
      (await f.put(body({ receipt: { operationDescription: "Deli meals", logo: image.filename } })))
        .status,
    ).toBe(204);
    const rasters = await logoModule.drawLogoRasters(replacement.bytes);
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = VENUE_SERVICE.readDepartmentLogoRasters;
    vi.spyOn(VENUE_SERVICE, "readDepartmentLogoRasters").mockImplementation(async (...args) => {
      const result = await read(...args);
      entered();
      await gate;
      return result;
    });
    const saving = f.put(
      body({ receipt: { operationDescription: "Stale meals", logo: image.filename } }),
    );
    await ready;
    const updating = withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        image.id,
        { names: image.names, framing: image.framing, expectedRevision: image.revision },
        replacement,
        rasters,
        "es",
      ),
    );
    release();
    await updating;
    const afterPhoto = await rows();
    await refusal(await saving, 409, "image.changed", { imageId: image.id });
    expect(await rows()).toEqual(afterPhoto);
    expect((await rows()).receipts[0]!.receipt.operationDescription).toBe("Deli meals");
    expect((await rows()).receipts[0]!.logoRasters).toEqual(rasters);
  });

  function mediaRoute(
    f: Awaited<ReturnType<typeof fixture>>,
    render: (bytes: Uint8Array) => ReturnType<typeof logoModule.drawLogoRasters>,
  ) {
    registerModulePermissions([
      ...(MEDIA_MODULE.permissions ?? []),
      { permission: "venue_service.manage", grantedFrom: "manager" },
    ]);
    const app = new Hono();
    MEDIA_MODULE.routes!.mount(
      app,
      {
        db: suite.db,
        cfg: { locationId: f.cfg.locationId, contentDefaultLanguage: "es" },
        core: moduleCoreServices(f.cfg, []),
        renderReceiptLogo: render,
      },
      () => {},
    );
    return app;
  }
  function replacementForm(
    image: { names: Record<string, string>; revision: number },
    bytes: Uint8Array,
  ) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "replacement.webp", { type: "image/webp" }));
    form.set("names", JSON.stringify(image.names));
    form.set("framing", JSON.stringify({ x: 5000, y: 5000, zoom: 100 }));
    form.set("expectedRevision", String(image.revision));
    return form;
  }

  it.each(["preparation", "write"] as const)(
    "a %s failure rolls the photo and every receipt raster back through HTTP",
    async (failure) => {
      const f = await fixture();
      const source = await splitPicture();
      const next = await splitPicture(true);
      const { image } = await withTransaction(suite.db, (tx) =>
        uploadImage(tx, { image: source, names: { es: "Logo" } }),
      );
      expect(
        (
          await f.put(
            body({ receipt: { operationDescription: "Deli meals", logo: image.filename } }),
          )
        ).status,
      ).toBe(204);
      const before = await rows();
      const beforePhoto = await readCurrentImage(suite.db, image.filename);
      const beforeBlobs = await suite.db.select().from(mediaImageBlobs);
      const mediaApp = mediaRoute(
        f,
        failure === "preparation"
          ? async () => {
              throw new Error("test render refused");
            }
          : logoModule.drawLogoRasters,
      );
      if (failure === "write")
        await suite.db.execute(
          sql`create trigger refuse_photo_edit before update on media_image_edits begin select raise(abort, 'test edit refused'); end`,
        );
      try {
        const response = await mediaApp.request(`/management-api/images/${image.id}`, {
          method: "PATCH",
          headers: { cookie: f.headers.cookie },
          body: replacementForm(image, next.bytes),
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { code: "server.internal" } });
        expect(await rows()).toEqual(before);
        expect(await readCurrentImage(suite.db, image.filename)).toEqual(beforePhoto);
        expect(await suite.db.select().from(mediaImageBlobs)).toEqual(beforeBlobs);
      } finally {
        if (failure === "write")
          await suite.db.execute(sql`drop trigger if exists refuse_photo_edit`);
      }
    },
  );

  it("photo HTTP save refreshes only the final matching logo choices after attach, clear and switch during preparation", async () => {
    const f = await fixture();
    const source = await splitPicture();
    const replacement = await splitPicture(true);
    const other = await samplePreparedImage({ width: 51, height: 12 });
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: source, names: { es: "Logo" } }),
    );
    const { image: otherImage } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: other, names: { es: "Other" } }),
    );
    expect(
      (await f.put(body({ receipt: { operationDescription: "Deli meals", logo: image.filename } })))
        .status,
    ).toBe(204);
    const rasters = (await rows()).receipts[0]!.logoRasters!;
    const otherRasters = await logoModule.drawLogoRasters(other.bytes);
    const [retained] = await suite.db
      .insert(departments)
      .values({
        locationId: f.cfg.locationId,
        name: "Retained",
        tradingName: "Retained",
        active: false,
      })
      .returning();
    const [attached] = await suite.db
      .insert(departments)
      .values({ locationId: f.cfg.locationId, name: "Attached", tradingName: "Attached" })
      .returning();
    await suite.db.insert(departmentReceipts).values([
      { departmentId: retained!.id, receipt: { logo: image.filename }, logoRasters: rasters },
      { departmentId: attached!.id, receipt: {} },
    ]);
    let prepared: Awaited<ReturnType<typeof logoModule.drawLogoRasters>> | undefined;
    const mediaApp = mediaRoute(f, async (bytes) => {
      prepared = await logoModule.drawLogoRasters(bytes);
      await withTransaction(suite.db, async (tx) => {
        await tx
          .update(departmentReceipts)
          .set({ receipt: { operationDescription: "Deli meals" }, logoRasters: null })
          .where(eq(departmentReceipts.departmentId, f.departmentId));
        await tx
          .update(departmentReceipts)
          .set({ receipt: { logo: otherImage.filename }, logoRasters: otherRasters })
          .where(eq(departmentReceipts.departmentId, retained!.id));
        await tx
          .update(departmentReceipts)
          .set({ receipt: { logo: image.filename }, logoRasters: rasters })
          .where(eq(departmentReceipts.departmentId, attached!.id));
      });
      return prepared;
    });
    const response = await mediaApp.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: { cookie: f.headers.cookie },
      body: replacementForm(image, replacement.bytes),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).image).toMatchObject({
      id: image.id,
      filename: image.filename,
      sourceFilename: replacement.filename,
      revision: image.revision + 1,
    });
    const receipts = (await rows()).receipts;
    expect(receipts.find((row) => row.departmentId === f.departmentId)!.logoRasters).toBeNull();
    expect(receipts.find((row) => row.departmentId === retained!.id)!).toMatchObject({
      receipt: { logo: otherImage.filename },
      logoRasters: otherRasters,
    });
    expect(receipts.find((row) => row.departmentId === attached!.id)!).toMatchObject({
      receipt: { logo: image.filename },
      logoRasters: prepared,
    });
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
