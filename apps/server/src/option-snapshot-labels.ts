import { kitchenPresentationName, nonBlankTranslations } from "@waitron/catalogue";
import { resolveSnapshotText } from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * One `<list>: <label>` line per options answer a dish froze. Two surfaces read these answers and
 * they name the same thing differently: {@link optionSnapshotLabels} is what a COOK reads and
 * {@link customerOptionSnapshotLabels} is what a DINER reads.
 *
 * Common to both: the staff names arrive as locale → text maps because the snapshot widened them on
 * the way in (`OptionSnapshot`, `packages/shared/src/option-selection.ts`); the widening puts the one
 * plain name under the venue's default content language, so a staff map holds exactly one entry.
 * A list and a label carry no variant, which is why the presentation helpers below collapse to a
 * plain two-way fallback.
 *
 * Extras are not here: each pick is its own priced child line, which each caller prints itself.
 */

/**
 * The KITCHEN's wording — the printed kitchen ticket, its correction slip and its reprint, all built
 * by `buildTicketItems` (`apps/server/src/kitchen-print.ts`, the one caller). Each side prints its
 * kitchen name and falls back to the STAFF name, never to the customer text, which is why each side
 * goes through `kitchenPresentationName` (`packages/catalogue/src/product-presentation.ts`) rather
 * than restating that rule.
 *
 * There is no locale parameter and no call to `resolveSnapshotText`
 * (`packages/shared/src/content-languages.ts`): that helper needs a requested language and a default
 * language to choose BETWEEN entries, and a staff map holds one entry, so any value in it is the name.
 */
export function optionSnapshotLabels(snapshots: readonly OptionSnapshot[]): string[] {
  const side = (kitchenName: string | null, staffNames: Record<string, string>) =>
    kitchenPresentationName({
      name: Object.values(staffNames)[0] ?? "",
      kitchenName,
      variantName: null,
      variantKitchenName: null,
    });
  return snapshots.map(
    (snapshot) =>
      `${side(snapshot.listKitchenName, snapshot.listName)}: ` +
      `${side(snapshot.labelKitchenName, snapshot.labelName)}`,
  );
}

/**
 * The DINER's wording — the printed customer receipt (`apps/server/src/receipt-ticket.ts`, the one
 * caller). Each side takes its customer text and falls back to the STAFF name, never to the kitchen
 * name, which is a cook's shorthand and identifies the goods to nobody else. The fold that decides
 * whether a customer map counts as holding anything is `nonBlankTranslations`
 * (`packages/catalogue/src/product-presentation.ts`), shared with `customerPresentationText` so the
 * two cannot disagree about a map of blanks.
 *
 * The chosen map is then resolved by `resolveSnapshotText`
 * (`packages/shared/src/content-languages.ts`), called the same way
 * `joinCustomerPresentationText` calls it for a line's own name — requested language and default
 * alike, because a frozen answer has no default of its own to fall back to. Two things that
 * resolver does and an exact-key lookup does not, each of which decides what a diner reads:
 * it matches a full tag ("es-ES") against a map keyed by bare content-language codes, which is how
 * `buildLineExtras` keys BOTH maps (`apps/server/src/modifier-selection.ts` copies the catalogue
 * row's customer map through whole and widens each staff name under the venue's default content
 * language); and when the requested language holds no text it takes the first non-blank value over
 * SORTED keys, so a map `nonBlankTranslations` kept for text in one language cannot print a blank
 * from another. A line's `descriptions` need neither: `toInvoiceLineDescriptions`
 * (`packages/catalogue/src/invoice-descriptions.ts`) has already re-keyed them onto the venue's
 * invoice locales, and nothing re-keys an options answer.
 */
export function customerOptionSnapshotLabels(
  snapshots: readonly OptionSnapshot[],
  locale: string,
): string[] {
  const side = (
    customerNames: Record<string, string> | null,
    staffNames: Record<string, string>,
  ) => {
    const names = nonBlankTranslations(customerNames) ?? staffNames;
    return resolveSnapshotText(names, locale, locale);
  };
  return snapshots.map(
    (snapshot) =>
      `${side(snapshot.listCustomerName, snapshot.listName)}: ` +
      `${side(snapshot.labelCustomerName, snapshot.labelName)}`,
  );
}
