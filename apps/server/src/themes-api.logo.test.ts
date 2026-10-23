import sharp from "sharp";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import {
  MEDIA_MIGRATIONS,
  prepareImage,
  readCurrentImage,
  renderRendition,
  uploadImage,
  type PreparedImage,
} from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import * as logoModule from "./receipt-logo.js";
import { mountThemesApi } from "./themes-api.js";
import { forgetVenueTheme } from "./venue-theme.js";

let managerCookie: string;
let A: string;
let B: string;
let C: string;

async function splitPicture(reversed: boolean): Promise<PreparedImage> {
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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    MEDIA_MIGRATIONS,
  ],
  setup: async (db) => {
    await seedTenant(db);
    const images = [await splitPicture(false), await splitPicture(true)];
    images.push(await samplePreparedImage({ width: 40 }));
    [managerCookie, A, B, C] = await withTransaction(db, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "manager", role: "manager" })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: person!.id });
      const names: string[] = [];
      for (const image of images) {
        names.push((await uploadImage(tx, { image, names: { en: "Logo" } })).image.filename);
      }
      return [`${MANAGEMENT_COOKIE}=${session.token}`, ...names] as [
        string,
        string,
        string,
        string,
      ];
    });
  },
});

beforeEach(async () => {
  await suite.db.execute(sql`delete from custom_themes`);
  forgetVenueTheme();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PATH = "/management-api/themes";

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  logo: null,
  handSet: { light: {}, dark: {} },
};

function app(): Hono {
  const hono = new Hono();
  mountThemesApi(hono, { db: suite.db }, () => {});
  return hono;
}

const create = (body: unknown) =>
  app().request(PATH, {
    method: "POST",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const save = (id: string, body: unknown) =>
  app().request(`${PATH}/${id}`, {
    method: "PUT",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function storedTheme(id: string): Promise<Record<string, unknown>> {
  const rows = await suite.db.execute<{ theme: string }>(
    sql`select theme from custom_themes where id = ${id}`,
  );
  return JSON.parse(rows.rows[0]!.theme) as Record<string, unknown>;
}

async function expected(filename: string): Promise<unknown> {
  const current = await withTransaction(suite.db, (tx) => readCurrentImage(tx, filename));
  const rasters = await logoModule.drawLogoRasters(
    await renderRendition(current!.bytes, "display", current!.framing),
  );
  return JSON.parse(JSON.stringify(rasters));
}

async function createdWithLogo(): Promise<{ id: string; choices: ThemeChoices }> {
  const response = await create({
    name: "Lemon",
    theme: { ...LEMON, logo: { light: A, dark: B } },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; choices: ThemeChoices };
}

describe("a theme's logo dots", () => {
  it("a new theme with a logo stores the dots of its light image", async () => {
    const answer = await createdWithLogo();
    expect(answer.choices.logo).toEqual({ light: A, dark: B });
    expect(Object.keys(answer.choices)).not.toContain("printedLogo");
    expect((await storedTheme(answer.id)).printedLogo).toEqual(await expected(A));
  });

  it("a copy of a theme with a logo draws its own dots", async () => {
    const first = await createdWithLogo();
    const copy = await create({ name: "Lemon copy", theme: first.choices });
    expect(copy.status).toBe(201);
    const { id } = (await copy.json()) as { id: string };
    const dots = await expected(A);
    expect((await storedTheme(first.id)).printedLogo).toEqual(dots);
    expect((await storedTheme(id)).printedLogo).toEqual(dots);
  });

  it("keeping the light image keeps the dots without drawing", async () => {
    const { id } = await createdWithLogo();
    const before = (await storedTheme(id)).printedLogo;
    const draw = vi.spyOn(logoModule, "drawLogoRasters").mockRejectedValue(new Error("must keep"));
    const recoloured = await save(id, {
      theme: { ...LEMON, brandColor: "#1e5b3a", logo: { light: A, dark: B } },
    });
    expect(recoloured.status).toBe(200);
    const redarkened = await save(id, {
      theme: { ...LEMON, brandColor: "#1e5b3a", logo: { light: A, dark: C } },
    });
    expect(redarkened.status).toBe(200);
    expect(draw).not.toHaveBeenCalled();
    const stored = await storedTheme(id);
    expect(stored.printedLogo).toEqual(before);
    expect(stored.logo).toEqual({ light: A, dark: C });
  });

  it("changing the light image draws again", async () => {
    const { id } = await createdWithLogo();
    const saved = await save(id, { theme: { ...LEMON, logo: { light: B } } });
    expect(saved.status).toBe(200);
    const dots = await expected(B);
    expect(dots).not.toEqual(await expected(A));
    expect((await storedTheme(id)).printedLogo).toEqual(dots);
  });

  it("removing the logo removes the dots", async () => {
    const { id } = await createdWithLogo();
    const draw = vi.spyOn(logoModule, "drawLogoRasters");
    const removed = await save(id, { theme: LEMON });
    expect(removed.status).toBe(200);
    expect(await storedTheme(id)).toEqual(LEMON);

    const { logo: _, ...noLogo } = LEMON;
    void _;
    const second = (await (
      await create({ name: "Lime", theme: { ...LEMON, logo: { light: A } } })
    ).json()) as { id: string };
    const absent = await save(second.id, { theme: noLogo });
    expect(absent.status).toBe(200);
    expect(await storedTheme(second.id)).toEqual(LEMON);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
