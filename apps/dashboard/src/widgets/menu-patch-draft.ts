import { decimal, hasCode, isAppError, toScale, type ContentLanguages } from "@waitron/shared";
import type {
  DocumentMember,
  FrozenOffer,
  FrozenOfferedModifier,
  MenuDocument,
} from "@waitron/catalogue/src/menu-document-types.js";
import {
  applyMenuPatch,
  parseMenuPatch,
  patchFieldValue,
} from "@waitron/catalogue/src/menu-patch.js";
import type { MenuPatchChange, MenuPatchTarget } from "@waitron/catalogue/src/menu-patch-types.js";
import { mergeOptionalTranslations } from "@waitron/catalogue/src/optional-translations.js";

/** `target` is null only for the group holding the extras and options lists. */
export interface PatchTreeNode {
  target: MenuPatchTarget | null;
  label: string;
  children: PatchTreeNode[];
}

const leaf = (target: MenuPatchTarget, label: string): PatchTreeNode => ({
  target,
  label,
  children: [],
});

function memberNodes(document: MenuDocument, members: readonly DocumentMember[]): PatchTreeNode[] {
  return members.flatMap((member): PatchTreeNode[] => {
    if (member.kind === "section")
      return [
        {
          target: { kind: "section", sectionId: member.sectionId },
          label: member.internalName,
          children: memberNodes(document, member.members),
        },
      ];
    const offer = document.offers[member.menuItemId];
    if (offer === undefined) return [];
    return [
      {
        target: { kind: "offer", menuItemId: member.menuItemId },
        label: offer.name,
        children: offer.variants.map((variant) =>
          leaf(
            { kind: "variant", menuItemId: member.menuItemId, variantId: variant.id },
            variant.name,
          ),
        ),
      },
    ];
  });
}

function* offersInMenuOrder(
  document: MenuDocument,
  members: readonly DocumentMember[],
): Generator<FrozenOffer> {
  for (const member of members)
    if (member.kind === "section") yield* offersInMenuOrder(document, member.members);
    else if (document.offers[member.menuItemId] !== undefined)
      yield document.offers[member.menuItemId]!;
}

/** One node per list however many dishes offer it, in the order the menu first shows one. A dish's
 * copy of an extras list may hold only some of its items, so the node holds every item any copy
 * holds. */
function listNodes(document: MenuDocument): PatchTreeNode[] {
  const lists = new Map<string, { node: PatchTreeNode; seen: Set<string> }>();
  for (const offer of offersInMenuOrder(document, document.root.members))
    for (const list of offer.offeredModifiers as FrozenOfferedModifier[]) {
      const key = `${list.kind}:${list.id}`;
      let entry = lists.get(key);
      if (entry === undefined) {
        entry = {
          node: {
            target: { kind: "list", listKind: list.kind, listId: list.id },
            label: list.name,
            children: [],
          },
          seen: new Set(),
        };
        lists.set(key, entry);
      }
      const children =
        list.kind === "extras"
          ? list.items.map((item) => ({
              id: item.productId,
              node: leaf({ kind: "extra", listId: list.id, productId: item.productId }, item.name),
            }))
          : list.labels.map((label) => ({
              id: label.id,
              node: leaf({ kind: "option_label", listId: list.id, labelId: label.id }, label.name),
            }));
      for (const child of children)
        if (!entry.seen.has(child.id)) {
          entry.seen.add(child.id);
          entry.node.children.push(child.node);
        }
    }
  return [...lists.values()].map((entry) => entry.node);
}

/** The menu in document order, each dish holding its variants, then one group labelled
 * `listsLabel` holding every extras and options list, left out when there is none. */
export function patchTree(document: MenuDocument, listsLabel: string): PatchTreeNode[] {
  const lists = listNodes(document);
  return [
    ...memberNodes(document, document.root.members),
    ...(lists.length === 0 ? [] : [{ target: null, label: listsLabel, children: lists }]),
  ];
}

export function targetKey(target: MenuPatchTarget): string {
  switch (target.kind) {
    case "offer":
      return `offer:${target.menuItemId}`;
    case "variant":
      return `variant:${target.menuItemId}:${target.variantId}`;
    case "extra":
      return `extra:${target.listId}:${target.productId}`;
    case "option_label":
      return `option_label:${target.listId}:${target.labelId}`;
    case "list":
      return `list:${target.listKind}:${target.listId}`;
    case "section":
      return `section:${target.sectionId}`;
  }
}

const TRANSLATED = new Set(["customerName", "names", "description"]);

function sameTranslations(
  left: Record<string, string> | null,
  right: Record<string, string> | null,
): boolean {
  const a = Object.entries(left ?? {});
  const b = right ?? {};
  return a.length === Object.keys(b).length && a.every(([language, text]) => b[language] === text);
}

/** The changes staged in the patch dialog, each against the live version it was read from. */
export class MenuPatchDraft {
  private readonly staged = new Map<string, MenuPatchChange>();
  /** How many staged changes each target has, by `targetKey`. */
  private readonly perTarget = new Map<string, number>();

  constructor(
    private document: MenuDocument,
    private readonly languages: ContentLanguages,
  ) {}

  /** Whether `change` leaves its field as the live version holds it, judged as `applyMenuPatch`
   * would write it; a value the patch refuses never does, so the form can show the refusal. */
  private isLive(change: MenuPatchChange): boolean {
    let value: unknown;
    try {
      value = parseMenuPatch([change])[0]!.value;
    } catch {
      return false;
    }
    const live = patchFieldValue(this.document, change.target, change.field, this.languages);
    if (TRANSLATED.has(change.field)) {
      const current = live as Record<string, string> | null;
      let merged: Record<string, string> | null;
      try {
        merged = mergeOptionalTranslations(
          current,
          value as Record<string, string> | null,
          this.languages,
        );
      } catch {
        return false;
      }
      return sameTranslations(merged, current);
    }
    if (change.field === "price") return toScale(decimal(value as string), 2) === live;
    return value === live;
  }

  private stage(change: MenuPatchChange): void {
    const target = targetKey(change.target);
    const key = `${target}/${change.field}`;
    if (!this.staged.has(key)) this.perTarget.set(target, (this.perTarget.get(target) ?? 0) + 1);
    this.staged.set(key, change);
  }

  private unstage(key: string): void {
    const change = this.staged.get(key);
    if (change === undefined) return;
    this.staged.delete(key);
    const target = targetKey(change.target);
    const left = this.perTarget.get(target)! - 1;
    if (left === 0) this.perTarget.delete(target);
    else this.perTarget.set(target, left);
  }

  set(change: MenuPatchChange): void {
    if (this.isLive(change)) this.unstage(`${targetKey(change.target)}/${change.field}`);
    else this.stage(change);
  }

  changes(): MenuPatchChange[] {
    return [...this.staged.values()];
  }

  changed(target: MenuPatchTarget): boolean {
    return this.perTarget.has(targetKey(target));
  }

  /** Moves the draft onto a newer live version. A change that version already holds goes without
   * being counted; one `applyMenuPatch` refuses on it is dropped and counted. */
  rebase(document: MenuDocument): { dropped: number } {
    this.document = document;
    for (const [key, change] of this.staged) if (this.isLive(change)) this.unstage(key);
    let dropped = 0;
    for (;;) {
      const entries = [...this.staged];
      try {
        applyMenuPatch(
          document,
          entries.map(([, change]) => change),
          this.languages,
        );
        return { dropped };
      } catch (error) {
        if (!isAppError(error) || !hasCode(error, "menu_patch.invalid")) throw error;
        // Each refusal names the first change it could not apply, so dropping it and retrying
        // finds every refused change.
        this.unstage(entries[error.params.change]![0]);
        dropped += 1;
      }
    }
  }
}
