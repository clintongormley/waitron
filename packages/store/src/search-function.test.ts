import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRankKey } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueStore, type VenueStore } from "./index.js";

const opened: VenueStore<Record<string, never>, Record<string, never>>[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const openStore = async () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-store-search-"));
  const store = await openVenueStore({ directory, venueSchema: {}, nodeSchema: {} });
  opened.push(store);
  return store;
};

type Select = (expression: string) => Promise<unknown>;
type Handle = Awaited<ReturnType<typeof openStore>>["venue" | "node"];

const selectIn = (handle: Handle, expression: string) =>
  (handle.get(sql.raw(`select ${expression} as r`)) as { r: unknown }).r;

/** The write connection serves a read unless another caller's write transaction is open. */
const besideAWrite = async (handle: Handle, expression: string) => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const read = opened.then(() => selectIn(handle, expression));
  await handle.withWriteLock(async () => {
    open();
    await read;
  });
  return read;
};

const paths: [string, (store: Awaited<ReturnType<typeof openStore>>) => Select][] = [
  ["the venue writer", (store) => async (expression) => selectIn(store.venue, expression)],
  [
    "the venue writer's transaction",
    (store) => (expression) =>
      store.venue.withWriteLock(async () => selectIn(store.venue, expression)),
  ],
  ["the venue reader", (store) => (expression) => besideAWrite(store.venue, expression)],
  ["the node writer", (store) => async (expression) => selectIn(store.node, expression)],
  ["the node reader", (store) => (expression) => besideAWrite(store.node, expression)],
];

describe.each(paths)("waitron_search_rank in %s", (_, selectOn) => {
  const ranker = async () => {
    const select = selectOn(await openStore());
    return (expression: string) => select(`waitron_search_rank(${expression})`);
  };

  it("finds a match whatever the accents or capitals on either side", async () => {
    const rank = await ranker();
    expect(await rank("'garcia jose', 'José García'")).not.toBeNull();
    expect(await rank("'GARCÍA', 'Jose Garcia'")).not.toBeNull();
  });

  it("finds nothing for a query of only punctuation", async () => {
    const rank = await ranker();
    expect(await rank("'&', 'Gin & Tonic'")).toBeNull();
  });

  it("never matches a NULL part as the word null", async () => {
    const rank = await ranker();
    expect(await rank("'null', null")).toBeNull();
  });

  it("keeps a NULL or non-text part's place, so a later part is still found at its own index", async () => {
    const rank = await ranker();
    expect(await rank("'terraza', null, 4, 'Terraza 4'")).toBe(
      searchRankKey({ kind: 0, part: 2, position: 0, length: 9 }),
    );
    expect(await rank("'4', 4")).toBeNull();
  });

  it("answers 0 for a blank or NULL query: no search at all", async () => {
    const rank = await ranker();
    expect(await rank("'  ', 'anything'")).toBe(0);
    expect(await rank("null, 'anything'")).toBe(0);
  });

  it("answers the rank's key, so a whole word sorts before the start of one", async () => {
    const rank = await ranker();
    expect(await rank("'gin', 'Gin'")).toBe(
      searchRankKey({ kind: 0, part: 0, position: 0, length: 3 }),
    );
    expect((await rank("'gin', 'Gin'")) as number).toBeLessThan(
      (await rank("'gin', 'Ginger'")) as number,
    );
  });

  it("does not trim the query: a trailing space finishes the last word", async () => {
    const rank = await ranker();
    expect(await rank("'gin ', 'Ginger Ale'")).toBeNull();
  });
});

it("ranks each row by its own query when the query changes from row to row", async () => {
  const store = await openStore();
  const rows = store.venue.all(
    sql.raw(
      `select waitron_search_rank(column1, column2) as r
       from (values ('gin', 'Gin'), ('tonic', 'Gin'), ('gin', 'Gin'))`,
    ),
  );
  expect(rows).toEqual([{ r: 3 }, { r: null }, { r: 3 }]);
});
