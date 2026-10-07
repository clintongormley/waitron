import { isStoredColor } from "./color-inheritance.js";
import type {
  DocumentMember,
  HomeDevice,
  HomeDisplay,
  HomeOrder,
  HomeTileMode,
} from "./menu-document-types.js";

/**
 * How a menu's Device Home Page is presented, shared by the server's checks, the till's menu
 * browser and the dashboard's preview. Browser-safe: it imports no database or server code, so the
 * two apps deep-import it.
 */

export const HOME_DEVICES = ["handheld", "till"] as const satisfies readonly HomeDevice[];
export const HOME_TILE_MODES = ["colours", "thumbnails"] as const satisfies readonly HomeTileMode[];
export const HOME_ORDERS = ["home_first", "menu_first"] as const satisfies readonly HomeOrder[];

export const HOME_DISPLAY_DEFAULTS: Readonly<Record<HomeDevice, Readonly<HomeDisplay>>> = {
  handheld: { columns: 3, tiles: "colours", order: "home_first" },
  till: { columns: 6, tiles: "colours", order: "home_first" },
};

export const HOME_COLUMN_RANGE: Readonly<Record<HomeDevice, { min: number; max: number }>> = {
  handheld: { min: 2, max: 6 },
  till: { min: 6, max: 10 },
};

/** A key of `patch` holding a value `device` cannot take, or null. An absent key is not
 * checked. The columns have no CHECK, so this is the whole of the range's enforcement. */
export function homeDisplayProblem(
  device: HomeDevice,
  patch: { columns?: unknown; tiles?: unknown; order?: unknown },
): keyof HomeDisplay | null {
  const { min, max } = HOME_COLUMN_RANGE[device];
  const { columns, tiles, order } = patch;
  if (
    columns !== undefined &&
    !(typeof columns === "number" && Number.isInteger(columns) && columns >= min && columns <= max)
  )
    return "columns";
  if (tiles !== undefined && !(HOME_TILE_MODES as readonly unknown[]).includes(tiles))
    return "tiles";
  if (order !== undefined && !(HOME_ORDERS as readonly unknown[]).includes(order)) return "order";
  return null;
}

export type HomeBlock = "shortcuts" | "menu";

/** The blocks under search in the display's order, leaving out one with nothing to show; the
 * divider only between two. It never reorders anything inside a block. */
export function arrangeHome(
  order: HomeOrder,
  shortcutsShown: boolean,
  menuShown: boolean,
): { blocks: HomeBlock[]; divider: boolean } {
  const both: HomeBlock[] = order === "menu_first" ? ["menu", "shortcuts"] : ["shortcuts", "menu"];
  const blocks = both.filter((block) => (block === "shortcuts" ? shortcutsShown : menuShown));
  return { blocks, divider: blocks.length === 2 };
}

export type TileFill =
  { kind: "image"; image: string } | { kind: "color"; color: string } | { kind: "neutral" };

/** A tile's fill: in Thumbnails mode its image, else its colour; in Colours mode its colour; else
 * neutral. A colour is checked because it lands in a style attribute. */
export function tileFill(
  mode: HomeTileMode,
  image: string | null | undefined,
  color: string | null | undefined,
): TileFill {
  if (mode === "thumbnails" && typeof image === "string" && image !== "")
    return { kind: "image", image };
  return isStoredColor(color) ? { kind: "color", color } : { kind: "neutral" };
}

export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

type DocumentSection = Extract<DocumentMember, { kind: "section" }>;

/** The members a device draws for `members`: an include shown directly gives way to its own
 * members, in their order, all the way down. */
export function shownMembers(members: readonly DocumentMember[]): DocumentMember[] {
  return members.flatMap((member) =>
    member.kind === "section" && member.direct === true ? shownMembers(member.members) : [member],
  );
}

export interface HomeIndex<P> {
  /** Keyed by section id: every section with something to order somewhere beneath it. */
  sections: Map<string, DocumentSection>;
  /** Keyed by product id: each product the structure reaches and `offerOf` answers, once. */
  products: Map<string, P>;
}

export function indexDocument<P>(
  members: readonly DocumentMember[],
  offerOf: (menuItemId: string) => P | undefined,
): HomeIndex<P> {
  const index: HomeIndex<P> = { sections: new Map(), products: new Map() };
  const walk = (list: readonly DocumentMember[]): boolean => {
    let holdsSomething = false;
    for (const member of list) {
      if (member.kind === "product") {
        const offer = offerOf(member.menuItemId);
        if (offer === undefined) continue;
        holdsSomething = true;
        // A product placed twice keeps its first place: a Map keeps a key where it was first set.
        index.products.set(member.productId, offer);
      } else if (walk(member.members)) {
        holdsSomething = true;
        index.sections.set(member.sectionId, member);
      }
    }
    return holdsSomething;
  };
  walk(members);
  return index;
}

/** Up to `--columns` tracks, fewer wherever a tile would be narrower than its minimum. auto-fill
 * keeps a track's width the same however many tiles there are, so tiles fill row by row. */
export const HOME_GRID_COLUMNS =
  "repeat(auto-fill, minmax(max(calc(var(--wt-tap-min) * 2 + var(--wt-space-4)), calc((100% - (var(--columns) - 1) * var(--wt-space-3)) / var(--columns))), 1fr))";
