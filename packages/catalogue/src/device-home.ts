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
  handheld: { min: 2, max: 3 },
  till: { min: 4, max: 10 },
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

const WORD = "[\\p{L}\\p{N}]";

/** A pattern for `word` at the start of a word of a folded name, and, with `whole`, at its end too.
 * A word holds only letters and digits, so it needs no escaping inside a pattern. */
function wordPattern(word: string, whole: boolean): RegExp {
  return new RegExp(`(?<!${WORD})${word}${whole ? `(?!${WORD})` : ""}`, "u");
}

/** Searches names already passed through `foldForSearch`, each beside the value it names. A name
 * matches when it holds every word typed, in any order, so "gin tonic" finds "Gin & Tonic". A word
 * followed by a space or punctuation must be a whole word of the name; the word still being typed
 * may be any part of one, so "gin" finds "Ginger Ale" and "gin " does not. The last word typed
 * orders the matches: a whole word, then the start of a word, then the middle of one; then the
 * earlier match, then the shorter name; then the order given. */
export function searchFor(query: string): <T>(named: readonly (readonly [T, string])[]) => T[] {
  const folded = foldForSearch(query);
  const words = folded.match(new RegExp(`${WORD}+`, "gu")) ?? [];
  const typing = new RegExp(`${WORD}$`, "u").test(folded) ? words.pop() : undefined;
  const whole = words.map((word) => wordPattern(word, true));
  const matches = ([, name]: readonly [unknown, string]) =>
    whole.every((pattern) => pattern.test(name)) && (typing === undefined || name.includes(typing));
  const last = typing ?? words.at(-1);
  if (last === undefined) return (named) => named.filter(matches).map(([value]) => value);
  const wholeLast = wordPattern(last, true);
  const startLast = wordPattern(last, false);
  const rank = (name: string): [number, number] => {
    const atWhole = wholeLast.exec(name);
    if (atWhole !== null) return [0, atWhole.index];
    const atStart = startLast.exec(name);
    return atStart === null ? [2, name.indexOf(last)] : [1, atStart.index];
  };
  return (named) =>
    named
      .filter(matches)
      .map(([value, name]) => ({ value, name, rank: rank(name) }))
      .sort(
        (left, right) =>
          left.rank[0] - right.rank[0] ||
          left.rank[1] - right.rank[1] ||
          left.name.length - right.name.length,
      )
      .map(({ value }) => value);
}

type DocumentSection = Extract<DocumentMember, { kind: "section" }>;

/** The members a device draws for `members`: an include shown directly gives way to its own
 * members, in their order; a direct include among those gives way too. */
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
  /** The members home's list shows, before tiles with nothing to order are dropped. */
  home: DocumentMember[];
  /** Keyed by section id: the first copy `home` draws of each section in `sections`. */
  homeCopies: Map<string, DocumentSection>;
}

/** One step of an open section's path: the section, and which of its list's drawn copies, from 0.
 * A drawn list can hold one section twice only through an include shown directly. */
export interface SectionStep {
  sectionId: string;
  copy: number;
}

/** The copy of section `id` a device opens from home: the first one home draws, else the one the
 * index holds. A shortcut tile is drawn from this copy too, so its label matches the page. */
export function openedSection(
  id: string,
  index: Pick<HomeIndex<unknown>, "sections" | "homeCopies">,
): DocumentSection | undefined {
  return index.homeCopies.get(id) ?? index.sections.get(id);
}

/** For each member of a list drawn beneath `path`, the path its tile opens; a product's is empty. */
export function tilePaths(
  list: readonly DocumentMember[],
  path: readonly SectionStep[],
): SectionStep[][] {
  const seen = new Map<string, number>();
  return list.map((member) => {
    if (member.kind !== "section") return [];
    const copy = seen.get(member.sectionId) ?? 0;
    seen.set(member.sectionId, copy + 1);
    return [...path, { sectionId: member.sectionId, copy }];
  });
}

function drawnCopy(
  list: readonly DocumentMember[],
  { sectionId, copy }: SectionStep,
): DocumentSection | undefined {
  let seen = 0;
  for (const member of list)
    if (member.kind === "section" && member.sectionId === sectionId && seen++ === copy)
      return member;
  return undefined;
}

/** The sections `path` opens, or null once a step's section is not in the index or its list no
 * longer draws that copy. A first copy is also looked for among a list's own members, so a folder
 * left open stays open when a new menu shows it directly, and at home in the index, which is where
 * a shortcut opens it. */
export function sectionTrail(
  path: readonly SectionStep[],
  index: Pick<HomeIndex<unknown>, "sections" | "home" | "homeCopies">,
): DocumentSection[] | null {
  const trail: DocumentSection[] = [];
  for (const step of path) {
    if (!index.sections.has(step.sectionId)) return null;
    const previous = trail.at(-1);
    let next: DocumentSection | undefined;
    if (previous === undefined)
      next = step.copy === 0 ? openedSection(step.sectionId, index) : drawnCopy(index.home, step);
    else
      next =
        drawnCopy(shownMembers(previous.members), step) ??
        (step.copy === 0 ? drawnCopy(previous.members, step) : undefined);
    if (next === undefined) return null;
    trail.push(next);
  }
  return trail;
}

export function indexDocument<P>(
  members: readonly DocumentMember[],
  offerOf: (menuItemId: string) => P | undefined,
): HomeIndex<P> {
  const index: HomeIndex<P> = {
    sections: new Map(),
    products: new Map(),
    home: shownMembers(members),
    homeCopies: new Map(),
  };
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
  for (const member of index.home)
    if (
      member.kind === "section" &&
      index.sections.has(member.sectionId) &&
      !index.homeCopies.has(member.sectionId)
    )
      index.homeCopies.set(member.sectionId, member);
  return index;
}

/** Up to `--columns` tracks, fewer wherever a tile would be narrower than its minimum. auto-fill
 * keeps a track's width the same however many tiles there are, so tiles fill row by row. */
export const HOME_GRID_COLUMNS =
  "repeat(auto-fill, minmax(max(var(--home-tile-min, calc(var(--wt-tap-min) * 2 + var(--wt-space-4))), calc((100% - (var(--columns) - 1) * var(--wt-space-3)) / var(--columns))), 1fr))";
