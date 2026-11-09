import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";
import { outgoingMail } from "./schema/outgoing-mail.js";
import { enqueueMail, cancelMail, readMail, MAIL_LIFETIME_MS } from "./outgoing-mail.js";

const now = new Date("2026-11-09T12:00:00.000Z");
const request = (dedupeKey = "invoice:one") => ({
  kind: "invoice" as const,
  dedupeKey,
  now,
  notAfter: new Date("2026-11-16T12:00:00.000Z"),
});
describe("mail queue API", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("queues due now without an address or claim and numbers in queue order", async () => {
    await withTransaction(suite.db, async (tx) => {
      const a = await enqueueMail(tx, request());
      await enqueueMail(tx, request("invoice:two"));
      expect(await readMail(tx, "invoice:one")).toMatchObject({
        id: a.id,
        status: "pending",
        seq: 1,
        recipient: null,
        claimToken: null,
        claimedAt: null,
        attempts: 0,
        nextAttemptAt: now.toISOString(),
        params: {},
      });
      expect((await readMail(tx, "invoice:two"))?.seq).toBe(2);
      expect(MAIL_LIFETIME_MS.invoice).toBe(604800000);
      expect(MAIL_LIFETIME_MS.box_alert).toBe(86400000);
    });
  });
  it("returns the existing id for a repeated key even when finished", async () => {
    await withTransaction(suite.db, async (tx) => {
      const first = await enqueueMail(tx, request());
      await cancelMail(tx, "invoice:one", now);
      expect(await enqueueMail(tx, request())).toEqual({ id: first.id, queued: false });
      expect((await readMail(tx, "invoice:one"))?.status).toBe("cancelled");
    });
  });
  it("rolls back with its caller", async () => {
    await expect(
      withTransaction(suite.db, async (tx) => {
        await enqueueMail(tx, request());
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await readMail(suite.db, "invoice:one")).toBeUndefined();
  });
  it("cancels only pending and waiting rejected rows", async () => {
    await withTransaction(suite.db, async (tx) => {
      const { id } = await enqueueMail(tx, request());
      await tx.update(outgoingMail).set({ status: "rejected" }).where(eq(outgoingMail.id, id));
      expect(await cancelMail(tx, "invoice:one", now)).toBe(true);
      expect(await readMail(tx, "invoice:one")).toMatchObject({
        status: "cancelled",
        finishedAt: now.toISOString(),
      });
      expect(await cancelMail(tx, "invoice:one", now)).toBe(false);
      expect(await cancelMail(tx, "missing", now)).toBe(false);
      const next = await enqueueMail(tx, request("invoice:two"));
      await tx
        .update(outgoingMail)
        .set({
          status: "sending",
          claimToken: "claim",
          claimedAt: now.toISOString(),
          recipient: "a@example.test",
        })
        .where(eq(outgoingMail.id, next.id));
      expect(await cancelMail(tx, "invoice:two", now)).toBe(false);
      for (const status of ["sent", "rejected"] as const) {
        await tx
          .update(outgoingMail)
          .set({ status, finishedAt: now.toISOString() })
          .where(eq(outgoingMail.id, next.id));
        expect(await cancelMail(tx, "invoice:two", now)).toBe(false);
      }
      const pending = await enqueueMail(tx, request("invoice:pending"));
      expect(await cancelMail(tx, "invoice:pending", now)).toBe(true);
      expect((await readMail(tx, "invoice:pending"))?.id).toBe(pending.id);
    });
  });
});
