import { expect, it, vi } from "vitest";
import { Hono } from "hono";
import { CORE_MIGRATIONS, readSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { GUEST_MENU_SETTINGS } from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { CloudConnection } from "./cloud-client.js";
import { cloudConnectionJob } from "./cloud-worker.js";
import { mountGuestMenuApi } from "./guest-menu-api.js";
import { createJobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";
import "./errors.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const active = { installation: { state: "active" } };

it("a sharing save brings a Cloud delivery that reads the committed setting within two seconds", async () => {
  const cookie = await withTransaction(suite.db, async (tx) => {
    const [manager] = await seedPersons(tx, [{ displayName: "Manager", role: "manager" }]);
    const session = await startManagementSession(tx, {
      method: "password",
      personId: manager!.id,
    });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const epoch = Date.now();
  const elapsed = () => Date.now() - epoch;
  const runner = createJobRunner({
    now: () => new Date(),
    log: () => {},
    delay: fakeTimerDelay,
    monotonicMs: elapsed,
    subscribe: () => () => {},
  });
  try {
    const deliveries: { at: number; enabled: boolean; revision: number }[] = [];
    runner.add(
      cloudConnectionJob({
        connection: {
          refresh: async () => active,
          status: async () => active,
        } as unknown as CloudConnection,
        isPrimary: () => true,
        onGuestMenu: async () => {
          const { doc, revision } = await readSettings(suite.db, GUEST_MENU_SETTINGS);
          deliveries.push({ at: elapsed(), enabled: doc.enabled, revision });
        },
      }),
    );
    const app = new Hono();
    mountGuestMenuApi(
      app,
      { db: suite.db, serving: () => true, wake: () => runner.wake("cloud.connection") },
      () => {},
    );
    const save = async (enabled: boolean, expectedRevision: number) => {
      const answer = await app.request("/management-api/guest-menu", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled, expectedRevision }),
      });
      expect(answer.status).toBe(200);
      return elapsed();
    };
    const deliveryAfter = async (savedAt: number) => {
      for (let step = 0; step < 25 && deliveries.at(-1)!.at < savedAt; step++)
        await vi.advanceTimersByTimeAsync(100);
      return deliveries.at(-1)!;
    };

    await vi.advanceTimersByTimeAsync(0);
    expect(deliveries).toEqual([{ at: 0, enabled: false, revision: 0 }]);
    await vi.advanceTimersByTimeAsync(5_000);

    const sharedAt = await save(true, 0);
    const shared = await deliveryAfter(sharedAt);
    expect(shared).toMatchObject({ enabled: true, revision: 1 });
    expect(shared.at - sharedAt).toBeLessThanOrEqual(2_000);

    await vi.advanceTimersByTimeAsync(5_000);
    const stoppedAt = await save(false, 1);
    const stopped = await deliveryAfter(stoppedAt);
    expect(stopped).toMatchObject({ enabled: false, revision: 2 });
    expect(stopped.at - stoppedAt).toBeLessThanOrEqual(2_000);
  } finally {
    await runner.stopJobs();
    vi.useRealTimers();
  }
});
