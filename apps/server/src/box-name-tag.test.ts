import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { BoxHostRequests } from "./box-host-client.js";
import { boxNameTagJob } from "./box-name-tag.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const context = { now: new Date("2026-11-11T10:00:00Z"), signal: new AbortController().signal };
function duty(
  tagWrite = vi.fn<BoxHostRequests["tagWrite"]>(async () => ({ available: true, tag: "written" })),
  live = false,
) {
  return {
    tagWrite,
    job: boxNameTagJob({ db: fx.db, host: { tagWrite }, live: () => live, log: () => {} }),
  };
}
it("writes the composed legal name and actual boot intent", async () => {
  await seedTenant(fx.db);
  await withTransaction(fx.db, (tx) =>
    tx.update(tenants).set({ legalName: "Cafe\u0301 Harbour Ltd" }).where(eq(tenants.id, 1)),
  );
  const { job, tagWrite } = duty(undefined, true);
  try {
    await job.pass(context);
    expect(tagWrite).toHaveBeenCalledWith({ name: "Caf\u00e9 Harbour Ltd", live: true });
  } finally {
    await job.onStop?.();
  }
});
it("clears the tag for no taxpayer or an unusable name", async () => {
  const { job, tagWrite } = duty();
  try {
    await job.pass(context);
    expect(tagWrite).toHaveBeenLastCalledWith(null);
    await seedTenant(fx.db);
    await withTransaction(fx.db, (tx) =>
      tx
        .update(tenants)
        .set({ legalName: "x".repeat(257) })
        .where(eq(tenants.id, 1)),
    );
    await job.pass(context);
    expect(tagWrite.mock.calls).toEqual([[null], [null]]);
  } finally {
    await job.onStop?.();
  }
});
it("wakes on a committed rename, never on its rollback, and stops listening at close", async () => {
  await seedTenant(fx.db);
  const wake = vi.fn();
  const job = boxNameTagJob({
    db: fx.db,
    host: { tagWrite: async () => ({ available: true, tag: "written" }) },
    live: () => false,
    log: () => {},
    wake,
  });
  try {
    wake.mockClear();
    await expect(
      withTransaction(fx.db, async (tx) => {
        await tx.update(tenants).set({ legalName: "Rolled back" }).where(eq(tenants.id, 1));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(wake).not.toHaveBeenCalled();
    await withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "Harbour Ltd" }).where(eq(tenants.id, 1)),
    );
    expect(wake).toHaveBeenCalledTimes(1);
    await job.onStop?.();
    wake.mockClear();
    await withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "After close" }).where(eq(tenants.id, 1)),
    );
    expect(wake).not.toHaveBeenCalled();
  } finally {
    await job.onStop?.();
  }
});
it("allows another venue write to finish while the host is pending", async () => {
  await seedTenant(fx.db);
  let reply: (answer: Awaited<ReturnType<BoxHostRequests["tagWrite"]>>) => void = () => {};
  const tagWrite = vi.fn<BoxHostRequests["tagWrite"]>(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const { job } = duty(tagWrite);
  const pass = job.pass(context);
  let write: Promise<unknown> | undefined;
  try {
    await vi.waitFor(() => expect(tagWrite).toHaveBeenCalledTimes(1));
    let committed = false;
    write = withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "Changed while pending" }).where(eq(tenants.id, 1)),
    ).then(() => {
      committed = true;
    });
    await vi.waitFor(() => expect(committed).toBe(true));
  } finally {
    reply({ available: true, tag: "written" });
    await pass;
    await write;
    await job.onStop?.();
  }
});
it("ends unsupported-host attempts and lets a transient refusal retry", async () => {
  const tagWrite = vi
    .fn<BoxHostRequests["tagWrite"]>()
    .mockResolvedValueOnce({ available: false, reason: "refused", refusal: "busy" })
    .mockResolvedValueOnce({ available: false, reason: "unsupported", detail: "unknown_request" });
  const { job } = duty(tagWrite);
  try {
    expect(await job.pass(context)).toMatchObject({ degraded: true });
    expect(await job.pass(context)).toMatchObject({ finished: true });
  } finally {
    await job.onStop?.();
  }
});
