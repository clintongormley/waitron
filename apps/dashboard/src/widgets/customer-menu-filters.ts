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

function excludesDish(dish: Dish, excluded: readonly string[]) {
  if (!excluded.length) return false;
  if (extrasOf(dish).some((extra) => extra.preselected && choiceCaution(extra, excluded)))
    return true;
  if (!dish.variants.length) return choiceCaution(dish, excluded) !== undefined;
  return (
    dish.allergens === null ||
    dish.variants.every((choice) => choiceCaution(choice, excluded) !== undefined)
  );
}

export function filterCustomerMenu(
  members: GuestMember[],
  query: string,
  language: string,
  diet: string,
  excluded: readonly string[],
) {
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
    if (excludesDish(member, excluded)) return [];
    dishes++;
    return [member];
  };
  const entries = members.flatMap((member, index) =>
    match(member).map((matched) => ({ member: matched, sectionId: `section-${index}` })),
  );
  return { entries, dishes };
}
