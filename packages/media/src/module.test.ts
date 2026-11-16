import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION, CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { uploadImage } from "./images.js";
import { MEDIA_CONFIGURATION_TRANSFER, MEDIA_MODULE, MEDIA_TABLES } from "./module.js";
import { samplePreparedImage } from "./testing/sample-image.js";

/** This module's share of core's classification, which holds its tables. */
const MEDIA_CLASSIFICATION = CORE_CLASSIFICATION.filter(({ table }) =>
  (MEDIA_TABLES as readonly string[]).includes(table),
);

// Boot hands every descriptor seat to generic code (`apps/server/src/boot.ts`), so each case goes
// through the DESCRIPTOR rather than the function it names: a seat left empty or pointed at the
// wrong thing fails here and nowhere else.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});

it("exports picture bytes before their metadata", () => {
  expect(MEDIA_CLASSIFICATION).toEqual([
    expect.objectContaining({ table: "media_images", class: "state" }),
    expect.objectContaining({ table: "media_blobs", class: "state" }),
  ]);
  expect(MEDIA_CONFIGURATION_TRANSFER.tables).toEqual([
    { name: "media_blobs", before: ["media_images"] },
    { name: "media_images", before: ["products", "sections", "section_members"] },
  ]);
});

describe("the media module descriptor", () => {
  it("refuses a configuration bundle whose image bytes do not match their filename", () => {
    const transfer = MEDIA_MODULE.configurationTransfer;
    const validate = transfer?.kind === "tables" ? transfer.validate : undefined;
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
    const bundle = (filename: string) => ({
      media_images: [
        {
          id: "image-a",
          filename,
          original_hash: filename.slice(0, 64),
          source_hash: null,
          focus_x: 5000,
          focus_y: 5000,
          zoom: 100,
          revision: 1,
          original_filename: null,
          names: JSON.stringify({ en: "Bread" }),
        },
      ],
      media_blobs: [
        {
          hash: createHash("sha256").update(bytes).digest("hex"),
          format: "jpg",
          bytes: `\\x${bytes.toString("hex")}`,
        },
      ],
    });
    const context = {
      createdAt: new Date("2026-10-20T12:00:00Z"),
      country: "GB",
      area: null,
      timeZone: "Europe/London",
      dayCutover: "05:00",
      contentLanguages: { defaultLanguage: "en", languages: ["en"] },
      holidayArea: null,
    };
    const matching = `${createHash("sha256").update(bytes).digest("hex")}.jpg`;
    expect(() => validate?.(bundle(matching), context)).not.toThrow();
    expect(() => validate?.(bundle(`${"0".repeat(64)}.jpg`), context)).toThrow(
      expect.objectContaining({ code: "image.invalid_metadata" }),
    );
  });

  it("lets a manager into the image library and keeps staff and supervisors out", async () => {
    registerModulePermissions(MEDIA_MODULE.permissions!);
    await seedTaxpayer(suite.db);
    const app = new Hono();
    MEDIA_MODULE.routes!.mount(
      app,
      {
        db: suite.db,
        cfg: {},
        core: {
          floorPlanSets: {
            copyLayouts: () => Promise.reject(new Error("unused floor plan sets")),
            readLayouts: () => Promise.reject(new Error("unused floor plan sets")),
            zonesShowing: () => Promise.reject(new Error("unused floor plan sets")),
          },
          floorDeletion: {
            removeSets: async () => {},
            readImpact: async () => {
              throw new Error("unused floor deletion");
            },
            clear: async () => {
              throw new Error("unused floor deletion");
            },
          },
          seatTable: async () => {
            throw new Error("unused");
          },
        },
      },
      () => {},
    );
    const statusFor = async (role: "staff" | "supervisor" | "manager") => {
      const [person] = await seedPersons(suite.db, {
        displayName: role,
        pinHash: hashPin("1234"),
        role,
      });
      const session = await suite.db.transaction((tx) =>
        startManagementSession(tx, { method: "password", personId: person!.id }),
      );
      const response = await app.request("/management-api/images", {
        headers: { Cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
      });
      return response.status;
    };
    expect(await statusFor("staff")).toBe(403);
    expect(await statusFor("supervisor")).toBe(403);
    expect(await statusFor("manager")).toBe(200);
  });

  it("reports a photo with no name in a candidate default language as a translation gap", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(
        tx,
        {
          image: await samplePreparedImage({ width: 8 }),
          names: { en: "Bread" },
        },
        { fallbackLanguage: "en" },
      );
      const gaps = MEDIA_MODULE.contentTranslations!.gaps;
      expect(await gaps(tx, "fr")).toEqual([{ kind: "image", id: image.id }]);
      expect(await gaps(tx, "en")).toEqual([]);
    });
  });
});
