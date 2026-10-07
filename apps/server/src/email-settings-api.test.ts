import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  loadKeyRing,
  putCredential,
  tenantCredentials,
  tryGetCredential,
} from "@waitron/credentials";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { resolveInvoiceEmailDelivery } from "./email-delivery.js";
import { mountEmailSettingsApi } from "./email-settings-api.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import { smtpRig, smtpTestTls } from "./testing/smtp-settings-fixture.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
let nif = 76_000_000;
async function setupVenue(): Promise<{ manager: string; staff: string }> {
  nif += 1;
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${nif}K`,
        legalName: "Inbox Test SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Uno 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Admin",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const sessions = await withTransaction(suite.db, async (tx) => {
    const start = async (role: "manager" | "staff") => {
      const [inserted] = await tx
        .insert(persons)
        .values({
          displayName: role,
          pinHash: hashPin("1234"),
          role,
          email: `${role}@example.test`,
        })
        .returning({ id: persons.id });
      return startManagementSession(tx, {
        personId: inserted!.id,
      });
    };
    return { manager: await start("manager"), staff: await start("staff") };
  });
  return {
    manager: `${MANAGEMENT_COOKIE}=${sessions.manager.token}`,
    staff: `${MANAGEMENT_COOKIE}=${sessions.staff.token}`,
  };
}

const settings = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  user: "smtp-user",
  password: "p@ss:word",
  from: "venue@example.test",
};
const path = "/management-api/email/settings";
function mount(
  intent: "demo" | "prepare" | "live" | undefined = "live",
  log: Logger = () => {},
  sendTest?: typeof sendSmtpTestMessage,
) {
  const app = new Hono();
  mountEmailSettingsApi(
    app,
    {
      db: suite.db,
      ring,
      config: { onboardingIntent: intent, devMode: false },
      ...(sendTest === undefined ? {} : { sendTest }),
    },
    log,
  );
  return app;
}
const request = (app: Hono, cookie: string | undefined, body?: unknown) =>
  app.request(path, {
    method: body === undefined ? "GET" : "PUT",
    headers: { ...(cookie === undefined ? {} : { cookie }), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("SMTP settings", () => {
  it("seals a manager's settings and routes invoice mail through them without returning secrets", async () => {
    const venue = await setupVenue();
    const logs: unknown[] = [];
    const app = mount("live", (...args) => {
      logs.push(args);
    });
    const response = await request(app, venue.manager, settings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(
      await resolveInvoiceEmailDelivery(suite.db, ring, {
        onboardingIntent: "live",
        devMode: false,
      }),
    ).toEqual({
      mode: "smtp",
      smtp: {
        url: "smtp://smtp-user:p%40ss%3Aword@smtp.example.test:587?requireTLS=true",
        from: "venue@example.test",
      },
    });
    const rows = await suite.db.select().from(tenantCredentials);
    expect(JSON.stringify(rows)).not.toContain("p@ss:word");
    expect(JSON.stringify(rows)).not.toContain("smtp-user");
    const read = await request(app, venue.manager);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      mode: "smtp",
      editable: true,
      settings: {
        server: "smtp.example.test",
        port: 587,
        encryption: "starttls",
        from: "venue@example.test",
        hasAuthentication: true,
      },
    });
    expect(JSON.stringify(logs)).not.toContain("smtp-user");
    expect(JSON.stringify(logs)).not.toContain("p@ss:word");
  });
  it("replaces a sealed setting with implicit TLS and no authentication", async () => {
    const venue = await setupVenue();
    const app = mount();
    expect((await request(app, venue.manager, settings)).status).toBe(200);
    expect(
      (
        await request(app, venue.manager, {
          server: "next.example.test",
          port: 465,
          encryption: "tls",
          from: "next@example.test",
        })
      ).status,
    ).toBe(200);
    expect(
      await resolveInvoiceEmailDelivery(suite.db, ring, {
        onboardingIntent: "live",
        devMode: false,
      }),
    ).toEqual({
      mode: "smtp",
      smtp: { url: "smtps://next.example.test:465", from: "next@example.test" },
    });
    expect(await (await request(app, venue.manager)).json()).toEqual({
      mode: "smtp",
      editable: true,
      settings: {
        server: "next.example.test",
        port: 465,
        encryption: "tls",
        from: "next@example.test",
        hasAuthentication: false,
      },
    });
    expect(await suite.db.select().from(tenantCredentials)).toHaveLength(1);
  });
  it("reports missing live SMTP so the card can ask for settings", async () => {
    const venue = await setupVenue();
    expect(await (await request(mount(), venue.manager)).json()).toEqual({
      mode: "unconfigured",
      editable: true,
      settings: null,
    });
  });
  it.each(["GET", "PUT"])(
    "refuses unauthenticated %s before reading or writing",
    async (method) => {
      await setupVenue();
      const response = await request(mount(), undefined, method === "PUT" ? settings : undefined);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "management_session.required" },
      });
      expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
    },
  );
  it.each(["GET", "PUT"])("refuses staff %s without system.manage", async (method) => {
    const venue = await setupVenue();
    const response = await request(mount(), venue.staff, method === "PUT" ? settings : undefined);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
  });
  it.each(["demo", "prepare"] as const)(
    "refuses a change in %s and leaves its configured credential intact",
    async (intent) => {
      const venue = await setupVenue();
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, {
          purpose: "email.smtp",
          value: { url: "smtps://old:old-secret@old.example.test:465", from: "old@example.test" },
        }),
      );
      const app = mount(intent);
      const response = await request(app, venue.manager, settings);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "email.settings_not_allowed", params: {} },
      });
      expect(
        await withTransaction(suite.db, (tx) =>
          tryGetCredential(tx, ring, { purpose: "email.smtp" }),
        ),
      ).toEqual({ url: "smtps://old:old-secret@old.example.test:465", from: "old@example.test" });
      const read = await request(app, venue.manager);
      expect(await read.json()).toEqual(
        intent === "demo"
          ? { mode: "local_capture", editable: false, settings: null }
          : {
              mode: "smtp",
              editable: false,
              settings: {
                server: "old.example.test",
                port: 465,
                encryption: "tls",
                from: "old@example.test",
                hasAuthentication: true,
              },
            },
      );
    },
  );
  it("a preparing venue without credentials reports captured mail", async () => {
    const venue = await setupVenue();
    expect(await (await request(mount("prepare"), venue.manager)).json()).toEqual({
      mode: "local_capture",
      editable: false,
      settings: null,
    });
  });
  it.each([
    ["server", ""],
    ["server", "secret@example.test"],
    ["server", "smtp://example.test"],
    ["server", "example.test?password=secret"],
    ["port", null],
    ["port", "587"],
    ["port", 0],
    ["port", 65536],
    ["port", 587.5],
    ["encryption", null],
    ["encryption", ["tls"]],
    ["encryption", "none"],
    ["from", ""],
    ["from", "secret\r\nBcc: other@example.test"],
    ["from", "not-an-address"],
    ["user", null],
    ["password", null],
    ["password", ""],
  ])(
    "refuses invalid %s without changing the credential or echoing the value",
    async (field, value) => {
      const venue = await setupVenue();
      const response = await request(mount(), venue.manager, {
        ...settings,
        [field as string]: value,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "email.settings_invalid", params: { field } },
      });
      expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
    },
  );
});

describe("SMTP settings test request", () => {
  const testRequest = (app: Hono, cookie: string | undefined, body: unknown) =>
    app.request(path + "/test", {
      method: "POST",
      headers: { ...(cookie === undefined ? {} : { cookie }), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  it("tests proposed TLS settings against real SMTP, using the session person's address without saving", async () => {
    const venue = await setupVenue();
    const rig = await smtpRig("accepted", true);
    const logs: unknown[] = [];
    try {
      const app = mount(
        "live",
        (...args) => {
          logs.push(args);
        },
        async (config, recipient) => {
          await withTransaction(suite.db, async () => {});
          return sendSmtpTestMessage(config, recipient, { ca: smtpTestTls.caCertPem });
        },
      );
      const response = await testRequest(app, venue.manager, {
        server: "127.0.0.1",
        port: Number(new URL(rig.config.url).port),
        encryption: "tls",
        from: "venue@example.test",
        recipient: "attacker@example.test",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true });
      expect(rig.messages).toHaveLength(1);
      expect(rig.messages[0]).toContain("To: manager@example.test");
      expect(rig.messages[0]).not.toContain("attacker@example.test");
      expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
      expect(JSON.stringify(logs)).not.toContain("manager@example.test");
    } finally {
      await rig.close();
    }
  });
  it("returns only a refusal code from a plaintext-only SMTP server and saves nothing", async () => {
    const venue = await setupVenue();
    const rig = await smtpRig("accepted");
    try {
      const response = await testRequest(mount(), venue.manager, {
        server: "127.0.0.1",
        port: Number(new URL(rig.config.url).port),
        encryption: "starttls",
        from: "venue@example.test",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: false, code: "email.test_refused" });
      expect(rig.messages).toHaveLength(0);
      expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });
  it.each(["missing", "staff"])("refuses %s authorization before testing", async (role) => {
    const venue = await setupVenue();
    const response = await testRequest(
      mount(),
      role === "missing" ? undefined : venue.staff,
      settings,
    );
    expect(response.status).toBe(role === "missing" ? 401 : 403);
    expect(await response.json()).toMatchObject({
      error: {
        code: role === "missing" ? "management_session.required" : "authorization.not_permitted",
      },
    });
  });
  it.each(["demo", "prepare"] as const)("refuses a proposed SMTP test in %s", async (intent) => {
    const venue = await setupVenue();
    const response = await testRequest(mount(intent), venue.manager, settings);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "email.settings_not_allowed", params: {} },
    });
  });
  it("refuses malformed test settings with a field code and without secrets", async () => {
    const venue = await setupVenue();
    const response = await testRequest(mount(), venue.manager, {
      ...settings,
      server: "smtp://password@example.test",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "email.settings_invalid", params: { field: "server" } },
    });
  });
});

describe("SMTP settings boundary cases", () => {
  it.each([
    ["smtp://private:secret@smtp.example.test?password=also-secret", 587, "starttls"],
    ["smtps://private:secret@smtp.example.test", 465, "tls"],
  ] as const)(
    "reads CLI credentials with default ports without exposing URL credentials or query values: %s",
    async (url, port, encryption) => {
      const venue = await setupVenue();
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, {
          purpose: "email.smtp",
          value: { url, from: "venue@example.test" },
        }),
      );
      expect(await (await request(mount(), venue.manager)).json()).toEqual({
        mode: "smtp",
        editable: true,
        settings: {
          server: "smtp.example.test",
          port,
          encryption,
          from: "venue@example.test",
          hasAuthentication: true,
        },
      });
    },
  );
  it.each(["private-secret", "https://private:secret@example.test", "smtp:private-secret"])(
    "refuses an unusable CLI URL without disclosing it: %s",
    async (url) => {
      const venue = await setupVenue();
      const logs: unknown[] = [];
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, {
          purpose: "email.smtp",
          value: { url, from: "venue@example.test" },
        }),
      );
      const response = await request(
        mount("live", (...args) => {
          logs.push(args);
        }),
        venue.manager,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "server.credential_unusable",
          params: { purpose: "email.smtp", field: "url" },
        },
      });
      expect(JSON.stringify(logs)).not.toContain("secret");
    },
  );
  it.each([
    ["server", "[broken"],
    ["server", "example.test:9999"],
    ["server", "bad server.test"],
    ["from", null],
    ["user", ""],
  ])("rejects malformed authority or unpaired authentication: %s=%s", async (field, value) => {
    const venue = await setupVenue();
    const response = await request(mount(), venue.manager, {
      ...settings,
      [field as string]: value,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "email.settings_invalid", params: { field } },
    });
    expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
  });
  it("accepts an IPv6 server and trims the server and sender", async () => {
    const venue = await setupVenue();
    const response = await request(mount(), venue.manager, {
      server: " [::1] ",
      port: 465,
      encryption: "tls",
      from: " venue@example.test ",
    });
    expect(response.status).toBe(200);
    expect(
      await resolveInvoiceEmailDelivery(suite.db, ring, {
        onboardingIntent: "live",
        devMode: false,
      }),
    ).toEqual({ mode: "smtp", smtp: { url: "smtps://[::1]:465", from: "venue@example.test" } });
  });
  it("refuses a test when the authenticated person has no email address", async () => {
    const venue = await setupVenue();
    await withTransaction(suite.db, (tx) =>
      tx.update(persons).set({ email: null }).where(eq(persons.email, "manager@example.test")),
    );
    const response = await mount().request(path + "/test", {
      method: "POST",
      headers: { cookie: venue.manager, "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "email.settings_invalid", params: { field: "recipient" } },
    });
    expect(await suite.db.select().from(tenantCredentials)).toHaveLength(0);
  });
});

it("allows another database write while an SMTP settings upload is unfinished", async () => {
  const venue = await setupVenue();
  const app = mount();
  let release!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(settings)));
        controller.close();
      };
    },
  });
  const raw = new Request(`http://box.test${path}`, {
    method: "PUT",
    headers: { cookie: venue.manager, "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const read = raw.text.bind(raw);
  raw.text = () => {
    started();
    return read();
  };
  const save = app.request(raw);
  await reading;
  const write = withTransaction(suite.db, async (tx) => {
    await tx
      .update(persons)
      .set({ displayName: "Saved beside slow upload" })
      .where(eq(persons.role, "manager"));
    return true;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const progressed = await Promise.race([
      write,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 500);
      }),
    ]);
    expect(progressed).toBe(true);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    expect((await save).status).toBe(200);
    await write;
  }
});

it.each([
  ["smtp-user", "plain-pass"],
  ["smtp-user", "a:b@c#d"],
  ["smtp-user", "p%41ss"],
  ["u%41", "plain-pass"],
])("preserves SMTP credentials %s / %s on the real authenticated wire", async (user, password) => {
  const venue = await setupVenue();
  const rig = await smtpRig("accepted", true);
  try {
    const app = mount(
      "live",
      () => {},
      (config, recipient) => sendSmtpTestMessage(config, recipient, { ca: smtpTestTls.caCertPem }),
    );
    const response = await app.request(`${path}/test`, {
      method: "POST",
      headers: { cookie: venue.manager, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...settings,
        server: "127.0.0.1",
        port: Number(new URL(rig.config.url).port),
        encryption: "tls",
        user,
        password,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(rig.authentications).toEqual([`\0${user}\0${password}`]);
    expect(rig.messages).toHaveLength(1);
  } finally {
    await rig.close();
  }
});
