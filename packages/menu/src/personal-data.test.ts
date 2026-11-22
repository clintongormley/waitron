import { withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { jsonFile } from "@waitron/module";
import { expect, it } from "vitest";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, offerOf } from "../test/menus-fixture.js";
import { patchLiveMenu, previewMenu, publishMenu } from "./menu-publication.js";
import { cancelMenuPublication, queueMenuPublication } from "./menu-schedule.js";
import { updateMenuDetails, updateProduct } from "./operations.js";
import { MENU_PERSONAL_DATA } from "./personal-data.js";

const suite = useMenuDb();
const firstAt = new Date("2026-10-07T08:00:00.000Z");
const queuedAt = new Date("2026-10-07T09:00:00.000Z");
const editedAt = new Date("2026-10-07T10:00:00.000Z");
const activatesAt = new Date("2026-10-08T06:00:00.000Z");

async function download(personId: string) {
  const db = suite.db;
  const build = await db.withWriteLock(() =>
    MENU_PERSONAL_DATA.prepare(db, { personId, language: "en", at: editedAt, timeZone: "UTC" }),
  );
  return build();
}

it("shows each person's editions and cancellations, including the original author and time on a requeued edition", async () => {
  const { lunch, soup, lemonade } = await menusFixture(suite.db);
  const publisher = await seedPerson(suite.db, { displayName: "Publisher" });
  const editor = await seedPerson(suite.db, { displayName: "Editor" });
  const canceller = await seedPerson(suite.db, { displayName: "Canceller" });
  const colleague = await seedPerson(suite.db, { displayName: "Colleague" });
  await withTransaction(suite.db, async (tx) => {
    const first = await previewMenu(tx, lunch);
    const live = await publishMenu(tx, lunch, first.hash, publisher, { at: firstAt });
    await updateProduct(tx, soup, { unitPrice: "5.50" });
    const next = await previewMenu(tx, lunch);
    await queueMenuPublication(tx, lunch, next.hash, activatesAt, publisher, { at: queuedAt });
    const menuItemId = await offerOf(tx, lunch, lemonade);
    const edited = await patchLiveMenu(
      tx,
      lunch,
      live.versionId,
      [{ target: { kind: "offer", menuItemId }, field: "price", value: "5.50" }],
      editor,
      { at: editedAt },
    );
    await cancelMenuPublication(tx, lunch, edited.requeued[0]!.versionId, canceller, editedAt);
    await updateMenuDetails(tx, lunch, { name: "Today’s lunch" });
  });

  const menu = { menuId: lunch, menuName: "Today’s lunch" };
  const file = "menu-publications.json";
  expect(await download(publisher)).toEqual([
    jsonFile(file, {
      entries: [
        { ...menu, edition: 1, action: "created", at: "2026-10-07T08:00:00.000Z" },
        { ...menu, edition: 2, action: "created", at: "2026-10-07T09:00:00.000Z" },
        { ...menu, edition: 4, action: "created", at: "2026-10-07T09:00:00.000Z" },
      ],
    }),
  ]);
  expect(await download(editor)).toEqual([
    jsonFile(file, {
      entries: [
        { ...menu, edition: 2, action: "cancelled", at: "2026-10-07T10:00:00.000Z" },
        { ...menu, edition: 3, action: "created", at: "2026-10-07T10:00:00.000Z" },
      ],
    }),
  ]);
  expect(await download(canceller)).toEqual([
    jsonFile(file, {
      entries: [{ ...menu, edition: 4, action: "cancelled", at: "2026-10-07T10:00:00.000Z" }],
    }),
  ]);
  expect(await download(colleague)).toEqual([]);
});
