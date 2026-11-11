import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant, seedVenueSettings } from "@waitron/db/testing/seed.js";
import type { BoxHostRequests } from "./box-host-client.js";
import { createLogger, type Logger } from "./logger.js";
import { boxNameTagJob } from "./box-name-tag.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const context = { now: new Date("2026-11-11T10:00:00Z"), signal: new AbortController().signal };
function duty(
  tagWrite = vi.fn<BoxHostRequests["tagWrite"]>(async () => ({ available: true, tag: "written" })),
  live = false,
  log: Logger = () => {},
) {
  return {
    tagWrite,
    job: boxNameTagJob({ db: fx.db, host: { tagWrite }, live: () => live, log }),
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
    await job.pass(context);
    await withTransaction(fx.db, (tx) =>
      tx
        .update(tenants)
        .set({ legalName: "x".repeat(257) })
        .where(eq(tenants.id, 1)),
    );
    await job.pass(context);
    expect(tagWrite.mock.calls).toEqual([[null], [{ name: "Test SL", live: false }], [null]]);
  } finally {
    await job.onStop?.();
  }
});
it("listens to committed writes, never a rollback, and unregisters at close", async () => {
  await seedTenant(fx.db);
  const wake = vi.fn();
  const job = boxNameTagJob({
    db: fx.db,
    host: { tagWrite: async () => ({ available: true, tag: "written" }) },
    live: () => false,
    wake,
    log: () => {},
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
it.each(["missing", "unsupported"] as const)("ends %s-host attempts", async (reason) => {
  const tagWrite = vi.fn<BoxHostRequests["tagWrite"]>(async () =>
    reason === "missing"
      ? { available: false, reason, detail: "ENOENT" }
      : { available: false, reason, detail: "unknown_request" },
  );
  const { job } = duty(tagWrite);
  try {
    expect(await job.pass(context)).toMatchObject({ finished: true });
  } finally {
    await job.onStop?.();
  }
});
it("hands transient failures to the runner's bounded retry instead of caching them", async () => {
  await seedTenant(fx.db);
  const tagWrite = vi
    .fn<BoxHostRequests["tagWrite"]>()
    .mockResolvedValueOnce({ available: false, reason: "refused", refusal: "busy" })
    .mockResolvedValueOnce({ available: true, tag: "written" });
  const { job } = duty(tagWrite);
  try {
    await expect(job.pass(context)).rejects.toMatchObject({
      code: "box_host.failed",
      params: { reason: "host_failed" },
    });
    await job.pass(context);
    expect(tagWrite).toHaveBeenCalledTimes(2);
  } finally {
    await job.onStop?.();
  }
});
it("skips the host after an unrelated commit or an unchanged timer pass", async () => {
  await seedTenant(fx.db);
  const { job, tagWrite } = duty();
  try {
    await job.pass(context);
    await seedVenueSettings(fx.db);
    await job.pass(context);
    await job.pass(context);
    expect(tagWrite).toHaveBeenCalledTimes(1);
    await withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "New Harbour Ltd" }).where(eq(tenants.id, 1)),
    );
    await job.pass(context);
    expect(tagWrite.mock.calls).toEqual([
      [{ name: "Test SL", live: false }],
      [{ name: "New Harbour Ltd", live: false }],
    ]);
  } finally {
    await job.onStop?.();
  }
});
it("retries when a lost write may have replaced an earlier accepted tag", async () => {
  await seedTenant(fx.db);
  const tagWrite = vi
    .fn<BoxHostRequests["tagWrite"]>()
    .mockResolvedValueOnce({ available: true, tag: "written" })
    .mockResolvedValueOnce({ available: false, reason: "lost" })
    .mockResolvedValueOnce({ available: true, tag: "written" });
  const { job } = duty(tagWrite);
  try {
    await job.pass(context);
    await withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "New Harbour Ltd" }).where(eq(tenants.id, 1)),
    );
    await expect(job.pass(context)).rejects.toMatchObject({ code: "box_host.failed" });
    await withTransaction(fx.db, (tx) =>
      tx.update(tenants).set({ legalName: "Test SL" }).where(eq(tenants.id, 1)),
    );
    await job.pass(context);
    expect(tagWrite.mock.calls).toEqual([
      [{ name: "Test SL", live: false }],
      [{ name: "New Harbour Ltd", live: false }],
      [{ name: "Test SL", live: false }],
    ]);
  } finally {
    await job.onStop?.();
  }
});

it("keeps the specific host refusal in its diagnostic log", async () => {
  const lines: string[] = [];
  const log = createLogger(
    (line) => lines.push(line),
    () => context.now,
    () => "warn",
  );
  const tagWrite = vi.fn<BoxHostRequests["tagWrite"]>(async () => ({
    available: false,
    reason: "refused",
    refusal: "no_free_token",
  }));
  const { job } = duty(tagWrite, false, log);
  try {
    await expect(job.pass(context)).rejects.toMatchObject({ code: "box_host.failed" });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: "box_host.tag_failed", reason: "no_free_token" }),
    ]);
  } finally {
    await job.onStop?.();
  }
});
