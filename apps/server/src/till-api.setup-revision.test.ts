import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { customThemes, deviceProfiles, withTransaction } from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { Hono } from "hono";
import { readCurrentImage, renderRendition, saveImage, uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createServiceZone, setProfileServiceAccess } from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { createCourse, updateCourse } from "./kitchen.js";
import { drawLogoRasters } from "./receipt-logo.js";
import { mountThemesApi } from "./themes-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  WAITRON_THEME_ANSWER,
  forgetVenueTheme,
  readVenueThemeSource,
  venueThemeAnswer,
} from "./venue-theme.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill,
} from "./testing/signed-in-till.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  logo: null,
  handSet: { light: {}, dark: {} },
};

const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a" };

beforeEach(() => {
  forgetVenueTheme();
});

async function storeTheme(name: string, theme: ThemeChoices, inUse: boolean): Promise<string> {
  const [row] = await suite.db
    .insert(customThemes)
    .values({ name, nameKey: name.toLowerCase(), inUse: inUse ? 1 : null, theme })
    .returning({ id: customThemes.id });
  return row!.id;
}

async function putInUse(id: string): Promise<void> {
  await suite.db.update(customThemes).set({ inUse: null }).where(eq(customThemes.inUse, 1));
  await suite.db.update(customThemes).set({ inUse: 1 }).where(eq(customThemes.id, id));
}

async function hashInUse(): Promise<string> {
  return venueThemeAnswer(await withTransaction(suite.db, readVenueThemeSource)).hash;
}

async function apiThemeHash(): Promise<unknown> {
  const app = new Hono();
  mountThemesApi(app, { db: suite.db }, () => {});
  const answer = await app.request("/api/theme");
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { hash: unknown }).hash;
}

async function uploadLogo(): Promise<string> {
  const image = await samplePreparedImage({ width: 40 });
  return withTransaction(suite.db, async (tx) => {
    const uploaded = await uploadImage(tx, { image, names: { es: "Logo" } });
    return uploaded.image.filename;
  });
}

async function reframe(filename: string, zoom: number): Promise<void> {
  const current = await withTransaction(suite.db, (tx) => readCurrentImage(tx, filename));
  const framing = { x: 5000, y: 5000, zoom };
  const rasters = await drawLogoRasters(await renderRendition(current!.bytes, "display", framing));
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      current!.imageId,
      { names: { es: "Logo" }, expectedRevision: current!.revision, framing },
      null,
      rasters,
      "en",
    ),
  );
}

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(72_000_000 + ++nifCounter);

async function setupTill() {
  return provisionSignedInTill(suite.db, {
    taxId: nextNif(),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const departmentId = await createBareDepartment(tx, cfg, "Restaurant", new Date());
      const zone = await createServiceZone(tx, cfg, { name: "Barra", departmentId });
      return { departmentId, startingZoneId: zone.id };
    },
  });
}

type Till = Awaited<ReturnType<typeof setupTill>>;

/** A second device in the same venue, on a profile of its own that times out after 300 s. */
async function secondDeviceOnOwnProfile(till: Till) {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Till ${randomUUID()}`,
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
      inactivityTimeoutSeconds: 300,
    })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    setProfileServiceAccess(tx, till.cfg, profile!.id, {
      departmentId: till.departmentId,
      allowedZoneIds: null,
      startingZoneId: till.startingZoneId,
    }),
  );
  const device = await enrolDeviceForTest(suite.db, till.cfg, {
    name: `Till ${randomUUID()}`,
    profileId: profile!.id,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: till.personId, pin: "5555" }),
  );
  return {
    profileId: profile!.id,
    till: {
      app: till.app,
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
  };
}

async function startRevision(till: Pick<Till, "app" | "cookie">): Promise<unknown> {
  const answer = await sendAsTill(till, "GET", "/api/till");
  expect(answer.status).toBe(200);
  return answer.body.setupRevision;
}

async function menuStateRevision(till: Pick<Till, "app" | "cookie">): Promise<unknown> {
  const answer = await sendAsTill(till, "GET", "/api/menu-state");
  expect(answer.status).toBe(200);
  return answer.body.setupRevision;
}

describe("the till's setup revision", () => {
  it("the start read and menu-state name the same setup revision for one till", async () => {
    const till = await setupTill();
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(typeof start.body.setupRevision).toBe("string");
    expect(await menuStateRevision(till)).toBe(start.body.setupRevision);
  });

  it("the revision stays while nothing changes", async () => {
    const till = await setupTill();
    const first = await menuStateRevision(till);
    expect(typeof first).toBe("string");
    expect(await menuStateRevision(till)).toBe(first);
  });

  it("the revision moves when a course is added and when one is renamed", async () => {
    const till = await setupTill();
    const seen = [await menuStateRevision(till)];
    const course = await withTransaction(suite.db, (tx) =>
      createCourse(tx, till.cfg, { name: "Entrantes" }),
    );
    seen.push(await menuStateRevision(till));
    await withTransaction(suite.db, (tx) =>
      updateCourse(tx, till.cfg, course.id, { name: "Primeros" }),
    );
    seen.push(await menuStateRevision(till));
    expect(seen.every((revision) => typeof revision === "string")).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("two devices on different profiles name different revisions, which meet once the profiles match", async () => {
    const first = await setupTill();
    const second = await secondDeviceOnOwnProfile(first);
    const firstRevision = await startRevision(first);
    const secondRevision = await startRevision(second.till);
    expect(typeof firstRevision).toBe("string");
    expect(typeof secondRevision).toBe("string");
    expect(secondRevision).not.toBe(firstRevision);
    expect(await menuStateRevision(first)).toBe(firstRevision);
    expect(await menuStateRevision(second.till)).toBe(secondRevision);
    await suite.db
      .update(deviceProfiles)
      .set({ inactivityTimeoutSeconds: null })
      .where(eq(deviceProfiles.id, second.profileId));
    expect(await startRevision(second.till)).toBe(firstRevision);
    expect(await menuStateRevision(second.till)).toBe(firstRevision);
  });

  it("switching the theme in use moves the revision, and themeHash is /api/theme's hash", async () => {
    const till = await setupTill();
    const waitron = await sendAsTill(till, "GET", "/api/till");
    expect(waitron.status).toBe(200);
    expect(waitron.body.themeHash).toBe(WAITRON_THEME_ANSWER.hash);
    const lemonId = await storeTheme("Lemon", LEMON, true);
    const greenId = await storeTheme("Dark green", DARK_GREEN, false);
    const lemon = await sendAsTill(till, "GET", "/api/till");
    expect(lemon.body.themeHash).toBe(await hashInUse());
    expect(lemon.body.themeHash).not.toBe(WAITRON_THEME_ANSWER.hash);
    expect(lemon.body.setupRevision).not.toBe(waitron.body.setupRevision);
    await putInUse(greenId);
    const green = await sendAsTill(till, "GET", "/api/till");
    expect(green.body.themeHash).toBe(await hashInUse());
    expect(green.body.themeHash).not.toBe(lemon.body.themeHash);
    expect(green.body.setupRevision).not.toBe(lemon.body.setupRevision);
    await putInUse(lemonId);
    expect(await startRevision(till)).toBe(lemon.body.setupRevision);
  });

  it("saving the theme in use with new choices moves the revision", async () => {
    const till = await setupTill();
    const lemonId = await storeTheme("Lemon", LEMON, true);
    const before = await sendAsTill(till, "GET", "/api/till");
    await suite.db
      .update(customThemes)
      .set({ theme: { ...LEMON, brandColor: "#1e5b3a" } })
      .where(eq(customThemes.id, lemonId));
    const after = await sendAsTill(till, "GET", "/api/till");
    expect(after.body.themeHash).toBe(await hashInUse());
    expect(after.body.themeHash).not.toBe(before.body.themeHash);
    expect(after.body.setupRevision).not.toBe(before.body.setupRevision);
    expect(await menuStateRevision(till)).toBe(after.body.setupRevision);
  });

  it("saving a theme that is not in use leaves the revision", async () => {
    const till = await setupTill();
    await storeTheme("Lemon", LEMON, true);
    const greenId = await storeTheme("Dark green", DARK_GREEN, false);
    const before = await startRevision(till);
    await suite.db
      .update(customThemes)
      .set({ theme: { ...DARK_GREEN, corners: "square" } })
      .where(eq(customThemes.id, greenId));
    expect(await startRevision(till)).toBe(before);
    expect(await menuStateRevision(till)).toBe(before);
  });

  it("the menu-state poll's revision is the start read's", async () => {
    const till = await setupTill();
    await storeTheme("Lemon", LEMON, true);
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.body.themeHash).toBe(await hashInUse());
    expect(start.body.themeHash).not.toBe(WAITRON_THEME_ANSWER.hash);
    expect(await menuStateRevision(till)).toBe(start.body.setupRevision);
  });

  it("reframing the logo's image in the library moves the revision on the next menu-state poll", async () => {
    const till = await setupTill();
    const logo = await uploadLogo();
    await storeTheme("Lemon", { ...LEMON, logo: { light: logo } }, true);
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(start.body.themeHash).toBe(await apiThemeHash());
    await reframe(logo, 140);
    const moved = await menuStateRevision(till);
    expect(moved).not.toBe(start.body.setupRevision);
    const after = await sendAsTill(till, "GET", "/api/till");
    expect(after.body.setupRevision).toBe(moved);
    expect(after.body.themeHash).not.toBe(start.body.themeHash);
    expect(after.body.themeHash).toBe(await apiThemeHash());
    expect(await menuStateRevision(till)).toBe(moved);
  });

  it.each([
    "{broken",
    '{"tokens":{}}',
    '{"brandColor":null,"brandFix":{},"background":"neutral","corners":"standard","handSet":{"light":{},"dark":{}},"logo":"a.webp"}',
  ])("a stored document this release cannot use still answers the start read: %s", async (text) => {
    const till = await setupTill();
    await suite.db.run(
      sql`insert into custom_themes (id, name, name_key, in_use, theme, updated_at)
            values ('5d9f0a8e-1c2b-4e3d-8f4a-6b7c8d9e0f1a', 'Stored', 'stored', 1, ${text},
                    '2026-10-21T00:00:00.000Z')`,
    );
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(start.body.themeHash).toBe(WAITRON_THEME_ANSWER.hash);
    expect(await menuStateRevision(till)).toBe(start.body.setupRevision);
  });

  it("the lemon brand (#f2d300) in use answers the lemon's hash", async () => {
    const till = await setupTill();
    const id = await storeTheme("Lemon", LEMON, true);
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(start.body.themeHash).toBe(
      venueThemeAnswer({ inUse: { id, choices: LEMON }, logo: null }).hash,
    );
  });
});
