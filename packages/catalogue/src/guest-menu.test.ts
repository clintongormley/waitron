import { expect, it } from "vitest";
import { catalogues, readSettings, saveSettings, withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { setVenueDefaultCatalogue, deactivateCatalogue } from "./operations.js";
import { previewMenu, publishMenu } from "./menu-publication.js";
import { GUEST_MENU_SETTINGS } from "./guest-menu-settings.js";
import { readGuestMenu } from "./guest-menu.js";

const fx = useCatalogueDb();
it("shares only the opted-in active default's publication and follows a default change", async () => {
  const f = await menusFixture(fx.db);
  await withTransaction(fx.db, async (tx) => {
    await setVenueDefaultCatalogue(tx, f.lunch);
    const preview = await previewMenu(tx, f.lunch);
    const published = await publishMenu(tx, f.lunch, preview.hash, "person-1");
    expect(await readGuestMenu(tx)).toBeNull();
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
    expect((await readGuestMenu(tx))?.versionId).toBe(published.versionId);
    await setVenueDefaultCatalogue(tx, f.dinner);
    expect(await readGuestMenu(tx)).toBeNull();
    const dinner = await previewMenu(tx, f.dinner);
    const next = await publishMenu(tx, f.dinner, dinner.hash, "person-1");
    expect((await readGuestMenu(tx))?.versionId).toBe(next.versionId);
    await deactivateCatalogue(tx, f.dinner);
    expect(await readGuestMenu(tx)).toBeNull();
    await setVenueDefaultCatalogue(tx, f.lunch);
    const current = await readSettings(tx, GUEST_MENU_SETTINGS);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: false },
      expectedRevision: current.revision,
      personId: null,
    });
    expect(await readGuestMenu(tx)).toBeNull();
  });
});
it("exposes no menu when sharing is On but no default exists", async () => {
  await withTransaction(fx.db, async (tx) => {
    await tx.update(catalogues).set({ isDefault: false });
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
    expect(await readGuestMenu(tx)).toBeNull();
  });
});
