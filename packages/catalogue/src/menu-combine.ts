import { compareDecimal, type Decimal } from "@waitron/shared";
import type {
  Candidate,
  CombinedOffer,
  CombineInput,
  MenuClash,
  Setting,
} from "./menu-combine-types.js";

function resolve<T>(candidates: Candidate<T>[], equal: (a: T, b: T) => boolean): Setting<T> {
  const first = candidates[0];
  if (first === undefined) throw new Error("A menu offer needs a place");
  if (
    "undecided" in first ||
    candidates.some((c) => "undecided" in c || !equal(first.value, c.value))
  )
    return { state: "clash", candidates };
  return { state: "decided", value: first.value, source: first.source, otherwise: null };
}
function own<T>(value: T | null, otherwise: Setting<T>): Setting<T> {
  return value === null
    ? otherwise
    : { state: "decided", value, source: { kind: "own" }, otherwise };
}
function includedCandidate<T>(
  included: CombineInput["included"][number],
  setting: Setting<T>,
): Candidate<T> {
  const place = { kind: "menu" as const, menuId: included.menuId, menuName: included.menuName };
  return setting.state === "clash"
    ? { place, undecided: true }
    : { place, value: setting.value, source: { ...place, from: setting.source } };
}
export function combineOffer(input: CombineInput): CombinedOffer {
  const { catalogue, placedInOwnSections, included } = input;
  const candidates = <T>(value: T, read: (offer: CombinedOffer) => Setting<T>): Candidate<T>[] => [
    ...(placedInOwnSections
      ? [{ place: { kind: "own_sections" as const }, value, source: { kind: "product" as const } }]
      : []),
    ...included.map((i) => includedCandidate(i, read(i.offer))),
  ];
  const moneyEqual = (a: Decimal, b: Decimal) => compareDecimal(a, b) === 0;
  const otherwisePrice = resolve(
    candidates(catalogue.price, (o) => o.price),
    moneyEqual,
  );
  const price = own(input.own.price, otherwisePrice);
  const parent = (
    setting: Setting<Decimal>,
    otherwise: Setting<Decimal> | null,
  ): Setting<Decimal> =>
    setting.state === "clash"
      ? setting
      : { state: "decided", value: setting.value, source: { kind: "parent" }, otherwise };
  const variants = catalogue.variants.map((variant) => {
    const override = input.own.variants.find((v) => v.variantId === variant.variantId);
    const variantCandidates: Candidate<Decimal>[] = [];
    if (placedInOwnSections && variant.price !== null)
      variantCandidates.push({
        place: { kind: "own_sections" },
        value: variant.price,
        source: { kind: "product" },
      });
    for (const i of included) {
      const includedVariant = i.offer.variants.find((v) => v.variantId === variant.variantId);
      if (includedVariant?.price.level === "variant")
        variantCandidates.push(includedCandidate(i, includedVariant.price));
    }
    const fallback =
      variantCandidates.length > 0
        ? resolve(variantCandidates, moneyEqual)
        : parent(price, input.own.price === null ? null : parent(otherwisePrice, null));
    const variantPrice = own(override?.price ?? null, fallback);
    return {
      variantId: variant.variantId,
      price: {
        ...variantPrice,
        level:
          override?.price != null || variantCandidates.length > 0
            ? ("variant" as const)
            : ("product" as const),
      },
    };
  });
  return { productId: input.productId, price, variants };
}
export function clashesOf(offer: CombinedOffer): MenuClash[] {
  const found: MenuClash[] = [];
  const add = (variantId: string | null, setting: Setting<Decimal>) => {
    if (setting.state === "clash")
      found.push({
        productId: offer.productId,
        variantId,
        field: "price",
        candidates: setting.candidates,
      });
  };
  if (offer.variants.length === 0) add(null, offer.price);
  else for (const variant of offer.variants) add(variant.variantId, variant.price);
  return found;
}
