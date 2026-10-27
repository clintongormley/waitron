import { decimal, hasCode, isAppError, toScale, type ContentLanguages } from "@waitron/shared";
import type {
  DocumentMember,
  FrozenOffer,
  FrozenOfferedModifier,
  MenuDocument,
} from "@waitron/catalogue/src/menu-document-types.js";
import {
  applyMenuPatch,
  fixedLanguages,
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

/** Whether `settled` no longer holds some text `staged` held in a language. */
function lostText(staged: MenuPatchChange, settled: MenuPatchChange): boolean {
  const after = settled.value as Record<string, string>;
  return Object.entries(staged.value as Record<string, string>).some(
    ([language, text]) => after[language] !== text,
  );
}

/** The changes staged in the patch dialog, each against the live version it was read from. */
export class MenuPatchDraft {
  private readonly staged = new Map<string, MenuPatchChange>();
  /** How many staged changes each target has, by `targetKey`. */
  private readonly perTarget = new Map<string, number>();

  constructor(
    private document: MenuDocument,
    private languages: ContentLanguages,
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

  /** `change` holding the live text in each name language every folder fixes, which no patch
   * changes (`applyMenuPatch` lays the folders' names back on top). */
  private settled(change: MenuPatchChange): MenuPatchChange {
    const value = change.value;
    if (change.field !== "names" || typeof value !== "object" || value === null) return change;
    const fixed = fixedLanguages(this.document, change.target, "names", this.languages);
    if (fixed.length === 0) return change;
    const live = patchFieldValue(this.document, change.target, "names", this.languages) as
      Record<string, string> | undefined;
    if (live === undefined) return change;
    const settled = { ...(value as Record<string, string>) };
    for (const language of fixed)
      if (live[language] === undefined) delete settled[language];
      else settled[language] = live[language];
    return { ...change, value: settled };
  }

  /** A translated `change`, typed over the text `left` stores, holding text in exactly the content
   * languages. A language whose text still equals what `left` stores takes the stored text, or a
   * blank, so a send clears nothing the person did not and never puts back text a newer version
   * replaced; a switched-off language's text goes, since the patch keeps each copy's stored text
   * there and copies may differ in it. `lost` says whether text that went was typed. */
  private inLanguages(
    change: MenuPatchChange,
    left: { document: MenuDocument; languages: ContentLanguages },
  ): { change: MenuPatchChange; lost: boolean } {
    const value = change.value;
    if (!TRANSLATED.has(change.field) || typeof value !== "object" || value === null)
      return { change, lost: false };
    const text = value as Record<string, string>;
    const base = (patchFieldValue(left.document, change.target, change.field, left.languages) ??
      {}) as Record<string, string>;
    const enabled = this.languages.languages;
    const stored = (patchFieldValue(this.document, change.target, change.field, this.languages) ??
      {}) as Record<string, string>;
    const typed = (language: string) =>
      Object.hasOwn(text, language) && text[language] !== (base[language] ?? "");
    const lost = Object.keys(text).some(
      (language) => !enabled.includes(language) && typed(language),
    );
    const kept = enabled.map((language) => [
      language,
      typed(language) ? text[language] : (stored[language] ?? ""),
    ]);
    return sameTranslations(Object.fromEntries(kept), text)
      ? { change, lost }
      : { change: { ...change, value: Object.fromEntries(kept) }, lost };
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

  set(given: MenuPatchChange): void {
    const change = this.settled(given);
    if (this.isLive(change)) this.unstage(`${targetKey(change.target)}/${change.field}`);
    else this.stage(change);
  }

  /** Takes back the field's change, if it has one. */
  clear(target: MenuPatchTarget, field: string): void {
    this.unstage(`${targetKey(target)}/${field}`);
  }

  changes(): MenuPatchChange[] {
    return [...this.staged.values()];
  }

  changed(target: MenuPatchTarget): boolean {
    return this.perTarget.has(targetKey(target));
  }

  /** Moves the draft onto a newer live version, judged with `languages`. Every staged change was
   * typed over the version the draft is leaving, so that version's stored text tells what the
   * person typed. A change that version already holds goes without being counted; one
   * `applyMenuPatch` refuses on it is dropped and counted, and so is one left holding only the
   * live text once a name language every folder now fixes takes the live text in place of what was
   * typed. `trimmed` holds the keys of the changes, kept or gone, whose typed text in a
   * switched-off language was let go, less any refused afterwards. */
  rebase(
    document: MenuDocument,
    languages = this.languages,
  ): { dropped: number; trimmed: string[] } {
    const left = { document: this.document, languages: this.languages };
    this.document = document;
    this.languages = languages;
    const dropped = new Set<string>();
    const trimmed = new Set<string>();
    for (const [key, staged] of this.staged) {
      const { change: inLanguages, lost } = this.inLanguages(staged, left);
      const change = this.settled(inLanguages);
      const lostFixed = change !== inLanguages && lostText(inLanguages, change);
      if (lost) trimmed.add(key);
      if (this.isLive(change)) {
        if (lostFixed) dropped.add(key);
        this.unstage(key);
      } else this.staged.set(key, change);
    }
    for (;;) {
      const entries = [...this.staged];
      try {
        applyMenuPatch(
          document,
          entries.map(([, change]) => change),
          this.languages,
        );
        return { dropped: dropped.size, trimmed: [...trimmed] };
      } catch (error) {
        if (!isAppError(error) || !hasCode(error, "menu_patch.invalid")) throw error;
        // Each refusal names the first change it could not apply, so dropping it and retrying
        // finds every refused change.
        const [key] = entries[error.params.change]!;
        this.unstage(key);
        trimmed.delete(key);
        dropped.add(key);
      }
    }
  }
}
