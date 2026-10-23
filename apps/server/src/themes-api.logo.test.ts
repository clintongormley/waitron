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
  deleteImage,
  readCurrentImage,
  readCurrentImageMetadata,
  renderRendition,
  saveImage,
  uploadImage,
  type PreparedImage,
} from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import * as logoModule from "./receipt-logo.js";
import * as themeLogoModule from "./theme-logo.js";
import { mountThemesApi } from "./themes-api.js";
import { forgetVenueTheme } from "./venue-theme.js";

let managerCookie: string;
let supervisorCookie: string;
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
    [managerCookie, supervisorCookie, A, B, C] = await withTransaction(db, async (tx) => {
      const cookieFor = async (role: "manager" | "supervisor") => {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: role, role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: person!.id });
        return `${MANAGEMENT_COOKIE}=${session.token}`;
      };
      const cookies = [await cookieFor("manager"), await cookieFor("supervisor")];
      const names: string[] = [];
      for (const image of images) {
        names.push((await uploadImage(tx, { image, names: { en: "Logo" } })).image.filename);
      }
      return [...cookies, ...names] as [string, string, string, string, string];
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

const create = (body: unknown, cookie = managerCookie) =>
  app().request(PATH, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const save = (id: string, body: unknown, cookie = managerCookie) =>
  app().request(`${PATH}/${id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const refusal = (code: string, params: Record<string, unknown> = {}) => ({
  error: { code, params },
});

async function themeRows(): Promise<{ id: string; name: string; theme: string }[]> {
  const { rows } = await suite.db.execute<{ id: string; name: string; theme: string }>(
    sql`select id, name, theme from custom_themes order by id`,
  );
  return rows;
}

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

const ABSENT = `${"ab".repeat(32)}.webp`;

async function reframe(filename: string, zoom: number): Promise<unknown> {
  const current = await withTransaction(suite.db, (tx) => readCurrentImage(tx, filename));
  const rasters = await logoModule.drawLogoRasters(
    await renderRendition(current!.bytes, "display", { x: 5000, y: 5000, zoom }),
  );
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      current!.imageId,
      {
        names: { en: "Logo" },
        expectedRevision: current!.revision,
        framing: { x: 5000, y: 5000, zoom },
      },
      null,
      rasters,
      "en",
    ),
  );
  return JSON.parse(JSON.stringify(rasters));
}

async function revisionOf(filename: string): Promise<number> {
  const image = await withTransaction(suite.db, (tx) => readCurrentImageMetadata(tx, filename));
  return image!.revision;
}

describe("refusals", () => {
  it("refuses a logo naming no library image, and never draws", async () => {
    const { id } = await createdWithLogo();
    const before = await themeRows();
    const draw = vi.spyOn(logoModule, "drawLogoRasters");
    for (const [logo, field] of [
      [{ light: "logo.png" }, "logo.light"],
      [{ light: ABSENT }, "logo.light"],
      [{ light: "" }, "logo.light"],
      [{ light: B, dark: ABSENT }, "logo.dark"],
      [{ light: B, dark: "logo.png" }, "logo.dark"],
    ] as const) {
      const res = await save(id, { theme: { ...LEMON, logo } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        refusal("theme.invalid", { field, reason: "image_not_found" }),
      );
    }
    const res = await create({ name: "Lime", theme: { ...LEMON, logo: { light: ABSENT } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      refusal("theme.invalid", { field: "logo.light", reason: "image_not_found" }),
    );
    expect(draw).not.toHaveBeenCalled();
    expect(await themeRows()).toEqual(before);
  });

  it("refuses a version for dark screens without a main logo", async () => {
    const draw = vi.spyOn(logoModule, "drawLogoRasters");
    const res = await create({ name: "Lime", theme: { ...LEMON, logo: { dark: B } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      refusal("theme.invalid", { field: "logo.dark", reason: "dark_without_light" }),
    );
    expect(draw).not.toHaveBeenCalled();
    expect(await themeRows()).toEqual([]);
  });

  it("a supervisor is refused before anything is read or drawn", async () => {
    const { id } = await createdWithLogo();
    const before = await themeRows();
    const draw = vi.spyOn(logoModule, "drawLogoRasters");
    const theme = { ...LEMON, logo: { light: B } };
    for (const res of [
      await create({ name: "Lime", theme }, supervisorCookie),
      await save(id, { theme }, supervisorCookie),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(
        refusal("authorization.not_permitted", { permission: "layout.configure" }),
      );
    }
    const unknown = await save("no-such-theme", { theme });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(refusal("theme.not_found"));
    const reserved = await create({ name: "Waitron", theme });
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toEqual(
      refusal("theme.invalid", { field: "name", reason: "reserved" }),
    );
    expect(draw).not.toHaveBeenCalled();
    expect(await themeRows()).toEqual(before);
  });

  it("refuses a photo changed while its dots were drawn", async () => {
    const imageId = (await withTransaction(suite.db, (tx) => readCurrentImageMetadata(tx, A)))!
      .imageId;
    const draw = logoModule.drawLogoRasters;
    let reframed = false;
    vi.spyOn(logoModule, "drawLogoRasters").mockImplementation(async (bytes) => {
      if (!reframed) {
        reframed = true;
        await reframe(A, 120);
      }
      return draw(bytes);
    });
    const res = await create({ name: "Lemon", theme: { ...LEMON, logo: { light: A } } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(refusal("image.changed", { imageId }));
    expect(reframed).toBe(true);
    expect(await themeRows()).toEqual([]);
  });

  it("a kept-dots save refuses a reframe queued between its read and its write", async () => {
    const first = await create({ name: "Lemon", theme: { ...LEMON, logo: { light: A } } });
    const { id, choices } = (await first.json()) as { id: string; choices: ThemeChoices };
    const imageId = (await withTransaction(suite.db, (tx) => readCurrentImageMetadata(tx, A)))!
      .imageId;
    const real = themeLogoModule.printedLogoFor;
    let fresh: unknown;
    vi.spyOn(themeLogoModule, "printedLogoFor").mockImplementation(async (snapshot) => {
      const kept = await real(snapshot);
      fresh = await reframe(A, 130);
      return kept;
    });
    const revision = await revisionOf(A);
    const res = await save(id, {
      theme: { ...LEMON, brandColor: "#1e5b3a", logo: { light: A } },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(refusal("image.changed", { imageId }));
    expect(await revisionOf(A)).toBe(revision + 1);
    const stored = await storedTheme(id);
    expect({ ...stored, printedLogo: undefined }).toEqual({ ...choices, printedLogo: undefined });
    expect(stored.printedLogo).toEqual(fresh);
  });

  it("an image deleted between the read and the write is not found", async () => {
    const dark = await withTransaction(suite.db, async (tx) =>
      uploadImage(tx, { image: await samplePreparedImage({ width: 41 }), names: { en: "Dark" } }),
    );
    const first = await create({ name: "Lemon", theme: { ...LEMON, logo: { light: A } } });
    const { id } = (await first.json()) as { id: string };
    const before = await themeRows();
    const real = themeLogoModule.printedLogoFor;
    vi.spyOn(themeLogoModule, "printedLogoFor").mockImplementation(async (snapshot) => {
      const dots = await real(snapshot);
      const result = await withTransaction(suite.db, (tx) => deleteImage(tx, dark.image.id));
      expect(result.deleted).toBe(true);
      return dots;
    });
    const res = await save(id, {
      theme: { ...LEMON, logo: { light: A, dark: dark.image.filename } },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      refusal("theme.invalid", { field: "logo.dark", reason: "image_not_found" }),
    );
    expect(await themeRows()).toEqual(before);
  });

  it("a light image deleted between the read and the write is not found", async () => {
    const light = await withTransaction(suite.db, async (tx) =>
      uploadImage(tx, { image: await samplePreparedImage({ width: 42 }), names: { en: "Light" } }),
    );
    const { id } = await createdWithLogo();
    const before = await themeRows();
    const real = themeLogoModule.printedLogoFor;
    vi.spyOn(themeLogoModule, "printedLogoFor").mockImplementation(async (snapshot) => {
      const dots = await real(snapshot);
      const result = await withTransaction(suite.db, (tx) => deleteImage(tx, light.image.id));
      expect(result.deleted).toBe(true);
      return dots;
    });
    const res = await save(id, { theme: { ...LEMON, logo: { light: light.image.filename } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      refusal("theme.invalid", { field: "logo.light", reason: "image_not_found" }),
    );
    expect(await themeRows()).toEqual(before);
  });

  it("a save drawing a changed light image refuses a photo reframed while drawing", async () => {
    const { id } = await createdWithLogo();
    const before = await themeRows();
    const imageId = (await withTransaction(suite.db, (tx) => readCurrentImageMetadata(tx, B)))!
      .imageId;
    const draw = logoModule.drawLogoRasters;
    let reframed = false;
    vi.spyOn(logoModule, "drawLogoRasters").mockImplementation(async (bytes) => {
      if (!reframed) {
        reframed = true;
        await reframe(B, 125);
      }
      return draw(bytes);
    });
    const res = await save(id, { theme: { ...LEMON, logo: { light: B } } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(refusal("image.changed", { imageId }));
    expect(reframed).toBe(true);
    expect(await themeRows()).toEqual(before);
  });

  it("a light name that comes to name another library image while drawing is refused", async () => {
    const prepared = await samplePreparedImage({ width: 43 });
    const first = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: prepared, names: { en: "Light" } }),
    );
    const { id } = await createdWithLogo();
    const before = await themeRows();
    const real = themeLogoModule.printedLogoFor;
    let again: { id: string; filename: string; revision: number } | undefined;
    vi.spyOn(themeLogoModule, "printedLogoFor").mockImplementation(async (snapshot) => {
      const dots = await real(snapshot);
      again = await withTransaction(suite.db, async (tx) => {
        expect((await deleteImage(tx, first.image.id)).deleted).toBe(true);
        return (await uploadImage(tx, { image: prepared, names: { en: "Light" } })).image;
      });
      return dots;
    });
    const res = await save(id, { theme: { ...LEMON, logo: { light: first.image.filename } } });
    expect(again!.filename).toBe(first.image.filename);
    expect(again!.id).not.toBe(first.image.id);
    expect(again!.revision).toBe(first.image.revision);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(refusal("image.changed", { imageId: first.image.id }));
    expect(await themeRows()).toEqual(before);
  });
});
