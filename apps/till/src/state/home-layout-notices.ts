import type { MenuState, TillZoneMenu } from "../api/client.js";

/** The loaded menus with a poll's layout answers applied: a menu whose layout changed on the version
 * the till holds becomes a new object, which is what the menu browser watches for. A menu the poll
 * names at another version waits for its reload. The same array comes back when nothing changed. */
export function withPolledLayouts(
  loaded: TillZoneMenu[],
  polled: MenuState["menus"],
): TillZoneMenu[] {
  let changed = false;
  const menus = loaded.map((menu) => {
    const answer = polled.find((each) => each.menuId === menu.id);
    if (
      answer === undefined ||
      answer.versionId !== menu.versionId ||
      (answer.homeLayoutId === menu.homeLayoutId && answer.layoutFallback === menu.layoutFallback)
    )
      return menu;
    changed = true;
    return { ...menu, homeLayoutId: answer.homeLayoutId, layoutFallback: answer.layoutFallback };
  });
  return changed ? menus : loaded;
}

/** A menu whose chosen home layout was removed, and that layout's name when the till showed it. */
export interface RemovedLayout {
  menuName: string;
  layoutName?: string;
}

/**
 * Says each removed home layout once per page load: the server repeats the reason on every answer
 * until a manager changes the choice.
 */
export class RemovedLayoutReports {
  /** Per menu something has been said about, the ids of the named layouts said so far. */
  readonly #reported = new Map<string, Set<string>>();

  /** What is new to say about `next`, naming a removed layout from `shown`, the menus the till was
   * showing, when it showed that layout. */
  report(shown: readonly TillZoneMenu[], next: readonly TillZoneMenu[]): RemovedLayout[] {
    const found: RemovedLayout[] = [];
    for (const menu of next) {
      if (menu.layoutFallback !== "layout_removed") continue;
      const before = shown.find((each) => each.id === menu.id);
      const removed =
        before === undefined || before.homeLayoutId === menu.homeLayoutId
          ? undefined
          : before.homeLayouts.find((layout) => layout.id === before.homeLayoutId);
      const reported = this.#reported.get(menu.id);
      // A removal the till cannot name left the screen on the default it already showed, so it is
      // said only while nothing has been said about this menu: on a first load, not on the poll
      // answers that repeat the reason.
      if (removed === undefined ? reported !== undefined : reported?.has(removed.id)) continue;
      const named = reported ?? new Set<string>();
      if (removed !== undefined) named.add(removed.id);
      this.#reported.set(menu.id, named);
      found.push({ menuName: menu.name, layoutName: removed?.name });
    }
    return found;
  }
}
