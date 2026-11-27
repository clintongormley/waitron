import {
  expandDietaryDeclarations,
  type GuestDeclarations,
  type GuestMember,
} from "@waitron/shared";

type Dish = Extract<GuestMember, { kind: "product" }>;

export function choiceCaution({ allergens }: GuestDeclarations, excluded: readonly string[]) {
  if (!excluded.length) return;
  if (allergens === null) return "unreviewedAllergens";
  if (excluded.some((code) => Object.hasOwn(allergens, code))) return "selectedAllergen";
}

function extrasOf({ modifiers }: Dish) {
  return modifiers.flatMap((group) => (group.kind === "extras" ? group.items : []));
}

export function hasCautionedChoice(dish: Dish, excluded: readonly string[]) {
  return [...dish.variants, ...extrasOf(dish)].some((choice) => choiceCaution(choice, excluded));
}

function dishCaution(dish: Dish, excluded: readonly string[]) {
  if (!excluded.length) return;
  const extras = extrasOf(dish)
    .filter((extra) => extra.preselected)
    .map((extra) => choiceCaution(extra, excluded));
  if (extras.includes("selectedAllergen")) return "selectedAllergen";
  const unreviewedExtra = extras.includes("unreviewedAllergens")
    ? "unreviewedAllergens"
    : undefined;
  if (!dish.variants.length) return choiceCaution(dish, excluded) ?? unreviewedExtra;
  const variants = dish.variants.map((choice) => choiceCaution(choice, excluded));
  if (variants.every((caution) => caution === "selectedAllergen")) return "selectedAllergen";
  if (dish.allergens === null || variants.every((caution) => caution !== undefined))
    return "unreviewedAllergens";
  return unreviewedExtra;
}

export function filterCustomerMenu(
  members: GuestMember[],
  query: string,
  language: string,
  diet: string,
  excluded: readonly string[],
) {
  let hidden = 0;
  let unreviewed = 0;
  let dishes = 0;
  const match = (member: GuestMember): GuestMember[] => {
    if (member.kind === "section") {
      const children = member.members.flatMap(match);
      return children.length ? [{ ...member, members: children }] : [];
    }
    if (query && !member.name.toLocaleLowerCase(language).includes(query)) return [];
    if (member.kind === "set_menu") return [member];
    if (diet && !expandDietaryDeclarations(member.dietary).some((label) => label === diet))
      return [];
    if (diet === "no_fish" && Object.hasOwn(member.allergens ?? {}, "fish")) return [];
    const caution = dishCaution(member, excluded);
    if (caution) {
      hidden++;
      if (caution === "unreviewedAllergens") unreviewed++;
      return [];
    }
    dishes++;
    return [member];
  };
  const entries = members.flatMap((member, index) =>
    match(member).map((matched) => ({ member: matched, sectionId: `section-${index}` })),
  );
  return { entries, hidden, unreviewed, dishes };
}
