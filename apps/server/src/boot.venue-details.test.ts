import { createServer, type AddressInfo } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { startServer, type StartedServer } from "./boot.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import type { VenueDetailsModel } from "./venue-detail-types.js";

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const ORIGIN = "https://dashboard.example.com";
const PASSWORD = "dashPass123";

afterEach(() => vi.useRealTimers());

async function smtpReceiver(port: number) {
  const messages: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let pending = "";
    let data: string | undefined;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf("\r\n"); end !== -1; end = pending.indexOf("\r\n")) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            messages.push(data);
            data = undefined;
            socket.write("250 queued\r\n");
          } else data += `${line}\n`;
        } else if (line.startsWith("DATA")) {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (line.startsWith("QUIT")) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  expect((server.address() as AddressInfo).port).toBe(port);
  return {
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("a running venue's account email clock", () => {
  it.each(["invitation", "password_reset", "profile"] as const)(
    "formats %s email with the committed zone without restarting",
    async (path) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
      const venue = await setupVenue(suite.db);
      const [port, smtpPort] = await freePorts(2);
      const smtp = await smtpReceiver(smtpPort!);
      let scratch: string | undefined;
      let server: StartedServer | undefined;
      try {
        scratch = await mkdtemp(join(tmpdir(), "waitron-venue-email-"));
        const migrationsRoot = join(scratch, "migrations");
        for (const [index, set] of manifestSets().entries())
          await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
            recursive: true,
          });
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({ modules: { "fiscal-none": false } }),
        );
        const env = {
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_STATE_DIR: scratch,
          WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
          WAITRON_MANAGEMENT_ORIGIN: ORIGIN,
          WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
          WAITRON_TILL_SERIES_ID: venue.cfg.seriesId,
          WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
        };
        const [admin] = await suite.db
          .insert(persons)
          .values({
            displayName: "Email Clock Admin",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword(PASSWORD),
            email: "clock-admin@example.test",
            role: "admin",
            locale: "en-GB",
          })
          .returning({ id: persons.id });
        const session = await withTransaction(suite.db, (tx) =>
          startManagementSession(tx, { personId: admin!.id }),
        );
        const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
        await withTransaction(suite.db, (tx) =>
          putCredential(tx, loadKeyRing(env), {
            purpose: "email.smtp",
            value: { url: `smtp://127.0.0.1:${smtpPort}`, from: "no-reply@example.test" },
          }),
        );
        const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
        server = await startServer({ ...env, WAITRON_VENUE_DIR: dirname(database) });
        await vi.waitFor(async () => {
          expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
        });
        const request = (url: string, method = "GET", body?: unknown) =>
          fetch(`http://127.0.0.1:${port}${url}`, {
            method,
            headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const send = async (index: number) => {
          if (path !== "profile") {
            const [person] = await suite.db
              .insert(persons)
              .values({
                displayName: `Invitee ${index}`,
                pinHash: hashPin("1234"),
                email: `invitee-${index}@example.test`,
                role: "staff",
                status: path === "invitation" ? "pending" : "active",
                passwordHash: hashPassword(PASSWORD),
                locale: "en-GB",
              })
              .returning({ id: persons.id });
            if (path === "invitation") {
              const response = await request(
                `/management-api/staff/${person!.id}/invitation`,
                "POST",
              );
              expect(response.status).toBe(200);
              expect(await response.json()).toEqual({ invitationSent: true });
            } else {
              const response = await request("/management-api/password-reset", "POST", {
                email: `invitee-${index}@example.test`,
              });
              expect(response.status).toBe(202);
              await vi.waitFor(() => expect(smtp.messages).toHaveLength(index + 1));
            }
          } else {
            const response = await request("/management-api/session/me/profile", "PUT", {
              displayName: "Email Clock Admin",
              firstNames: "Email",
              lastNames: "Admin",
              telephone: null,
              email: `profile-${index}@example.test`,
              locale: "en-GB",
              currentPassword: PASSWORD,
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ emailVerificationSent: true });
          }
          expect(smtp.messages).toHaveLength(index + 1);
          return smtp.messages[index]!.replace(/=\n/g, "");
        };
        const model = (await (
          await request("/management-api/venue-details")
        ).json()) as VenueDetailsModel;
        expect(model.hasSales || model.hasOrderHistory || model.hasDailyClose).toBe(false);
        const oldTime = path === "invitation" ? "14:00 CEST" : "14:30 CEST";
        const newTime = path === "invitation" ? "12:00 UTC" : "12:30 UTC";
        const before = await send(0);
        expect(before).toContain(oldTime);
        expect(before).not.toContain(newTime);
        const saved = await request("/management-api/venue-details", "PATCH", {
          expected: model.details,
          changes: { timeZone: "UTC" },
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toEqual({
          changed: true,
          model: { ...model, details: { ...model.details, timeZone: "UTC" } },
        });
        const after = await send(1);
        expect(after).toContain(newTime);
        expect(after).not.toContain(oldTime);
        for (const changes of [{ timeZone: "UTC" }, { timeZone: "not/a-zone" }]) {
          const response = await request("/management-api/venue-details", "PATCH", {
            expected: { ...model.details, timeZone: "UTC" },
            changes,
          });
          if (changes.timeZone === "UTC") {
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
              changed: false,
              model: { ...model, details: { ...model.details, timeZone: "UTC" } },
            });
          } else {
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
              error: {
                code: "venue.detail_invalid",
                params: { field: "timeZone", reason: "time_zone" },
              },
            });
          }
        }
        const unchanged = await send(2);
        expect(unchanged).toContain(newTime);
        expect(unchanged).not.toContain(oldTime);
        console.info("Account email expiry evidence", {
          path,
          before: before.match(/This single-use link expires at .+/)?.[0],
          after: after.match(/This single-use link expires at .+/)?.[0],
          unchanged: unchanged.match(/This single-use link expires at .+/)?.[0],
        });
      } finally {
        if (server !== undefined) await server.close();
        await smtp.close();
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      }
    },
  );
});
