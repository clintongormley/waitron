import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  checkFailed,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, type MenusFixture } from "../test/menus-fixture.js";
import { documentImages, MENU_DOCUMENT_FORMAT } from "./menu-document.js";
import {
  assertLiveVersions,
  menuStatus,
  previewMenu,
  publishMenu,
  readLiveDocuments,
} from "./menu-publication.js";
import {
  activateDueMenuPublications,
  cancelMenuPublication,
  listMenuPublications,
  queueMenuPublication,
} from "./menu-schedule.js";
import { BATCH_SIZE } from "./batches.js";
import { addMember } from "./sections.js";
import { updateMenuItem, updateProduct } from "./operations.js";
import {
  menuPublications,
  menuScheduledPublications,
  menuVersionImages,
  menuVersions,
} from "./schema/publication.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const NOW = new Date("2026-10-07T08:00:00.000Z");

// Reads with no instant of their own take the clock's, and an edition queued for a fixed date
// becomes live on every such read once that date passes; so the clock is held at NOW.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const day = (date: number) => new Date(`2026-10-${String(date).padStart(2, "0")}T06:00:00.000Z`);
const ANA = "manager-ana";

let f: MenusFixture;
let v1: string;

async function hashOf(menuId: string): Promise<string> {
  return (await app((tx) => previewMenu(tx, menuId))).hash;
}

async function setSoup(unitPrice: string, image?: string): Promise<void> {
  await app((tx) => updateProduct(tx, f.soup, { unitPrice, ...(image ? { image } : {}) }));
}

/** Queues Lunch's current draft, as the dashboard does: the hash its preview showed goes back. */
async function queue(activatesAt: Date, at = NOW) {
  const hash = await hashOf(f.lunch);
  return app((tx) => queueMenuPublication(tx, f.lunch, hash, activatesAt, ANA, { at }));
}

async function cancel(versionId: string, menuId = f.lunch) {
  return app((tx) => cancelMenuPublication(tx, menuId, versionId, ANA, NOW));
}

async function scheduleRow(versionId: string) {
  const [row] = await fx.db
    .select()
    .from(menuScheduledPublications)
    .where(eq(menuScheduledPublications.versionId, versionId));
  return row!;
}

/** Every row of the four publication tables, in a stable order. */
async function publicationTables() {
  return {
    versions: await fx.db.select().from(menuVersions).orderBy(asc(menuVersions.id)),
    images: await fx.db
      .select()
      .from(menuVersionImages)
      .orderBy(asc(menuVersionImages.versionId), asc(menuVersionImages.filename)),
    publications: await fx.db.select().from(menuPublications).orderBy(asc(menuPublications.menuId)),
    schedule: await fx.db
      .select()
      .from(menuScheduledPublications)
      .orderBy(asc(menuScheduledPublications.versionId)),
  };
}

/** Runs `fn` in one transaction and answers the SQL of every statement it prepared. */
async function statements<T>(fn: (tx: Transaction) => Promise<T>) {
  return app(async (tx) => {
    const session = (
      tx as unknown as { session: { prepareQuery: (q: { sql: string }) => unknown } }
    ).session;
    const prepared = vi.spyOn(session, "prepareQuery");
    await fn(tx);
    const sql = prepared.mock.calls.map(([query]) => query.sql);
    prepared.mockRestore();
    return sql;
  });
}

/** Like `statements`, with each statement's bound values. */
async function preparedStatements<T>(fn: (tx: Transaction) => Promise<T>) {
  return app(async (tx) => {
    const session = (
      tx as unknown as {
        session: { prepareQuery: (q: { sql: string; params: unknown[] }) => unknown };
      }
    ).session;
    const prepared = vi.spyOn(session, "prepareQuery");
    await fn(tx);
    const queries = prepared.mock.calls.map(([query]) => ({
      sql: query.sql,
      params: query.params,
    }));
    prepared.mockRestore();
    return queries;
  });
}

/** A prepared statement's text and values as a statement to run again. */
function rebuilt({ sql: text, params }: { sql: string; params: unknown[] }) {
  const parts = text.split("?");
  expect(parts).toHaveLength(params.length + 1);
  return sql.join(
    parts.flatMap((part, index) =>
      index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)],
    ),
  );
}

const writtenTables = (statements: readonly string[]) =>
  statements.flatMap((text) => {
    const match = /^\s*(?:insert into|update|delete from)\s+"(\w+)"/i.exec(text);
    return match === null ? [] : [match[1]!];
  });

beforeEach(async () => {
  f = await menusFixture(fx.db);
  const hash = await hashOf(f.lunch);
  v1 = (await app((tx) => publishMenu(tx, f.lunch, hash, "person-1", { at: NOW }))).versionId;
});

describe("queueMenuPublication", () => {
  it("fixes the edition's content and photos when it is queued", async () => {
    await setSoup("5.50", "soup-a.jpg");
    const preview = await app((tx) => previewMenu(tx, f.lunch));
    const queued = await app((tx) =>
      queueMenuPublication(tx, f.lunch, preview.hash, day(8), ANA, { at: NOW }),
    );
    expect(queued).toMatchObject({ number: 2, activatesAt: "2026-10-08T06:00:00.000Z" });
    await setSoup("5.00", "soup-b.jpg");

    const [version] = await fx.db
      .select()
      .from(menuVersions)
      .where(eq(menuVersions.id, queued.versionId));
    expect(version!.document).toEqual(preview.document);
    expect(version!.contentHash).toBe(preview.hash);
    expect(version!.publishedBy).toBe(ANA);
    expect(version!.publishedAt).toEqual(NOW);
    const soupOffer = await app((tx) => offerOf(tx, f.lunch, f.soup));
    expect(version!.document.offers[soupOffer]).toMatchObject({
      unitPrice: "5.50",
      image: "soup-a.jpg",
    });
    const images = await fx.db
      .select({ filename: menuVersionImages.filename })
      .from(menuVersionImages)
      .where(eq(menuVersionImages.versionId, queued.versionId))
      .orderBy(asc(menuVersionImages.filename));
    expect(images.map(({ filename }) => filename)).toEqual(documentImages(preview.document).sort());
    expect(images.map(({ filename }) => filename)).toContain("soup-a.jpg");
    expect(images.map(({ filename }) => filename)).not.toContain("soup-b.jpg");
    expect(await scheduleRow(queued.versionId)).toMatchObject({
      menuId: f.lunch,
      state: "queued",
      activatesAt: day(8),
      queuedAt: NOW,
      queuedBy: ANA,
      activatedAt: null,
      cancelledAt: null,
      cancelledBy: null,
    });
  });

  it("numbers each edition after every earlier one and never reuses a cancelled number", async () => {
    await setSoup("5.50");
    expect((await queue(day(8))).number).toBe(2);
    await setSoup("6.00");
    const third = await queue(day(9));
    expect(third.number).toBe(3);
    await cancel(third.versionId);
    expect(await scheduleRow(third.versionId)).toMatchObject({
      state: "cancelled",
      cancelledBy: ANA,
      cancelledAt: NOW,
      activatedAt: null,
    });
    await setSoup("6.50");
    expect((await queue(day(10))).number).toBe(4);
    const [second] = await fx.db
      .select({ id: menuVersions.id })
      .from(menuVersions)
      .where(sql`${menuVersions.menuId} = ${f.lunch} and ${menuVersions.number} = 2`);
    await cancel(second!.id);
    await setSoup("7.00");
    expect((await queue(day(11))).number).toBe(5);
  });

  it("leaves the live version live while an edition is only queued", async () => {
    const before = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    await setSoup("5.50", "soup-a.jpg");
    await queue(day(8));
    const status = (await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch);
    expect(status).toMatchObject({ version: 1 });
    const live = await app((tx) => readLiveDocuments(tx, [f.lunch]));
    expect(live.get(f.lunch)).toEqual(before.get(f.lunch));
    expect(live.get(f.lunch)!.versionId).toBe(v1);
  });

  describe("refuses, writing nothing", () => {
    async function refuses(attempt: () => Promise<unknown>, expected: object) {
      const before = await publicationTables();
      await expect(attempt()).rejects.toMatchObject(expected);
      expect(await publicationTables()).toEqual(before);
    }

    it("a stale hash", async () => {
      const hash = await hashOf(f.lunch);
      await setSoup("5.50");
      await refuses(
        () => app((tx) => queueMenuPublication(tx, f.lunch, hash, day(8), ANA, { at: NOW })),
        { code: "menu.changed_since_preview", params: { menuId: f.lunch } },
      );
    });

    it("unresolved clashes", async () => {
      await app(async (tx) => {
        await addMember(tx, f.lunchRoot, product(f.lager));
        await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
          grossPrice: "4.50",
        });
      });
      await refuses(() => queue(day(8)), {
        code: "menu.clashes_unresolved",
        params: { menuId: f.lunch, count: 1 },
      });
    });

    it("an unknown menu", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";
      await refuses(
        () => app((tx) => queueMenuPublication(tx, unknown, "x", day(8), ANA, { at: NOW })),
        { code: "catalogue.not_found", params: { catalogueId: unknown } },
      );
    });

    it("a time that is not after now", async () => {
      await setSoup("5.50");
      await refuses(() => queue(NOW), {
        code: "menu_publication.time_past",
        params: { activatesAt: NOW.toISOString() },
      });
      const minuteBefore = new Date(NOW.getTime() - 60_000);
      await refuses(() => queue(minuteBefore), {
        code: "menu_publication.time_past",
        params: { activatesAt: minuteBefore.toISOString() },
      });
    });

    it("a draft identical to the live version, with nothing queued", async () => {
      await refuses(() => queue(day(8)), {
        code: "menu_publication.unchanged",
        params: { menuId: f.lunch, number: 1 },
      });
    });

    it("a draft identical to the queued edition it would follow", async () => {
      await setSoup("5.50");
      await queue(day(8));
      await refuses(() => queue(day(9)), {
        code: "menu_publication.unchanged",
        params: { menuId: f.lunch, number: 2 },
      });
    });
  });

  it("accepts the live version's content again after a different queued edition", async () => {
    await setSoup("5.50");
    await queue(day(8));
    await setSoup("5.00");
    const third = await queue(day(9));
    expect(third.number).toBe(3);
    const [version] = await fx.db
      .select({ contentHash: menuVersions.contentHash })
      .from(menuVersions)
      .where(eq(menuVersions.id, third.versionId));
    const [live] = await fx.db
      .select({ contentHash: menuVersions.contentHash })
      .from(menuVersions)
      .where(eq(menuVersions.id, v1));
    expect(version!.contentHash).toBe(live!.contentHash);
  });
});

describe("overtaking a queued edition is refused", () => {
  it("for a new edition queued no later than one already queued", async () => {
    await setSoup("5.50");
    const second = await queue(day(9));
    await setSoup("6.00");
    const overtaken = {
      code: "menu_publication.overtakes_queued",
      params: {
        menuId: f.lunch,
        overtaken: [
          { versionId: second.versionId, number: 2, activatesAt: "2026-10-09T06:00:00.000Z" },
        ],
      },
    };
    const before = await publicationTables();
    await expect(queue(day(8))).rejects.toMatchObject(overtaken);
    await expect(queue(day(9))).rejects.toMatchObject(overtaken);
    expect(await publicationTables()).toEqual(before);
    expect((await queue(day(10))).number).toBe(3);
  });

  it("for an immediate publish, naming every queued edition, unless the draft is already live", async () => {
    await setSoup("5.50");
    const second = await queue(day(9));
    await setSoup("6.00");
    const third = await queue(day(10));
    await setSoup("6.50");
    const before = await publicationTables();
    const hash = await hashOf(f.lunch);
    await expect(
      app((tx) => publishMenu(tx, f.lunch, hash, "person-1", { at: NOW })),
    ).rejects.toMatchObject({
      code: "menu_publication.overtakes_queued",
      params: {
        menuId: f.lunch,
        overtaken: [
          { versionId: second.versionId, number: 2, activatesAt: "2026-10-09T06:00:00.000Z" },
          { versionId: third.versionId, number: 3, activatesAt: "2026-10-10T06:00:00.000Z" },
        ],
      },
    });
    expect(await publicationTables()).toEqual(before);

    await setSoup("5.00");
    const same = await hashOf(f.lunch);
    expect(await app((tx) => publishMenu(tx, f.lunch, same, "person-1", { at: NOW }))).toEqual({
      versionId: v1,
      number: 1,
    });
    expect(await publicationTables()).toEqual(before);
  });
});

describe("cancelMenuPublication", () => {
  it("refuses a version with no schedule row of that menu, a queued edition of another menu, and a settled one", async () => {
    const dinnerHash = await hashOf(f.dinner);
    await app((tx) => publishMenu(tx, f.dinner, dinnerHash, "person-1", { at: NOW }));
    await app((tx) => updateProduct(tx, f.burger, { unitPrice: "13.00" }));
    const queuedHash = await hashOf(f.dinner);
    const dinner = await app((tx) =>
      queueMenuPublication(tx, f.dinner, queuedHash, day(8), ANA, { at: NOW }),
    );
    for (const versionId of ["no-such-version", dinner.versionId, v1])
      await expect(cancel(versionId)).rejects.toMatchObject({
        code: "menu_publication.not_found",
        params: { menuId: f.lunch, versionId },
      });
    await setSoup("5.50");
    const second = await queue(day(8));
    await cancel(second.versionId);
    const before = await publicationTables();
    await expect(cancel(second.versionId)).rejects.toMatchObject({
      code: "menu_publication.not_queued",
      params: { menuId: f.lunch, versionId: second.versionId, state: "cancelled" },
    });
    expect(await publicationTables()).toEqual(before);
  });
});

describe("listMenuPublications", () => {
  it("answers the live version, every queued edition soonest first, then ten settled newest first", async () => {
    await setSoup("5.50");
    const cancelled: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const { versionId } = await queue(day(8));
      await cancel(versionId);
      cancelled.push(versionId);
    }
    const first = await queue(day(9));
    await setSoup("6.00");
    const second = await queue(day(10));

    const list = await app((tx) => listMenuPublications(tx, f.lunch));
    expect(list.live).toEqual({ versionId: v1, number: 1, since: NOW.toISOString() });
    expect(list.editions.map(({ number }) => number)).toEqual([
      14, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4,
    ]);
    const [version] = await fx.db
      .select({ contentHash: menuVersions.contentHash })
      .from(menuVersions)
      .where(eq(menuVersions.id, first.versionId));
    expect(list.editions[0]).toEqual({
      versionId: first.versionId,
      number: 14,
      state: "queued",
      activatesAt: "2026-10-09T06:00:00.000Z",
      queuedAt: NOW.toISOString(),
      cancelledAt: null,
      contentHash: version!.contentHash,
    });
    expect(list.editions[1]).toMatchObject({ versionId: second.versionId, state: "queued" });
    expect(list.editions[2]).toMatchObject({
      versionId: cancelled[11],
      state: "cancelled",
      activatesAt: "2026-10-08T06:00:00.000Z",
      cancelledAt: NOW.toISOString(),
    });
  });

  it("answers no live version for a menu never published", async () => {
    const list = await app((tx) => listMenuPublications(tx, f.dinner));
    expect(list).toEqual({ live: null, editions: [] });
  });
});

describe("the schedule table refuses what the code never writes", () => {
  let next = 100;
  async function plantVersion(menuId: string): Promise<string> {
    const versionId = crypto.randomUUID();
    next += 1;
    await fx.db.run(
      sql`insert into menu_versions (id, menu_id, number, document, content_hash, published_at, published_by)
          values (${versionId}, ${menuId}, ${next}, '{}', 'planted', ${NOW.toISOString()}, ${ANA})`,
    );
    return versionId;
  }
  function plantRow(row: {
    versionId: string;
    menuId?: string;
    activatesAt?: string;
    queuedAt?: string;
    state?: string;
    activatedAt?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: string | null;
  }) {
    return fx.db.run(
      sql`insert into menu_scheduled_publications
            (version_id, menu_id, activates_at, queued_at, queued_by, state, activated_at, cancelled_at, cancelled_by)
          values (${row.versionId}, ${row.menuId ?? f.lunch}, ${row.activatesAt ?? day(8).toISOString()},
                  ${row.queuedAt ?? NOW.toISOString()}, ${ANA}, ${row.state ?? "queued"},
                  ${row.activatedAt ?? null}, ${row.cancelledAt ?? null}, ${row.cancelledBy ?? null})`,
    );
  }
  const refusal = (row: Parameters<typeof plantRow>[0]) => captureError(() => plantRow(row));

  it("two queued editions of one menu at one instant, but not a cancelled one beside them", async () => {
    await plantRow({ versionId: await plantVersion(f.lunch) });
    const clash = await refusal({ versionId: await plantVersion(f.lunch) });
    expect(
      refusalOn(clash, UNIQUE_VIOLATION, {
        table: "menu_scheduled_publications",
        columns: ["menu_id", "activates_at"],
      }),
    ).toBe(true);
    await plantRow({
      versionId: await plantVersion(f.lunch),
      state: "cancelled",
      cancelledAt: NOW.toISOString(),
      cancelledBy: ANA,
    });
    expect(await fx.db.select().from(menuScheduledPublications)).toHaveLength(2);
  });

  it("a settled state without its own facts, a time before the queuing, and an unknown state", async () => {
    const cancelled = await refusal({
      versionId: await plantVersion(f.lunch),
      state: "cancelled",
      cancelledAt: NOW.toISOString(),
    });
    expect(checkFailed(cancelled, "menu_scheduled_publications_settled_ck")).toBe(true);
    const early = await refusal({
      versionId: await plantVersion(f.lunch),
      activatesAt: "2026-10-07T07:59:00.000Z",
    });
    expect(checkFailed(early, "menu_scheduled_publications_after_queue_ck")).toBe(true);
    const paused = await refusal({ versionId: await plantVersion(f.lunch), state: "paused" });
    expect(checkFailed(paused, "menu_scheduled_publications_state_ck")).toBe(true);
    expect(await fx.db.select().from(menuScheduledPublications)).toEqual([]);
  });

  it("a version of another menu", async () => {
    const dinnerVersion = await plantVersion(f.dinner);
    const paired = await refusal({ versionId: dinnerVersion, menuId: f.lunch });
    expect(isRefusal(paired, FOREIGN_KEY_VIOLATION)).toBe(true);
    await plantRow({ versionId: await plantVersion(f.lunch), menuId: f.lunch });
    expect(await fx.db.select().from(menuScheduledPublications)).toHaveLength(1);
  });
});

describe("queuing and cancelling write only the publication tables", () => {
  it("names no other table in an insert, update or delete", async () => {
    await setSoup("5.50", "soup-a.jpg");
    const hash = await hashOf(f.lunch);
    let versionId = "";
    const queued = await statements(async (tx) => {
      versionId = (await queueMenuPublication(tx, f.lunch, hash, day(8), ANA, { at: NOW }))
        .versionId;
    });
    expect(new Set(writtenTables(queued))).toEqual(
      new Set(["menu_versions", "menu_version_images", "menu_scheduled_publications"]),
    );
    const cancelled = await statements((tx) =>
      cancelMenuPublication(tx, f.lunch, versionId, ANA, NOW),
    );
    expect(writtenTables(cancelled)).toEqual(["menu_scheduled_publications"]);
  });
});

describe("a due edition is live at once", () => {
  /** Queues versions 2, 3 and 4 of Lunch for the 8th, 9th and 10th, each with a different Soup price. */
  async function queueThree() {
    await setSoup("5.50");
    const second = await queue(day(8));
    await setSoup("6.00");
    const third = await queue(day(9));
    await setSoup("6.50");
    const fourth = await queue(day(10));
    return { second, third, fourth };
  }

  async function pointer() {
    const [row] = await fx.db
      .select()
      .from(menuPublications)
      .where(eq(menuPublications.menuId, f.lunch));
    return row!;
  }

  /** What each live read answers for Lunch at the clock's instant. */
  async function readsAtClock(asserted: string) {
    return app(async (tx) => ({
      status: (await menuStatus(tx, [f.lunch])).get(f.lunch),
      documents: (await readLiveDocuments(tx, [f.lunch])).get(f.lunch)!.versionId,
      asserted: (
        await assertLiveVersions(tx, [f.lunch], [{ menuId: f.lunch, versionId: asserted }])
      ).get(f.lunch)!.versionId,
      preview: (await previewMenu(tx, f.lunch)).live!.versionId,
    }));
  }

  it("answers the due edition on every read from its instant on, before anything writes", async () => {
    await setSoup("5.50");
    const second = await queue(day(8));

    vi.setSystemTime(new Date("2026-10-08T05:59:00.000Z"));
    const before = await readsAtClock(v1);
    expect(before.status).toMatchObject({ version: 1 });
    expect(before).toMatchObject({ documents: v1, asserted: v1, preview: v1 });

    vi.setSystemTime(day(8));
    const after = await readsAtClock(second.versionId);
    expect(after.status).toMatchObject({ version: 2, publishedAt: "2026-10-08T06:00:00.000Z" });
    expect(after).toMatchObject({
      documents: second.versionId,
      asserted: second.versionId,
      preview: second.versionId,
    });
    expect((await pointer()).versionId).toBe(v1);
    expect(await scheduleRow(second.versionId)).toMatchObject({
      state: "queued",
      activatedAt: null,
    });
  });

  it("answers only the latest of several overdue editions, and one activation moves the pointer straight to it", async () => {
    const { second, third, fourth } = await queueThree();
    vi.setSystemTime(day(11));
    const reads = await readsAtClock(fourth.versionId);
    expect(reads.status).toMatchObject({ version: 4, publishedAt: day(10).toISOString() });
    expect(reads).toMatchObject({
      documents: fourth.versionId,
      asserted: fourth.versionId,
      preview: fourth.versionId,
    });

    let answer: Awaited<ReturnType<typeof activateDueMenuPublications>> | undefined;
    const written = await statements(async (tx) => {
      answer = await activateDueMenuPublications(tx, day(11));
    });
    expect(answer).toEqual({
      activated: [{ menuId: f.lunch, versionId: fourth.versionId, number: 4 }],
      nextDueAt: null,
    });
    for (const { versionId } of [second, third, fourth])
      expect(await scheduleRow(versionId)).toMatchObject({
        state: "activated",
        activatedAt: day(11),
      });
    expect(await pointer()).toMatchObject({ versionId: fourth.versionId, publishedAt: day(10) });
    expect(writtenTables(written).filter((table) => table === "menu_publications")).toHaveLength(1);
  });

  it("moves the pointer one edition at a time when each is activated at its own instant", async () => {
    const { second, third, fourth } = await queueThree();
    const steps = [
      { at: day(8), live: second, nextDueAt: day(9) },
      { at: day(9), live: third, nextDueAt: day(10) },
      { at: day(10), live: fourth, nextDueAt: null },
    ];
    for (const { at, live, nextDueAt } of steps) {
      const answer = await app((tx) => activateDueMenuPublications(tx, at));
      expect(answer).toEqual({
        activated: [{ menuId: f.lunch, versionId: live.versionId, number: live.number }],
        nextDueAt,
      });
      expect(await pointer()).toMatchObject({ versionId: live.versionId, publishedAt: at });
    }
  });

  it("never moves the pointer to a lower number than it holds", async () => {
    await setSoup("5.50");
    const hash2 = await hashOf(f.lunch);
    const second = await app((tx) => publishMenu(tx, f.lunch, hash2, "person-1", { at: NOW }));
    await setSoup("6.00");
    const hash3 = await hashOf(f.lunch);
    const third = await app((tx) => publishMenu(tx, f.lunch, hash3, "person-1", { at: NOW }));
    await fx.db.run(
      sql`insert into menu_scheduled_publications (version_id, menu_id, activates_at, queued_at, queued_by)
          values (${second.versionId}, ${f.lunch}, ${day(8).toISOString()}, ${NOW.toISOString()}, ${ANA})`,
    );

    vi.setSystemTime(day(9));
    expect((await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.versionId).toBe(
      third.versionId,
    );
    const answer = await app((tx) => activateDueMenuPublications(tx, day(9)));
    expect(answer).toEqual({ activated: [], nextDueAt: null });
    expect(await scheduleRow(second.versionId)).toMatchObject({
      state: "activated",
      activatedAt: day(9),
    });
    expect(await pointer()).toMatchObject({ versionId: third.versionId, publishedAt: NOW });
  });

  it("settles a due edition before a write, and a refused write rolls the settle back too", async () => {
    await setSoup("5.50");
    const second = await queue(day(8));

    const before = await publicationTables();
    await expect(
      app((tx) => cancelMenuPublication(tx, f.lunch, second.versionId, ANA, day(9))),
    ).rejects.toMatchObject({
      code: "menu_publication.not_queued",
      params: { menuId: f.lunch, versionId: second.versionId, state: "activated" },
    });
    expect(await publicationTables()).toEqual(before);
    expect(await scheduleRow(second.versionId)).toMatchObject({ state: "queued" });

    const list = await app((tx) => listMenuPublications(tx, f.lunch, day(9)));
    expect(list.live).toEqual({
      versionId: second.versionId,
      number: 2,
      since: day(8).toISOString(),
    });
    expect(list.editions).toMatchObject([{ versionId: second.versionId, state: "activated" }]);
    expect(await scheduleRow(second.versionId)).toMatchObject({ state: "queued" });

    await setSoup("6.00");
    const hash = await hashOf(f.lunch);
    let published: { versionId: string; number: number } | undefined;
    const prepared = await preparedStatements(async (tx) => {
      published = await publishMenu(tx, f.lunch, hash, "person-1", { at: day(9) });
    });
    expect(published!.number).toBe(3);
    expect(await scheduleRow(second.versionId)).toMatchObject({
      state: "activated",
      activatedAt: day(9),
    });
    const pointerWrites = prepared.filter(({ sql: text }) =>
      /^\s*(?:insert into|update)\s+"menu_publications"/i.test(text),
    );
    expect(pointerWrites).toHaveLength(2);
    expect(pointerWrites[0]!.params).toContain(second.versionId);
    expect(pointerWrites[1]!.params).toContain(published!.versionId);
    expect(await pointer()).toMatchObject({ versionId: published!.versionId, publishedAt: day(9) });
  });

  it("writes only the schedule and the pointer when it activates", async () => {
    await queueThree();
    const written = await statements((tx) => activateDueMenuPublications(tx, day(9)));
    expect(new Set(writtenTables(written))).toEqual(
      new Set(["menu_scheduled_publications", "menu_publications"]),
    );
  });

  it("makes a menu's first edition live by schedule, though the menu was never published", async () => {
    const hash = await hashOf(f.dinner);
    const first = await app((tx) =>
      queueMenuPublication(tx, f.dinner, hash, day(8), ANA, { at: NOW }),
    );
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)).toMatchObject({
      state: "unpublished",
    });
    vi.setSystemTime(day(8));
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)).toMatchObject({
      version: 1,
    });
    expect(await app((tx) => activateDueMenuPublications(tx, day(8)))).toEqual({
      activated: [{ menuId: f.dinner, versionId: first.versionId, number: 1 }],
      nextDueAt: null,
    });
    const [row] = await fx.db
      .select()
      .from(menuPublications)
      .where(eq(menuPublications.menuId, f.dinner));
    expect(row).toMatchObject({ versionId: first.versionId, publishedAt: day(8) });
  });

  it("activates at the clock's instant when none is given", async () => {
    await setSoup("5.50");
    const second = await queue(day(8));
    vi.setSystemTime(day(8));
    expect(await app((tx) => activateDueMenuPublications(tx))).toEqual({
      activated: [{ menuId: f.lunch, versionId: second.versionId, number: 2 }],
      nextDueAt: null,
    });
  });

  it("queues at the clock's instant when none is given", async () => {
    await setSoup("5.50");
    const hash = await hashOf(f.lunch);
    const queued = await app((tx) => queueMenuPublication(tx, f.lunch, hash, day(8), ANA));
    expect(await scheduleRow(queued.versionId)).toMatchObject({ queuedAt: NOW });
  });

  describe("keeps the live read's statement shape", () => {
    const documentReads = (texts: readonly string[]) =>
      texts.filter((text) => /"document"/.test(text));
    const liveReads = (texts: readonly { sql: string; params: unknown[] }[]) =>
      texts.filter(({ sql: text }) => /from "menu_publications"/.test(text));

    it("one metadata statement naming the pointer table once, and no document read when warm", async () => {
      await setSoup("5.50");
      const second = await queue(day(8));
      vi.setSystemTime(day(9));
      const cold = await preparedStatements((tx) => readLiveDocuments(tx, [f.lunch]));
      const live = liveReads(cold);
      expect(live).toHaveLength(1);
      expect(live[0]!.sql.match(/from "menu_publications"/g)).toHaveLength(1);
      expect(documentReads(live.map(({ sql: text }) => text))).toEqual([]);
      expect(documentReads(cold.map(({ sql: text }) => text))).toHaveLength(1);
      const warm = await statements(async (tx) => {
        expect((await readLiveDocuments(tx, [f.lunch])).get(f.lunch)!.versionId).toBe(
          second.versionId,
        );
      });
      expect(documentReads(warm)).toEqual([]);
    });

    it("binds no more than a batch's worth of values in any statement over many menus", async () => {
      const count = 1001;
      const document = JSON.stringify({ format: MENU_DOCUMENT_FORMAT });
      const stamp = NOW.toISOString();
      await fx.db.run(sql`
        with recursive n(i) as (select 1 union all select i + 1 from n where i < ${count})
        insert into catalogues (id, name, active, version, created_at, updated_at)
        select 'planted-menu-' || i, 'Planted ' || i, 1, 1, ${stamp}, ${stamp} from n`);
      await fx.db.run(sql`
        insert into menu_versions (id, menu_id, number, document, content_hash, published_at, published_by)
        select 'planted-version-' || substr(id, 14), id, 1, ${document}, 'planted', ${stamp}, ${ANA}
        from catalogues where id like 'planted-menu-%'`);
      await fx.db.run(sql`
        insert into menu_publications (menu_id, version_id, published_at)
        select id, 'planted-version-' || substr(id, 14), ${stamp}
        from catalogues where id like 'planted-menu-%'`);
      const menuIds = Array.from({ length: count }, (_, i) => `planted-menu-${i + 1}`);

      let size = 0;
      const prepared = await preparedStatements(async (tx) => {
        size = (await readLiveDocuments(tx, menuIds)).size;
      });
      expect(size).toBe(count);
      const live = liveReads(prepared);
      expect(live.length).toBeGreaterThan(1);
      for (const { params } of live) expect(params.length).toBeLessThanOrEqual(BATCH_SIZE);
    });

    it("fetches no document of a due edition that a later due edition hides", async () => {
      const { fourth } = await queueThree();
      vi.setSystemTime(day(11));
      let liveVersion: string | undefined;
      const prepared = await preparedStatements(async (tx) => {
        liveVersion = (await previewMenu(tx, f.lunch)).live!.versionId;
      });
      expect(liveVersion).toBe(fourth.versionId);
      const live = liveReads(prepared);
      expect(live.length).toBeGreaterThan(0);
      for (const statement of live) {
        const rows = await app(async (tx) =>
          tx.all<{ menu_id: string; number: number }>(rebuilt(statement)),
        );
        const lunch = rows.filter((row) => row.menu_id === f.lunch);
        expect(lunch.length).toBeGreaterThan(0);
        expect(lunch.length).toBeLessThanOrEqual(2);
        expect(lunch.map(({ number }) => number).sort()).toEqual([1, 4]);
      }
    });
  });
});
