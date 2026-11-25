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
  DeclaredCopy,
  MenuPatchChange,
  MenuPatchTarget,
  QueuedDeclarationDrift,
} from "./menu-patch-types.js";

export interface DeclarationCopy extends DeclaredCopy {
  /** What a declarations change corrects: the same in every version, whatever offer ids it holds. */
  subject: string;
  target: MenuPatchTarget;
  /** A variant's dish, whose declarations change takes the variant too. */
  dish?: DeclarationCopy;
}

const subjectOf = (target: MenuPatchTarget, productId: string): string =>
  `${target.kind}/${target.kind === "extra" ? target.listId : ""}/${productId}`;

/** Every dish, variant and extra copy the document holds, ordinary dishes' before set menus'. */
function declarationCopies(document: MenuDocument): DeclarationCopy[] {
  return [...Object.values(document.offers), ...documentSetMenuOffers(document)].flatMap(
    (offer): DeclarationCopy[] => {
      const copy = (target: MenuPatchTarget, productId: string, holder: { name: string }) => ({
        subject: subjectOf(target, productId),
        productId,
        name: holder.name,
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

/** A target and what it takes in one queued version. */
interface TakingTarget {
  target: MenuPatchTarget;
  differs: boolean;
  stillOld: boolean;
  /** A differing copy is of a variant `correctedFrom` does not know, whose product's current values
   * are not its dish's. */
  unshown: boolean;
  /** Each distinct value of each product. */
  held: Map<string, DeclaredCopy>;
}

/** The queued versions holding a copy that is not the product's current declarations, each with the
 * targets that would correct it. A variant `correctedFrom` does not know has its dish's old value. */
export function queuedDeclarationDrift(
  queued: readonly { versionId: string; activatesAt: Date; document: MenuDocument }[],
  current: ReadonlyMap<string, DeclarationValues>,
  correctedFrom: CorrectedFrom,
): QueuedDeclarationDrift[] {
  return queued.flatMap(({ versionId, activatesAt, document }) => {
    const takers = new Map<string, TakingTarget>();
    for (const copy of declarationCopies(document)) {
      const { productId, name, values } = copy;
      const wanted = current.get(productId);
      if (wanted === undefined) continue;
      const held = canonicalJson(values);
      const differs = held !== canonicalJson(declarationsFor(copy.target.kind, wanted));
      const known = correctedFrom(copy);
      const from = known ?? (copy.dish && correctedFrom(copy.dish));
      const dishWanted = copy.dish && current.get(copy.dish.productId);
      const unshown =
        differs &&
        known === undefined &&
        copy.dish !== undefined &&
        canonicalJson(dishWanted ?? null) !== canonicalJson(wanted);
      const stillOld = !differs || canonicalJson(from?.values ?? null) === held;
      for (const taking of copy.dish === undefined ? [copy] : [copy.dish, copy]) {
        const target = correctedFrom(taking)?.target;
        if (target === undefined) continue;
        const taker = takers.get(taking.subject) ?? {
          target,
          differs: false,
          stillOld: true,
          unshown: false,
          held: new Map(),
        };
        takers.set(taking.subject, taker);
        taker.differs ||= differs;
        taker.stillOld &&= stillOld;
        taker.unshown ||= unshown;
        taker.held.set(`${productId}/${held}`, { productId, name, values });
      }
    }
    const targets = [...takers.values()].flatMap(({ target, differs, stillOld, unshown, held }) =>
      !differs
        ? []
        : [
            stillOld && !unshown
              ? { target, stillOld }
              : { target, stillOld, replaces: [...held.values()] },
          ],
    );
    return targets.length === 0
      ? []
      : [{ versionId, activatesAt: activatesAt.toISOString(), targets }];
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
  return changes.flatMap((change) => {
    const [productId] = declarationProductIds(live, [change]);
    const copy = productId && held.get(subjectOf(change.target, productId));
    return copy ? [{ ...change, target: copy.target }] : [];
  });
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
): Map<string, { document: MenuDocument; contentHash: string }> {
  const corrections = new Map<string, { document: MenuDocument; contentHash: string }>();
  for (const edition of queued) {
    const document = applyMenuPatch(edition.document, edition.changes, languages, current);
    const contentHash = menuDocumentHash(document);
    if (contentHash !== edition.contentHash)
      corrections.set(edition.versionId, { document, contentHash });
  }
  return corrections;
}
