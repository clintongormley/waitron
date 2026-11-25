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

interface DeclarationCopy {
  /** What a declarations change corrects: the same in every version, whatever offer ids it holds. */
  subject: string;
  /** The copy's own place, to find the same copy in another version. */
  place: string;
  productId: string;
  target: MenuPatchTarget;
  values: object;
}

const subjectOf = (target: MenuPatchTarget, productId: string): string =>
  `${target.kind}/${target.kind === "extra" ? target.listId : ""}/${productId}`;

/** Every dish, variant and extra copy the document holds, ordinary dishes' before set menus'. */
function declarationCopies(document: MenuDocument): DeclarationCopy[] {
  return [...Object.values(document.offers), ...documentSetMenuOffers(document)].flatMap(
    (offer): DeclarationCopy[] => {
      const copy = (target: MenuPatchTarget, productId: string, holder: object) => {
        const subject = subjectOf(target, productId);
        const values = copyDeclarations(target.kind, holder);
        return { subject, place: `${offer.id}/${subject}`, productId, target, values };
      };
      return [
        copy({ kind: "offer", menuItemId: offer.id }, offer.productId, offer),
        ...offer.variants.map((variant) => {
          const { id } = variant;
          return copy({ kind: "variant", menuItemId: offer.id, variantId: id }, id, variant);
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

/** The queued versions holding a copy of something on the live version that is not the product's
 * current declarations, each with the live version's targets that would correct it. */
export function queuedDeclarationDrift(
  queued: readonly { versionId: string; activatesAt: Date; document: MenuDocument }[],
  live: MenuDocument,
  current: ReadonlyMap<string, DeclarationValues>,
): QueuedDeclarationDrift[] {
  const liveSubjects = subjects(live);
  const liveValues = new Map(
    declarationCopies(live).map(({ place, values }) => [place, canonicalJson(values)]),
  );
  return queued.flatMap(({ versionId, activatesAt, document }) => {
    const stillOld = new Map<string, boolean>();
    for (const { subject, place, productId, target, values } of declarationCopies(document)) {
      const wanted = current.get(productId);
      if (wanted === undefined || !liveSubjects.has(subject)) continue;
      const held = canonicalJson(values);
      if (held === canonicalJson(declarationsFor(target.kind, wanted))) continue;
      stillOld.set(subject, (stillOld.get(subject) ?? true) && liveValues.get(place) === held);
    }
    const targets = [...stillOld].map(([subject, old]) => ({
      target: liveSubjects.get(subject)!.target,
      stillOld: old,
    }));
    return targets.length === 0
      ? []
      : [{ versionId, activatesAt: activatesAt.toISOString(), targets }];
  });
}

/** Each queued version the declarations changes of a patch of `live` change, with them applied
 * wherever it holds what they change; no other field of the patch reaches it. */
export function queuedCorrections(
  queued: readonly { versionId: string; contentHash: string; document: MenuDocument }[],
  live: MenuDocument,
  changes: readonly MenuPatchChange[],
  languages: ContentLanguages,
  current: ReadonlyMap<string, DeclarationValues>,
): Map<string, MenuDocument> {
  const corrections = new Map<string, MenuDocument>();
  for (const { versionId, contentHash, document } of queued) {
    const held = subjects(document);
    const corrected = applyMenuPatch(
      document,
      changes.flatMap((change) =>
        declarationProductIds(live, [change]).flatMap((productId) => {
          const copy = held.get(subjectOf(change.target, productId));
          return copy === undefined ? [] : [{ ...change, target: copy.target }];
        }),
      ),
      languages,
      current,
    );
    if (menuDocumentHash(corrected) !== contentHash) corrections.set(versionId, corrected);
  }
  return corrections;
}
