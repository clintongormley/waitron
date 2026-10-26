import sharp from "sharp";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import * as media from "@waitron/media";
import {
  MEDIA_MIGRATIONS,
  prepareImage,
  readCurrentImage,
  renderRendition,
  saveImage,
  uploadImage,
  type PreparedImage,
} from "@waitron/media";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { countBlackDots, drawLogoRasters } from "./receipt-logo.js";
import { mountThemesApi, type ThemeLogoPrint } from "./themes-api.js";
import { forgetVenueTheme } from "./venue-theme.js";

let managerCookie: string;
let supervisorCookie: string;
let staffCookie: string;
let A: string;
let CIRCLE: string;
let SPECK: string;

async function prepared(bytes: Buffer): Promise<PreparedImage> {
  return prepareImage(new Uint8Array(bytes), { maxUploadBytes: 20 * 1024 * 1024 });
}

async function splitPicture(): Promise<PreparedImage> {
  const pixels = Buffer.alloc(800 * 200 * 3);
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 800; x++) {
      const value = x < 400 ? 255 : 0;
      pixels.fill(value, (y * 800 + x) * 3, (y * 800 + x + 1) * 3);
    }
  return prepared(
    await sharp(pixels, { raw: { width: 800, height: 200, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

/** A white circle on a see-through background, as probe P2 drew it. */
async function whiteCircle(): Promise<PreparedImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="180" fill="#ffffff"/></svg>`;
  return prepared(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** A white picture holding one black square, large enough to survive the dither. */
async function blackSpeck(): Promise<PreparedImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#ffffff"/><rect x="190" y="190" width="20" height="20" fill="#000000"/></svg>`;
  return prepared(await sharp(Buffer.from(svg)).png().toBuffer());
}

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    MEDIA_MIGRATIONS,
  ],
});
const images = [await splitPicture(), await whiteCircle(), await blackSpeck()];

// Every row is emptied after each case, so each one starts from these images unframed.
beforeEach(async () => {
  forgetVenueTheme();
  await seedTenant(suite.db);
  [managerCookie, supervisorCookie, staffCookie, A, CIRCLE, SPECK] = await withTransaction(
    suite.db,
    async (tx) => {
      const cookieFor = async (role: "manager" | "supervisor" | "staff") => {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: role, role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: person!.id });
        return `${MANAGEMENT_COOKIE}=${session.token}`;
      };
      const cookies = [
        await cookieFor("manager"),
        await cookieFor("supervisor"),
        await cookieFor("staff"),
      ];
      const names: string[] = [];
      for (const image of images) {
        names.push((await uploadImage(tx, { image, names: { en: "Logo" } })).image.filename);
      }
      return [...cookies, ...names] as [string, string, string, string, string, string];
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function app(): Hono {
  const hono = new Hono();
  mountThemesApi(hono, { db: suite.db }, () => {});
  return hono;
}

const askOn = (hono: Hono, query: string, cookie = managerCookie) =>
  hono.request(`/management-api/theme-logo-print?${query}`, { headers: { cookie } });
const ask = (query: string, cookie = managerCookie) => askOn(app(), query, cookie);

const refusal = (code: string, params: Record<string, unknown> = {}) => ({
  error: { code, params },
});

async function rows(): Promise<unknown[]> {
  const imageRows = await suite.db.execute(sql`select * from media_images order by id`);
  const themes = await suite.db.execute(sql`select * from custom_themes order by id`);
  return [imageRows.rows, themes.rows];
}

describe("GET /management-api/theme-logo-print", () => {
  it("draws the image as an 80 mm receipt draws it", async () => {
    const current = await withTransaction(suite.db, (tx) => readCurrentImage(tx, A));
    const expected = (
      await drawLogoRasters(await renderRendition(current!.bytes, "display", current!.framing))
    )["80mm"];
    const res = await ask(`image=${A}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ThemeLogoPrint;
    expect(body.paperDots).toBe(504);
    expect(body.picture).toEqual(expected);
    expect(body.blackDots).toBe(
      countBlackDots({
        widthDots: expected.widthDots,
        heightDots: expected.heightDots,
        bits: Buffer.from(expected.data, "base64"),
      }),
    );
    expect(body.blackDots).toBeGreaterThan(0);
  });

  it("a white logo on a see-through background prints blank", async () => {
    const body = (await (await ask(`image=${CIRCLE}`)).json()) as ThemeLogoPrint;
    expect(body.picture).not.toBeNull();
    expect(body.blackDots).toBe(0);
  });

  it("one dot is not blank", async () => {
    const body = (await (await ask(`image=${SPECK}`)).json()) as ThemeLogoPrint;
    expect(body.picture).not.toBeNull();
    expect(body.blackDots).toBeGreaterThan(0);
  });

  it("a supervisor may read; staff are refused", async () => {
    expect((await ask(`image=${A}`, supervisorCookie)).status).toBe(200);
    const res = await ask(`image=${A}`, staffCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      refusal("authorization.not_permitted", { permission: "venue.view" }),
    );
  });

  it("no session is refused", async () => {
    const res = await app().request(`/management-api/theme-logo-print?image=${A}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal("management_session.required"));
  });

  it.each(["", "image=", "image=../x.png", "image=A&image=A", "other=A"])(
    "refuses %s",
    async (query) => {
      const res = await ask(query.replaceAll("=A", `=${A}`));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal("management.request_invalid", { field: "image" }));
    },
  );

  it("an image the library does not have draws nothing", async () => {
    const res = await ask(`image=${"c".repeat(64)}.png`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paperDots: 504, picture: null, blackDots: 0 });
  });

  it("an image whose source bytes are gone draws nothing", async () => {
    await suite.db.execute(sql`delete from media_image_data`);
    await suite.db.execute(sql`delete from media_image_blobs`);
    const res = await ask(`image=${A}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paperDots: 504, picture: null, blackDots: 0 });
  });

  it("an image whose source bytes do not decode draws nothing", async () => {
    await suite.db.execute(sql`update media_image_data set bytes = ${new Uint8Array([1, 2, 3])}`);
    await suite.db.execute(sql`update media_image_blobs set bytes = ${new Uint8Array([1, 2, 3])}`);
    const res = await ask(`image=${A}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paperDots: 504, picture: null, blackDots: 0 });
  });

  it("asking again draws nothing more; a reframe draws again", async () => {
    const decode = vi.spyOn(media, "decodeLogoGreyscale");
    const hono = app();
    const first = (await (await askOn(hono, `image=${A}`)).json()) as ThemeLogoPrint;
    await askOn(hono, `image=${A}`);
    expect(decode).toHaveBeenCalledTimes(1);

    const current = await withTransaction(suite.db, (tx) => readCurrentImage(tx, A));
    await withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        current!.imageId,
        {
          names: { en: "Logo" },
          expectedRevision: current!.revision,
          framing: { x: 3000, y: 5000, zoom: 200 },
        },
        null,
        undefined,
        "en",
      ),
    );
    const again = (await (await askOn(hono, `image=${A}`)).json()) as ThemeLogoPrint;
    expect(decode).toHaveBeenCalledTimes(2);
    expect(again.picture!.data).not.toBe(first.picture!.data);
  });

  it("writes nothing", async () => {
    const before = await rows();
    expect((await ask(`image=${A}`)).status).toBe(200);
    expect(await rows()).toEqual(before);
  });
});
