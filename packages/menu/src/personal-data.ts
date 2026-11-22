import { menuReleases, menus, menuVersions } from "@waitron/db";
import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { eq } from "drizzle-orm";

const FILE = "menu-publications.json";

export const MENU_PERSONAL_DATA: ModulePersonalData = {
  files: [FILE],

  async prepare(tx, { personId }) {
    const created = await tx
      .select({
        menuId: menuVersions.menuId,
        menuName: menus.name,
        edition: menuVersions.number,
        at: menuVersions.createdAt,
      })
      .from(menuVersions)
      .innerJoin(menus, eq(menus.id, menuVersions.menuId))
      .where(eq(menuVersions.createdBy, personId));
    const cancelled = await tx
      .select({
        menuId: menuReleases.menuId,
        menuName: menus.name,
        edition: menuVersions.number,
        at: menuReleases.cancelledAt,
      })
      .from(menuReleases)
      .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
      .innerJoin(menus, eq(menus.id, menuReleases.menuId))
      .where(eq(menuReleases.cancelledBy, personId));

    return async () => {
      if (created.length === 0 && cancelled.length === 0) return [];
      const entries = [
        ...created.map(({ at, ...row }) => ({ ...row, action: "created", at: at.toISOString() })),
        // menu_releases_settled_ck requires a cancellation time whenever cancelled_by is set.
        ...cancelled.map(({ at, ...row }) => ({
          ...row,
          action: "cancelled",
          at: at!.toISOString(),
        })),
      ];
      entries.sort(
        (a, b) =>
          a.at.localeCompare(b.at) ||
          a.menuId.localeCompare(b.menuId) ||
          a.edition - b.edition ||
          a.action.localeCompare(b.action),
      );
      return [jsonFile(FILE, { entries })];
    };
  },
};
