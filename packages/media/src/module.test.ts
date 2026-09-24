import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId } from "@waitron/shared";
import { uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_MODULE } from "./module.js";
import { samplePreparedImage } from "./testing/sample-image.js";

// Boot hands every descriptor seat to generic code (`apps/server/src/boot.ts`), so each case goes
// through the DESCRIPTOR rather than the function it names: a seat left empty or pointed at the
// wrong thing fails here and nowhere else.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
});

describe("the media module descriptor", () => {
  it("refuses a configuration bundle whose image bytes do not match their filename", () => {
    const transfer = MEDIA_MODULE.configurationTransfer;
    const validate = transfer?.kind === "tables" ? transfer.validate : undefined;
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
    const bundle = (filename: string) => ({
      content_languages: [{ default_language: "en" }],
      media_images: [
        {
          id: "image-a",
          filename,
          names: JSON.stringify({ en: "Bread" }),
          alt_text: JSON.stringify({ en: "Loaf" }),
          labels: JSON.stringify([]),
        },
      ],
      media_image_data: [{ image_id: "image-a", bytes: `\\x${bytes.toString("hex")}` }],
    });
    const matching = `${createHash("sha256").update(bytes).digest("hex")}.jpg`;
    expect(() => validate?.(bundle(matching))).not.toThrow();
    expect(() => validate?.(bundle(`${"0".repeat(64)}.jpg`))).toThrow(
      expect.objectContaining({ code: "image.invalid_metadata" }),
    );
  });

  it("lets a manager into the image library and keeps staff and supervisors out", async () => {
    registerModulePermissions(MEDIA_MODULE.permissions!);
    await seedTenant(suite.db);
    const app = new Hono();
    MEDIA_MODULE.routes!.mount(
      app,
      {
        db: suite.db,
        cfg: { locationId: locationId("00000000-0000-4000-8000-000000000001") },
        core: {
          openTab: async () => {
            throw new Error("unused");
          },
        },
      },
      () => {},
    );
    const statusFor = async (role: "staff" | "supervisor" | "manager") => {
      const [person] = await suite.db
        .insert(persons)
        .values({ displayName: role, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      const session = await suite.db.transaction((tx) =>
        startManagementSession(tx, { personId: person!.id }),
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
          altText: {},
          labels: [],
        },
        { fallbackLanguage: "en" },
      );
      const gaps = MEDIA_MODULE.contentTranslations!.gaps;
      expect(await gaps(tx, "fr")).toEqual([{ kind: "image", id: image.id }]);
      expect(await gaps(tx, "en")).toEqual([]);
    });
  });
});
