import { setTipsForTest } from "./testing/payment-settings.js";
import { departmentCourses } from "@waitron/db";
import { seedDeviceProfiles, seedVenueSettings } from "@waitron/db/testing/seed.js";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, floorZones, kitchenCourses, writeNodeMembership } from "@waitron/db";
import { SUPPORTED_LOCALES, decimal } from "@waitron/shared";
import type { PaymentProvider } from "@waitron/payments";
import { mountTillApi } from "./till-api.js";
import { resolveCardCollector } from "./till-card-collector.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import "./errors.js";
import {
  cfg,
  anna,
  abel,
  venueTaxId,
  suite,
  collect,
  deps,
  enrolTillDeviceCookie,
  seedDeviceProfile,
} from "./testing/till-api.test-support.js";

describe("GET /api/staff (pre-login roster) + GET /api/till (public boot info)", () => {
  it("omits the retired venue mode from public boot info", async () => {
    const app = new Hono();
    mountTillApi(app, { ...deps(suite.db), cfg: { ...cfg } }, collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("orderFlow");
  });

  it("GET /api/staff lists ACTIVE staff sorted by name, no cookie required, no secrets", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie at all — the lock screen calls this before any session exists.
    const res = await app.request("/api/staff");
    expect(res.status).toBe(200);
    const staff = await res.json();
    // Sorted by displayName (Abel before Anna, though Abel was inserted second), suspended Zoe absent.
    expect(staff).toEqual([
      { personId: abel.id, displayName: "Abel" },
      { personId: anna.id, displayName: "Anna" },
    ]);
    // The roster carries the login id + display name only — nothing a customer or a bystander at the
    // lock screen must not see (no pin material, no role, no status).
    expect(JSON.stringify(staff)).not.toMatch(/pin|secret|password|url|cert|role|status|hash/i);
  });

  it("GET /api/till returns locale + issuer identity + card fields, and no secret", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      locale: "es-ES",
      clockingAvailable: false,
      // The RECEIPT locale — the venue's first `invoice_locales` entry, DISTINCT from the UI `locale`
      // above (both es-ES for this ES venue, but sourced from different fields — the decoupling test below
      // drives them apart).
      invoiceLocale: "es-ES",
      // The offered receipt languages: with no content languages saved, the receipt language alone.
      receiptLanguages: ["es-ES"],
      onboardingIntent: "prepare",
      venueName: "Test SL",
      nif: venueTaxId,
      // The venue's ACTIVE kitchen courses — the seeded venue has none, so `[]` reaches
      // the wire (the tab course picker offers nothing then).
      courses: [],
      // Cookieless: no device → no reader to resolve → `none`; the venue has no readers configured.
      cardProvider: "none",
      activeReaders: [],
      sumUpConnected: false,
      tipsEnabled: false,
      formFactor: "till",
      // A cookieless request has no device profile, so no capabilities.
      capabilities: [],
      // The auto-logout timeout also rides the profile: no profile → null (the app default).
      inactivityTimeoutSeconds: null,
      // The node this till is talking to, and the venue's routable server list — empty here because
      // `node_membership` holds no row (the server-list test below writes one and removes it again).
      nodeId: cfg.nodeId,
      servers: [],
      membership: null,
      setupRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      // This suite's configuration carries no regime limit.
      simplifiedInvoiceLimit: null,
      fullInvoices: true,
      takeawayVat: true,
      themeHash: "e5b913bdac6111b271019fdd50363b9b68977f24809cb00fb7a0cb54c2e72146",
    });
    // Nothing sensitive: no pin, certificate, connection string or AEAT verification url reaches the
    // wire. `verificationUrl` is named exactly rather than a bare `url`, because `servers[].url` is a
    // BY-DESIGN wire key (the address the till is told to dial) that a bare alternative would trip on.
    expect(JSON.stringify(body)).not.toMatch(/pin|secret|password|verificationUrl|cert/i);
  });

  it("GET /api/till carries the regime's simplified-invoice limit, so the basket can refuse at entry", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cfg: { ...cfg, simplifiedInvoiceLimit: decimal("3010.00") } },
      collect([]),
    );
    const body = (await (await app.request("/api/till")).json()) as Record<string, unknown>;
    expect(body.simplifiedInvoiceLimit).toBe("3010.00");
  });

  it("GET /api/till lists the venue's servers from the membership document, primary first, evicted and address-less nodes excluded", async () => {
    const app = new Hono();
    // The route reads `node_membership` itself, so the document goes into the DATABASE. Removed in the
    // `finally` below: every other test in this suite asserts `servers: []` off an empty table, so a
    // leftover row would make those pass or fail on this test's ordering (CLAUDE.md §4).
    await writeNodeMembership(
      suite.db,
      signedMembershipDoc(5, {
        signerNodeId: cfg.nodeId,
        nodes: [
          { nodeId: "b", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
          { nodeId: "c", contactUrl: "https://old.deli.test", standing: "evicted" },
          { nodeId: "d", contactUrl: "", standing: "sell-only" },
          { nodeId: "e", contactUrl: "https://spare.deli.test", standing: "sell-only" },
          { nodeId: cfg.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
        ],
      }),
    );
    try {
      mountTillApi(app, deps(suite.db), collect([]));
      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nodeId).toBe(cfg.nodeId);
      expect(body.servers).toEqual([
        { nodeId: cfg.nodeId, url: "https://box.deli.test", standing: "serving-primary" },
        { nodeId: "b", url: "https://cloud.deli.test", standing: "serving-secondary" },
        { nodeId: "e", url: "https://spare.deli.test", standing: "sell-only" },
      ]);
    } finally {
      await suite.db.execute(sql`delete from node_membership`);
    }
  });

  describe("membership", () => {
    it("the start read carries the held chart", async () => {
      const app = new Hono();
      const held = signedMembershipDoc(7, {
        signerNodeId: cfg.nodeId,
        nodes: [
          { nodeId: cfg.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
        ],
      });
      // Removed in the `finally`: the other start-read cases assert an empty `node_membership`.
      await writeNodeMembership(suite.db, held);
      try {
        mountTillApi(app, deps(suite.db), collect([]));
        const body = (await (await app.request("/api/till")).json()) as Record<string, unknown>;
        expect(body.membership).toEqual(held);
      } finally {
        await suite.db.execute(sql`delete from node_membership`);
      }
    });
  });

  it("GET /api/till DECOUPLES the UI locale (venueLocale) from the receipt invoiceLocale (the venue's receipt language)", async () => {
    // Drive the venue's saved receipt language, `cfg.locale` and `venueLocale` (display) APART to
    // prove the route reads each from its own source: the wire `locale` (UI) must follow
    // `venueLocale`, and `invoiceLocale` (the printed legal receipt's language) must follow the
    // venue's first `invoice_locales` entry — NEVER the UI's venue default.
    // A supported `ca-ES` is dropped by the UI venue-default derivation to `es-ES`, so binding the
    // receipt to `venueLocale` would flip a Catalan receipt to Spanish. Restored in `finally`, as the
    // venue row is shared.
    await suite.db.execute(
      sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["ca-ES"]')) where module = 'venue'`,
    );
    try {
      const app = new Hono();
      mountTillApi(
        app,
        { ...deps(suite.db), cfg: { ...cfg, locale: "gl-ES" }, venueLocale: "en-GB" },
        collect([]),
      );

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      expect((await res.json()) as { locale: string; invoiceLocale: string }).toMatchObject({
        locale: "en-GB",
        invoiceLocale: "ca-ES",
      });
    } finally {
      await suite.db.execute(
        sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["es-ES"]')) where module = 'venue'`,
      );
    }
  });

  it("GET /api/locales returns the supported list + the venue default, no session required", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie — the till app fetches the language catalogue before any session exists.
    const res = await app.request("/api/locales", {
      headers: { "Accept-Language": "en-GB,en;q=0.9" },
    });
    expect(res.status).toBe(200);
    // The static catalogue verbatim (es-ES + en-GB) plus the geography-derived default for this ES
    // venue (`deps.venueLocale`, es-ES).
    expect(await res.json()).toEqual({
      locales: SUPPORTED_LOCALES,
      venueDefault: "es-ES",
      loginDefault: "en-GB",
    });
    expect(res.headers.get("Vary")).toBe("Accept-Language");
  });

  it("GET /api/locales falls back to the venue language when the browser has no installed match", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/locales", {
      headers: { "Accept-Language": "fr-FR,ja;q=0.8" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).loginDefault).toBe("es-ES");
  });

  it("GET /api/till reads the saved tips switch", async () => {
    await setTipsForTest(suite.db, true);
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ cardProvider: "none", tipsEnabled: true });
  });

  it("GET /api/till surfaces the local simulator selected by boot", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      {
        ...deps(suite.db),
        cardProvider: { provider: "simulator" } as PaymentProvider,
      },
      collect([]),
    );
    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cardProvider: "simulator" });
  });

  it("offers practice without a hardware reader", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cardProvider: { provider: "simulator" } as PaymentProvider },
      collect([]),
    );
    const body = await (await app.request("/api/till")).json();
    expect(body.cardProvider).toBe("simulator");
    expect(body.activeReaders).toEqual([]);
  });

  it("uses the instant simulator and refuses a hardware reader in practice", async () => {
    const simulator = { provider: "simulator" } as PaymentProvider;
    const practice = { ...deps(suite.db), cardProvider: simulator };
    expect(await resolveCardCollector(practice, undefined, undefined)).toEqual({
      provider: simulator,
    });
    await expect(resolveCardCollector(practice, undefined, randomUUID())).rejects.toMatchObject({
      code: "reader.not_found",
    });
  });

  it("GET /api/till echoes the venue's ACTIVE kitchen courses in display order", async () => {
    // Seed two courses out of display order, plus a deactivated one, to prove the boot read
    // returns the ACTIVE ones sorted by `display_order` (the coursing sequence the tab picker
    // offers) and drops the retired one. Cleaned up in `finally` so the shared venue's default `[]`
    // case stays order-independent.
    await suite.db.insert(kitchenCourses).values([
      { name: "Postres", displayOrder: 2, active: true },
      {
        name: "Entrantes",
        displayOrder: 1,
        active: true,
      },
      { name: "Retirado", displayOrder: 0, active: false },
    ]);
    const [zone] = await suite.db
      .select({ id: floorZones.id, departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.active, true));
    const [starter] = await suite.db
      .select({ id: kitchenCourses.id })
      .from(kitchenCourses)
      .where(eq(kitchenCourses.name, "Entrantes"));
    await suite.db
      .insert(departmentCourses)
      .values({ departmentId: zone!.departmentId, courseId: starter!.id, heldUntilFired: false });
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { courses: { name: string; displayOrder: number }[] };
      // Active-only, by display_order: Entrantes (1) before Postres (2); the deactivated Retirado absent.
      expect(body.courses).toEqual([
        { id: expect.any(String), name: "Entrantes", displayOrder: 1, fireNowZoneIds: [zone!.id] },
        { id: expect.any(String), name: "Postres", displayOrder: 2, fireNowZoneIds: [] },
      ]);
    } finally {
      await suite.db.execute(sql`delete from kitchen_courses`);
    }
  });

  it("GET /api/till omits authored receipt state and the retired layout field", async () => {
    {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("receipt");
      expect(body).not.toHaveProperty("venueAddress");
      expect(body).not.toHaveProperty("layout");
    }
  });

  it("GET /api/till keeps current address, authored trim and raster changes out of boot", async () => {
    await seedVenueSettings(suite.db, {
      addressLine1: "Calle Mayor 1",
      postalCode: "28013",
      city: "Madrid",
    });
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const boot = async () =>
        (await (await app.request("/api/till")).json()) as {
          receipt: unknown;
          venueAddress: unknown;
        };

      expect(await boot()).not.toHaveProperty("receipt");
      expect(await boot()).not.toHaveProperty("venueAddress");

      expect(await boot()).not.toHaveProperty("receipt");
      expect(await boot()).not.toHaveProperty("venueAddress");
    } finally {
      await seedVenueSettings(suite.db, { addressLine1: null, postalCode: null, city: null });
    }
  });

  it("GET /api/till surfaces the device form factor and profile capabilities", async () => {
    const deviceProfileId = await seedDeviceProfile(
      suite.db,
      "Counter",
      ["integrated-card-payment", "open-cash-drawer"],
      300,
    );
    try {
      const cookie = await enrolTillDeviceCookie(suite.db, deviceProfileId);
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        formFactor: unknown;
        capabilities: unknown;
        inactivityTimeoutSeconds: unknown;
      };
      expect(body.formFactor).toBe("till");
      expect(body).not.toHaveProperty("canvas");
      // The profile's capabilities, as the explicit sibling.
      expect(body.capabilities).toEqual(["integrated-card-payment", "open-cash-drawer"]);
      // The profile's auto-logout timeout, mirrored onto the boot payload like `capabilities`.
      expect(body.inactivityTimeoutSeconds).toBe(300);
      expect(body).not.toHaveProperty("receipt");
      expect(body).not.toHaveProperty("venueAddress");
      expect(body).not.toHaveProperty("layout");
    } finally {
      await suite.db.execute(
        sql`delete from devices where id not in (select device_id from till_sessions)`,
      );
      await suite.db.execute(
        sql`delete from device_profiles where id not in (select device_profile_id from devices)`,
      );
    }
  });

  it("retains the profile capabilities and null timeout without canvas selection", async () => {
    const deviceProfileId = await seedDeviceProfile(suite.db, "Default+caps", ["open-cash-drawer"]);
    try {
      const cookie = await enrolTillDeviceCookie(suite.db, deviceProfileId);
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        formFactor: unknown;
        capabilities: unknown;
        inactivityTimeoutSeconds: unknown;
      };
      expect(body.formFactor).toBe("till");
      expect(body).not.toHaveProperty("canvas");
      expect(body.capabilities).toEqual(["open-cash-drawer"]);
      // This profile was seeded with no timeout, so the boot payload carries null (the app default).
      expect(body.inactivityTimeoutSeconds).toBeNull();
    } finally {
      await suite.db.execute(
        sql`delete from devices where id not in (select device_id from till_sessions)`,
      );
      await suite.db.execute(
        sql`delete from device_profiles where id not in (select device_profile_id from devices)`,
      );
    }
  });

  it("returns the till form factor and empty capabilities for the default enrolled profile", async () => {
    const cookie = await enrolTillDeviceCookie(suite.db, null);
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    try {
      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        formFactor: unknown;
        capabilities: unknown;
        inactivityTimeoutSeconds: unknown;
      };
      expect(body.formFactor).toBe("till");
      expect(body).not.toHaveProperty("canvas");
      expect(body.capabilities).toEqual([]);
      // No profile → no timeout resolved, so the boot payload carries null (the app default).
      expect(body.inactivityTimeoutSeconds).toBeNull();
      expect(body).not.toHaveProperty("receipt");
      expect(body).not.toHaveProperty("venueAddress");
      expect(body).not.toHaveProperty("layout");
    } finally {
      await suite.db.execute(
        sql`delete from devices where id not in (select device_id from till_sessions)`,
      );
    }
  });

  it("returns the till form factor and empty capabilities without a device cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/till"); // no cookie header
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("formFactor", "till");
    expect(body).not.toHaveProperty("canvas");
    expect((body as { capabilities: unknown }).capabilities).toEqual([]);
    // Cookieless → no device, no profile, so the timeout resolves to null (the app default).
    expect((body as { inactivityTimeoutSeconds: unknown }).inactivityTimeoutSeconds).toBeNull();
    expect(body).not.toHaveProperty("layout");
  });
});

it.each([
  { formFactor: "till", inactivityTimeoutSeconds: 42 },
  { formFactor: "phone-portrait", inactivityTimeoutSeconds: 42 },
  { formFactor: "tablet-landscape", inactivityTimeoutSeconds: 42 },
  { formFactor: "kds", inactivityTimeoutSeconds: null },
  { formFactor: "kds", inactivityTimeoutSeconds: 1_800 },
] as const)(
  "GET /api/till returns the enrolled $formFactor form factor with timeout $inactivityTimeoutSeconds and no canvas data",
  async ({ formFactor, inactivityTimeoutSeconds }) => {
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: `Fixed ${formFactor}`,
      formFactor,
      capabilities: [],
      inactivityTimeoutSeconds,
    });
    try {
      const enrolled = await enrolDeviceForTest(suite.db, cfg, {
        name: `Fixed ${formFactor}`,
        profileId: profile!.id,
        ...(formFactor === "kds"
          ? { kitchenScreen: { kind: "station" as const, stationIds: null, zoneIds: null } }
          : {}),
      });
      const cookie = `${DEVICE_COOKIE}=${enrolled.deviceId}.${enrolled.token}`;
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const response = await app.request("/api/till", { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("formFactor", formFactor);
      expect(body).not.toHaveProperty("canvas");
      expect(body).toHaveProperty("capabilities", []);
      expect(body).toHaveProperty("inactivityTimeoutSeconds", inactivityTimeoutSeconds);
      expect(body).not.toHaveProperty("startingScreen");
    } finally {
      await suite.db.execute(sql`delete from devices where device_profile_id = ${profile!.id}`);
      await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, profile!.id));
    }
  },
);

it("GET /api/till boots fixed till screens without a canvas for a cookieless request", async () => {
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  const response = await app.request("/api/till");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty("formFactor", "till");
  expect(body).not.toHaveProperty("canvas");
});
