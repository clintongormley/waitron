import type { ContentLanguages, MenuDocument } from "@waitron/shared";
import type { DeclarationValues } from "./declaration-values.js";
import { canonicalJson, documentSetMenuOffers, menuDocumentHash } from "./menu-document.js";
import {
  applyMenuPatch,
  copyDeclarations,
  declarationProductIds,
  declarationsFor,
} from "./menu-patch.js";
import type {
  MenuPatchChange,
  MenuPatchTarget,
  QueuedDeclarationDrift,
} from "./menu-patch-types.js";

export interface DeclarationCopy {
  /** What a declarations change corrects: the same in every version, whatever offer ids it holds. */
  subject: string;
  productId: string;
  target: MenuPatchTarget;
  values: object;
  /** A variant's dish, whose declarations change takes the variant too. */
  dish?: DeclarationCopy;
}

const subjectOf = (target: MenuPatchTarget, productId: string): string =>
  `${target.kind}/${target.kind === "extra" ? target.listId : ""}/${productId}`;

/** Every dish, variant and extra copy the document holds, ordinary dishes' before set menus'. */
function declarationCopies(document: MenuDocument): DeclarationCopy[] {
  return [...Object.values(document.offers), ...documentSetMenuOffers(document)].flatMap(
    (offer): DeclarationCopy[] => {
      const copy = (target: MenuPatchTarget, productId: string, holder: object) => ({
        subject: subjectOf(target, productId),
        productId,
        target,
        values: copyDeclarations(target.kind, holder),
      });
      const dish = copy({ kind: "offer", menuItemId: offer.id }, offer.productId, offer);
      return [
        dish,
        ...offer.variants.map((variant) => {
          const { id } = variant;
          const target = { kind: "variant", menuItemId: offer.id, variantId: id } as const;
          return { ...copy(target, id, variant), dish };
        }),
        ...offer.offeredModifiers.flatMap((list) =>
          list.kind === "extras"
            ? list.items.map((item) => {
                const { productId } = item;
                return copy({ kind: "extra", listId: list.id, productId }, productId, item);
              })
            : [],
        ),
      ];
    },
  );
}

/** The first copy of each subject. */
function subjects(document: MenuDocument): Map<string, DeclarationCopy> {
  const first = new Map<string, DeclarationCopy>();
  for (const copy of declarationCopies(document))
    if (!first.has(copy.subject)) first.set(copy.subject, copy);
  return first;
}

/** The products whose declarations the document holds. */
export function declaredProductIds(document: MenuDocument): string[] {
  return [...new Set(declarationCopies(document).map(({ productId }) => productId))];
}

/** What a queued copy is corrected from: the target naming its subject, and the value being
 * corrected, `null` when no one value is; `undefined` for a copy that is not corrected. */
export type CorrectedFrom = (
  copy: DeclarationCopy,
) => { target: MenuPatchTarget; values: object | null } | undefined;

/** What Patch live menu corrects: the live version's targets, and the value every live copy of the
 * subject holds. */
export function liveDeclarations(live: MenuDocument): CorrectedFrom {
  const found = new Map<string, { target: MenuPatchTarget; values: object | null }>();
  for (const { subject, target, values } of declarationCopies(live)) {
    const first = found.get(subject);
    if (first === undefined) found.set(subject, { target, values });
    else if (canonicalJson(first.values) !== canonicalJson(values)) first.values = null;
  }
  return ({ subject }) => found.get(subject);
}

/** The queued versions holding a copy that is not the product's current declarations, each with the
 * targets that would correct it. */
export function queuedDeclarationDrift(
  queued: readonly { versionId: string; activatesAt: Date; document: MenuDocument }[],
  current: ReadonlyMap<string, DeclarationValues>,
  correctedFrom: CorrectedFrom,
): QueuedDeclarationDrift[] {
  return queued.flatMap(({ versionId, activatesAt, document }) => {
    const listed = new Map<string, QueuedDeclarationDrift["targets"][number]>();
    for (const copy of declarationCopies(document)) {
      const wanted = current.get(copy.productId);
      const held = canonicalJson(copy.values);
      if (wanted === undefined || held === canonicalJson(declarationsFor(copy.target.kind, wanted)))
        continue;
      const stillOld = canonicalJson(correctedFrom(copy)?.values ?? null) === held;
      for (const taking of copy.dish === undefined ? [copy] : [copy.dish, copy]) {
        const target = correctedFrom(taking)?.target;
        if (target === undefined) continue;
        const entry = listed.get(taking.subject);
        if (entry === undefined) listed.set(taking.subject, { target, stillOld });
        else entry.stillOld &&= stillOld;
      }
    }
    return listed.size === 0
      ? []
      : [{ versionId, activatesAt: activatesAt.toISOString(), targets: [...listed.values()] }];
  });
}

/** The declarations changes of a patch of `live`, at the copies the queued `document` holds; no
 * other field of the patch reaches it. */
export function queuedChanges(
  document: MenuDocument,
  live: MenuDocument,
  changes: readonly MenuPatchChange[],
): MenuPatchChange[] {
  const held = subjects(document);
  return changes.flatMap((change) =>
    declarationProductIds(live, [change]).flatMap((productId) => {
      const copy = held.get(subjectOf(change.target, productId));
      return copy === undefined ? [] : [{ ...change, target: copy.target }];
    }),
  );
}

/** Each queued version its own `changes` change, with them applied. */
export function queuedCorrections(
  queued: readonly {
    versionId: string;
    contentHash: string;
    document: MenuDocument;
    changes: readonly MenuPatchChange[];
  }[],
  languages: ContentLanguages,
  current: ReadonlyMap<string, DeclarationValues>,
): Map<string, MenuDocument> {
  const corrections = new Map<string, MenuDocument>();
  for (const { versionId, contentHash, document, changes } of queued) {
    const corrected = applyMenuPatch(document, changes, languages, current);
    if (menuDocumentHash(corrected) !== contentHash) corrections.set(versionId, corrected);
  }
  return corrections;
}
