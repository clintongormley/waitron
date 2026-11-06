import type {
  DocumentMember,
  FrozenOffer,
  HomeDevice,
  HomeDisplay,
  MenuChange,
  MenuDocument,
  MenuPreview,
} from "./menu-document-types.js";
import type { IncludeFolder, MemberRef, MenuHome, SectionInput } from "./section-types.js";

export interface UndoStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: readonly UndoStructureNode[];
  ownerMenuId?: string;
  includedMenuId?: string;
  folder?: IncludeFolder;
}

export interface MenuUndoInput {
  preview: MenuPreview;
  /** The content languages switched on now. */
  languages: readonly string[];
  structure?: { rootSectionId: string; nodes: readonly UndoStructureNode[] } | null;
  /** The working Home page with member ids. */
  home?: MenuHome | null;
}

/** One write that puts a change back, named for the dashboard client method it maps to, with that
 * method's arguments and the display names a refusal sentence needs. */
export type MenuUndoCommand =
  | { method: "renameCatalogue"; menuId: string; name: string }
  | {
      method: "updateMenuItem";
      menuId: string;
      menuItemId: string;
      input: { grossPrice: string | null };
      name: string;
    }
  | {
      method: "setMenuVariantPrice";
      menuId: string;
      menuItemId: string;
      variantId: string;
      price: string | null;
      name: string;
    }
  | { method: "updateSection"; sectionId: string; patch: Partial<SectionInput>; name: string }
  | {
      method: "setHomeDisplay";
      menuId: string;
      device: HomeDevice;
      patch: Partial<HomeDisplay>;
    };

export type MenuChangeAction =
  | { kind: "undo"; command: MenuUndoCommand }
  | { kind: "edit_product"; productId: string }
  | { kind: "edit_menu"; menuId: string; tab: "structure" | "prices" }
  | { kind: "edit_extras_list"; listId: string }
  | { kind: "none" };

/** Every change's action, by change id, worked out once. */
export function menuChangeActions(input: MenuUndoInput): ReadonlyMap<string, MenuChangeAction> {
  const plan = new Plan(input);
  return new Map(input.preview.changes.map((change) => [change.id, actionFor(plan, change)]));
}

/** One change's action, as `menuChangeActions` would answer it; "none" for an id not listed. */
export function menuChangeAction(input: MenuUndoInput, changeId: string): MenuChangeAction {
  const change = input.preview.changes.find(({ id }) => id === changeId);
  return change === undefined ? NONE : actionFor(new Plan(input), change);
}

const NONE: MenuChangeAction = { kind: "none" };

type SectionNode = Extract<DocumentMember, { kind: "section" }>;
type PlacedOffer = { menuItemId: string; offer: FrozenOffer };

/** A document's offers by product and sections by id, each built on first use. */
class DocumentLookups {
  #offers: Map<string, PlacedOffer> | undefined;
  #sections: Map<string, SectionNode> | undefined;

  constructor(readonly document: MenuDocument) {}

  /** The first offer of the product, in the document's order. */
  offer(productId: string): PlacedOffer | null {
    if (this.#offers === undefined) {
      this.#offers = new Map();
      for (const [menuItemId, offer] of Object.entries(this.document.offers))
        if (!this.#offers.has(offer.productId))
          this.#offers.set(offer.productId, { menuItemId, offer });
    }
    return this.#offers.get(productId) ?? null;
  }

  /** The first section with the id, depth first in the document's order. */
  section(sectionId: string): SectionNode | null {
    if (this.#sections === undefined) {
      const sections = new Map<string, SectionNode>();
      const visit = (members: readonly DocumentMember[]) => {
        for (const member of members) {
          if (member.kind !== "section") continue;
          if (!sections.has(member.sectionId)) sections.set(member.sectionId, member);
          visit(member.members);
        }
      };
      visit(this.document.root.members);
      this.#sections = sections;
    }
    return this.#sections.get(sectionId) ?? null;
  }
}

/** The lookups every change of one preview shares, each document's built on first use. */
class Plan {
  #live: DocumentLookups | undefined;
  #now: DocumentLookups | undefined;

  constructor(readonly input: MenuUndoInput) {}

  /** Read only for a menu that has been published. */
  get live(): DocumentLookups {
    return (this.#live ??= new DocumentLookups(this.input.preview.live!.document));
  }

  get now(): DocumentLookups {
    return (this.#now ??= new DocumentLookups(this.input.preview.document));
  }
}

function actionFor(plan: Plan, change: MenuChange): MenuChangeAction {
  switch (change.source) {
    case "shared_product":
      return sharedProductAction(change);
    case "included_menu":
      return includedMenuAction(change);
    case "this_menu":
      return plan.input.preview.live === null ? NONE : thisMenuAction(plan, change);
  }
}

function thisMenuAction(plan: Plan, change: MenuChange): MenuChangeAction {
  const now = plan.input.preview.document;
  switch (change.kind) {
    case "menu_renamed":
      return undo({ method: "renameCatalogue", menuId: now.menuId, name: change.from });
    case "home_display_changed":
      return homeDisplayUndo(plan.live.document, now, change.device);
    case "section_changed":
      return ownSectionUndo(plan.input.languages, plan.live, plan.now, change);
    case "price_changed":
      return dishPriceUndo(plan.live, plan.now, change);
    case "product_changed":
      return variantPriceUndo(plan.live, plan.now, change);
    default:
      return NONE;
  }
}

const undo = (command: MenuUndoCommand): MenuChangeAction => ({ kind: "undo", command });

function homeDisplayUndo(
  live: MenuDocument,
  now: MenuDocument,
  device: HomeDevice,
): MenuChangeAction {
  const was = live.home[device];
  const is = now.home[device];
  const patch = Object.fromEntries(
    (["columns", "tiles", "order"] as const)
      .filter((field) => was[field] !== is[field])
      .map((field) => [field, was[field]]),
  ) as Partial<HomeDisplay>;
  if (Object.keys(patch).length === 0) return NONE;
  return undo({ method: "setHomeDisplay", menuId: now.menuId, device, patch });
}

/** Writing back this menu's own price puts back the whole live price only when the live version
 * set one (an own price always wins) or what it would inherit now is the live price. */
function dishPriceUndo(
  live: DocumentLookups,
  now: DocumentLookups,
  change: Extract<MenuChange, { kind: "price_changed" }>,
): MenuChangeAction {
  const was = live.offer(change.productId)?.offer;
  const is = now.offer(change.productId);
  if (was === undefined || is === null) return NONE;
  if (was.grossPrice === null && change.inheritedPrice !== was.unitPrice) return NONE;
  return undo({
    method: "updateMenuItem",
    menuId: now.document.menuId,
    menuItemId: is.menuItemId,
    input: { grossPrice: was.grossPrice },
    name: change.name,
  });
}

/** One variant's own menu price put back. Not while the dish's own menu price moved and another
 * variant's price moved with no setting of its own changing (the same bullet lists it, and this
 * write leaves it), nor when the variant had no price here live and what it would charge without
 * one has moved since. */
function variantPriceUndo(
  live: DocumentLookups,
  now: DocumentLookups,
  change: Extract<MenuChange, { kind: "product_changed" }>,
): MenuChangeAction {
  const was = live.offer(change.productId)?.offer;
  const is = now.offer(change.productId);
  if (was === undefined || is === null) return NONE;
  const dishMoved = was.grossPrice !== is.offer.grossPrice;
  const before = new Map(was.variants.map((variant) => [variant.id, variant]));
  const differing = [];
  for (const variant of is.offer.variants) {
    const old = before.get(variant.id);
    if (old === undefined) continue;
    if (old.menuPrice !== variant.menuPrice) differing.push({ old, variant });
    else if (dishMoved && old.unitPrice !== variant.unitPrice) return NONE;
  }
  if (differing.length !== 1) return NONE;
  const { old, variant } = differing[0]!;
  if (old.menuPrice === null && change.inheritedVariantPrices?.[variant.id] !== old.unitPrice)
    return NONE;
  return undo({
    method: "setMenuVariantPrice",
    menuId: now.document.menuId,
    menuItemId: is.menuItemId,
    variantId: variant.id,
    price: old.menuPrice,
    name: change.name,
  });
}

/** Puts back an own section's names, photo and colour. A switched-off language whose name differs
 * live and now gets no Undo: the save refuses a switched-off language unless it is unchanged
 * (`mergeOptionalTranslations`). */
function ownSectionUndo(
  languages: readonly string[],
  live: DocumentLookups,
  now: DocumentLookups,
  change: Extract<MenuChange, { kind: "section_changed" }>,
): MenuChangeAction {
  const was = live.section(change.sectionId);
  const is = now.section(change.sectionId);
  // Whether a section is an include never changes.
  if (was === null || is === null || was.includedMenu !== undefined) return NONE;
  const patch: Partial<SectionInput> = {};
  for (const field of change.fields)
    switch (field) {
      case "names": {
        const enabled = new Set(languages);
        const switchedOff = new Set(
          [...Object.keys(was.names), ...Object.keys(is.names)].filter((l) => !enabled.has(l)),
        );
        for (const language of switchedOff)
          if (was.names[language] !== is.names[language]) return NONE;
        patch.internalName = was.internalName;
        patch.names = was.names;
        break;
      }
      case "image":
      case "color":
        patch[field] = was[field];
        break;
    }
  return undo({ method: "updateSection", sectionId: change.sectionId, patch, name: change.name });
}

function sharedProductAction(change: MenuChange): MenuChangeAction {
  switch (change.kind) {
    case "product_deleted":
    case "product_removed":
      return NONE;
    case "extra_portion_changed":
    case "extra_max_quantity_changed":
      return { kind: "edit_extras_list", listId: change.listId };
    default:
      return "productId" in change ? { kind: "edit_product", productId: change.productId } : NONE;
  }
}

function includedMenuAction(change: MenuChange): MenuChangeAction {
  if (change.includedMenu === undefined) return NONE;
  const prices =
    change.kind === "price_changed" ||
    (change.kind === "product_changed" && change.fields.every((field) => field === "variants"));
  return {
    kind: "edit_menu",
    menuId: change.includedMenu.id,
    tab: prices ? "prices" : "structure",
  };
}
