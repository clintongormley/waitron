// Real PostgreSQL: exercises the management-session permission gate as the deployment role.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { MailpitClient } from "./mailpit-client.js";
import { ALL_MODULES } from "./modules.js";
import { mountEmailInboxApi } from "./email-inbox-api.js";

const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};
let nif = 74_000_000;

async function setupVenue(): Promise<{ tenantId: string; manager: string; staff: string }> {
  nif += 1;
  const venue = await applyVenue(
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
        tillName: "Caja",
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
    { db: suite.admin, modules: ALL_MODULES },
  );
  const sessions = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const start = async (role: "manager" | "staff") => {
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${venue.tenantId}, ${role}, ${hashPin("1234")}, ${role}) returning id
      `);
      return startManagementSession(tx, {
        tenantId: venue.tenantId,
        personId: inserted.rows[0]!.id,
      });
    };
    return { manager: await start("manager"), staff: await start("staff") };
  });
  return {
    tenantId: venue.tenantId,
    manager: `${MANAGEMENT_COOKIE}=${sessions.manager.id}`,
    staff: `${MANAGEMENT_COOKIE}=${sessions.staff.id}`,
  };
}

const SUMMARY = {
  count: 1,
  messages: [
    {
      id: "mail-1",
      from: { name: "Waitron", address: "no-reply@waitron.test" },
      to: [{ name: "", address: "owner@example.test" }],
      subject: "Set up your account",
      snippet: "Use this link",
      createdAt: "2026-09-09T18:00:00Z",
      read: false,
    },
  ],
};

function inbox(): MailpitClient {
  return {
    list: vi.fn().mockResolvedValue(SUMMARY),
    read: vi.fn().mockResolvedValue({
      id: "mail-1",
      from: SUMMARY.messages[0]!.from,
      to: SUMMARY.messages[0]!.to,
      subject: SUMMARY.messages[0]!.subject,
      date: SUMMARY.messages[0]!.createdAt,
      text: "Open https://waitron.local/manage/account?token=secret",
    }),
  };
}

function mount(
  tenantId: string,
  delivery: "local_capture" | "smtp" | "unconfigured",
  mailpit = inbox(),
): { app: Hono; mailpit: MailpitClient } {
  const app = new Hono();
  mountEmailInboxApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId },
      resolveMode: () => Promise.resolve(delivery),
      mailpit,
    },
    noopLog,
  );
  return { app, mailpit };
}

const get = (app: Hono, path: string, cookie?: string) =>
  app.request(path, { headers: cookie === undefined ? {} : { cookie } });

describe("mountEmailInboxApi", () => {
  it("refuses unauthenticated inbox access before calling Mailpit", async () => {
    const venue = await setupVenue();
    const { app, mailpit } = mount(venue.tenantId, "local_capture");

    const response = await get(app, "/management-api/email");

    expect(response.status).toBe(401);
    expect(mailpit.list).not.toHaveBeenCalled();
  });

  it("refuses a staff session without person.manage", async () => {
    const venue = await setupVenue();
    const { app } = mount(venue.tenantId, "local_capture");

    expect((await get(app, "/management-api/email", venue.staff)).status).toBe(403);
  });

  it("returns the captured inbox to a manager", async () => {
    const venue = await setupVenue();
    const { app } = mount(venue.tenantId, "local_capture");

    const response = await get(app, "/management-api/email", venue.manager);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "local_capture", ...SUMMARY });
  });

  it("reports configured SMTP without reading the local inbox", async () => {
    const venue = await setupVenue();
    const { app, mailpit } = mount(venue.tenantId, "smtp");

    const response = await get(app, "/management-api/email", venue.manager);

    expect(await response.json()).toEqual({ mode: "smtp", count: 0, messages: [] });
    expect(mailpit.list).not.toHaveBeenCalled();
  });

  it("reads one captured message through the authenticated route", async () => {
    const venue = await setupVenue();
    const { app, mailpit } = mount(venue.tenantId, "local_capture");

    const response = await get(app, "/management-api/email/message/mail-1", venue.manager);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "mail-1", subject: "Set up your account" });
    expect(mailpit.read).toHaveBeenCalledWith("mail-1");
  });

  it("does not expose the test inbox when SMTP is active", async () => {
    const venue = await setupVenue();
    const { app } = mount(venue.tenantId, "smtp");

    const response = await get(app, "/management-api/email/message/mail-1", venue.manager);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "email.test_inbox_unavailable" },
    });
  });
});
