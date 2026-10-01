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
  const boolEqual = (a: boolean, b: boolean) => a === b;
  const otherwisePrice = resolve(
    candidates(catalogue.price, (o) => o.price),
    moneyEqual,
  );
  const price = own(input.own.price, otherwisePrice);
  const offered = own(
    input.own.offered,
    resolve(
      candidates(true, (o) => o.offered),
      boolEqual,
    ),
  );
  const parent = (
    setting: Setting<Decimal>,
    otherwise: Setting<Decimal> | null,
  ): Setting<Decimal> =>
    setting.state === "clash"
      ? setting
      : { state: "decided", value: setting.value, source: { kind: "parent" }, otherwise };
  const variants = catalogue.variants.map((variant) => {
    const override = input.own.variants.find((v) => v.variantId === variant.variantId);
    const sizeCandidates: Candidate<Decimal>[] = [];
    if (placedInOwnSections && variant.price !== null)
      sizeCandidates.push({
        place: { kind: "own_sections" },
        value: variant.price,
        source: { kind: "product" },
      });
    for (const i of included) {
      const size = i.offer.variants.find((v) => v.variantId === variant.variantId);
      if (size?.price.level === "size") sizeCandidates.push(includedCandidate(i, size.price));
    }
    const fallback =
      sizeCandidates.length > 0
        ? resolve(sizeCandidates, moneyEqual)
        : parent(price, input.own.price === null ? null : parent(otherwisePrice, null));
    const variantPrice = own(override?.price ?? null, fallback);
    return {
      variantId: variant.variantId,
      offered: own(
        override?.offered ?? null,
        resolve(
          candidates(
            true,
            (o) => o.variants.find((v) => v.variantId === variant.variantId)!.offered,
          ),
          boolEqual,
        ),
      ),
      price: {
        ...variantPrice,
        level:
          override?.price != null || sizeCandidates.length > 0
            ? ("size" as const)
            : ("product" as const),
      },
    };
  });
  return { productId: input.productId, offered, price, variants };
}
export function clashesOf(offer: CombinedOffer): MenuClash[] {
  const found: MenuClash[] = [];
  const add = (
    variantId: string | null,
    field: "price" | "offered",
    setting: Setting<Decimal> | Setting<boolean>,
  ) => {
    if (setting.state === "clash")
      found.push({ productId: offer.productId, variantId, field, candidates: setting.candidates });
  };
  add(null, "offered", offer.offered);
  for (const variant of offer.variants) add(variant.variantId, "offered", variant.offered);
  if (offer.offered.state === "decided" && offer.offered.value) {
    if (offer.variants.length === 0) add(null, "price", offer.price);
    else
      for (const variant of offer.variants)
        if (variant.offered.state === "decided" && variant.offered.value)
          add(variant.variantId, "price", variant.price);
  }
  return found;
}
