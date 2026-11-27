import type { ContentLanguages } from "../content-languages.js";
import { matchLanguage } from "../language-match.js";
import { ALLERGEN_CODES, type ProductAllergens } from "./allergens.js";
import { DIETARY_LABELS, type DietaryLabel } from "./dietary-declarations.js";
import { menuPriceRange, resolveMenuText } from "./customer-menu-presentation.js";
import type {
  DocumentMember,
  FrozenOffer,
  MenuDocument,
  PublishedSetMenu,
} from "./menu-document-types.js";

export interface GuestDeclarations {
  allergens: ProductAllergens | null;
  dietary: DietaryLabel[];
}
export interface GuestChoice extends GuestDeclarations {
  name: string;
  price: string;
  unit: string;
}
export type GuestModifier =
  | { kind: "extras"; name: string; items: (GuestChoice & { portion: string })[] }
  | { kind: "options"; name: string; labels: string[] };
export type GuestMember =
  | { kind: "section"; name: string; members: GuestMember[] }
  | {
      kind: "set_menu";
      name: string;
      price: string;
      lines: { count: number; courses: string[]; choices: GuestChoice[] }[];
    }
  | (GuestDeclarations & {
      kind: "product";
      name: string;
      description: string;
      image: string | null;
      price: { min: string; max: string };
      unit: string;
      variants: GuestChoice[];
      modifiers: GuestModifier[];
    });
export interface PublicGuestMenu {
  name: string;
  language: string;
  languages: string[];
  members: GuestMember[];
}

export type CustomerMenuPreview =
  { state: "unpublished" } | { state: "published"; menu: PublicGuestMenu };

export function publicGuestMenu(
  document: MenuDocument,
  config: ContentLanguages,
  requested: string | readonly string[],
  eachUnitId: string,
): PublicGuestMenu {
  const language =
    matchLanguage(typeof requested === "string" ? [requested] : requested, [
      config.defaultLanguage,
      ...config.languages.filter((tag) => tag !== config.defaultLanguage),
    ]) ?? config.defaultLanguage;
  const text = (map: Record<string, string> | null, staff: string | null) =>
    resolveMenuText(map, staff, { kind: "customer", language }, config).text;
  const declarations = (
    allergens: ProductAllergens | null,
    dietary: DietaryLabel[],
  ): GuestDeclarations => ({
    allergens:
      allergens === null
        ? null
        : Object.fromEntries(
            ALLERGEN_CODES.filter((code) => Object.hasOwn(allergens, code)).map((code) => [
              code,
              allergens[code]!.kinds ? { kinds: [...allergens[code]!.kinds!] } : {},
            ]),
          ),
    dietary: DIETARY_LABELS.filter((label) => dietary.includes(label)),
  });
  const unit = (value: {
    id: string;
    abbreviation: Record<string, string>;
    staffAbbreviation: string;
  }) => (value.id === eachUnitId ? "" : text(value.abbreviation, value.staffAbbreviation));
  const choice = (
    offer: Pick<FrozenOffer, "unitPrice" | "unit" | "allergens" | "dietaryDeclarations">,
    name: string,
  ): GuestChoice => ({
    name,
    price: offer.unitPrice,
    unit: unit(offer.unit),
    ...declarations(offer.allergens, offer.dietaryDeclarations),
  });
  const setMenu = (set: PublishedSetMenu): GuestMember => {
    const choices = set.root.members.flatMap(
      (member): { course: string; choice: GuestChoice }[] => {
        if (member.kind !== "product") return [];
        const offer = set.offers[member.menuItemId]!;
        if (offer.ordering === "staff_only") return [];
        const name = text(offer.customerName, offer.name);
        return offer.variants.length
          ? offer.variants.map((variant) => ({
              course: variant.countsAsCourseId,
              choice: choice(variant, `${name} (${text(variant.customerName, variant.name)})`),
            }))
          : [{ course: offer.countsAsCourseId!, choice: choice(offer, name) }];
      },
    );
    return {
      kind: "set_menu",
      name: text(set.terms.names, set.name),
      price: set.terms.price,
      lines: set.terms.lines.map(({ count, courseIds }) => ({
        count,
        courses: courseIds.map((id) => text(set.courses[id]!.names, set.courses[id]!.name)),
        choices: choices
          .filter(({ course }) => courseIds.includes(course))
          .map((item) => item.choice),
      })),
    };
  };
  const walk = (members: DocumentMember[]): GuestMember[] =>
    members.flatMap((member): GuestMember[] => {
      if (member.kind === "section") {
        const children = walk(member.members);
        return member.direct || children.length === 0
          ? children
          : [{ kind: "section", name: text(member.names, member.internalName), members: children }];
      }
      if (member.kind === "set_menu") {
        const set = document.setMenus?.[member.menuId];
        return set === undefined ? [] : [setMenu(set)];
      }
      const offer = document.offers[member.menuItemId]!;
      if (offer.ordering !== undefined && offer.ordering !== "public") return [];
      return [
        {
          kind: "product",
          name: text(offer.customerName, offer.name),
          description: text(offer.description, null),
          image: offer.image,
          price: menuPriceRange(offer),
          unit: unit(offer.unit),
          ...declarations(offer.allergens, offer.dietaryDeclarations),
          variants: offer.variants.map((v) => choice(v, text(v.customerName, v.name))),
          modifiers: offer.offeredModifiers.map((modifier) =>
            modifier.kind === "options"
              ? {
                  kind: "options",
                  name: text(modifier.customerName, modifier.name),
                  labels: modifier.labels.map((label) => text(label.customerName, label.name)),
                }
              : {
                  kind: "extras",
                  name: text(modifier.customerName, modifier.name),
                  items: modifier.items.map((extra) => {
                    const p = extra.presentation;
                    const parent = text(p.customerName, p.name);
                    return {
                      name:
                        p.variantName === null
                          ? parent
                          : `${parent} (${text(p.variantCustomerName, p.variantName)})`,
                      price: extra.price,
                      portion: extra.portion,
                      unit: unit(extra.unit),
                      ...declarations(extra.addAllergens, extra.suitableFor),
                    };
                  }),
                },
          ),
        },
      ];
    });
  return {
    name: text(document.menuNames, document.menuName),
    language,
    languages: [...config.languages],
    members: walk(document.root.members),
  };
}
