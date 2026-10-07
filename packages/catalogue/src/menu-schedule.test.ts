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
import { documentImages } from "./menu-document.js";
import { menuStatus, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import {
  cancelMenuPublication,
  listMenuPublications,
  queueMenuPublication,
} from "./menu-schedule.js";
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

afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-10-07T08:00:00.000Z");
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
