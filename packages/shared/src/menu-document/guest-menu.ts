import { contentLanguageCode, type ContentLanguages } from "../content-languages.js";
import { ALLERGEN_CODES, type ProductAllergens } from "./allergens.js";
import { DIETARY_LABELS, type DietaryLabel } from "./dietary-declarations.js";
import { menuPriceRange, resolveMenuText } from "./customer-menu-presentation.js";
import type { DocumentMember, MenuDocument } from "./menu-document-types.js";

export interface GuestMenuPaperAppearance {
  preset: "bistro" | "lunch-wine";
  font: "serif" | "sans";
  spacing: "compact" | "comfortable";
  ink: string;
  accent: string;
  key: "end" | "inline";
}

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
  | (GuestDeclarations & {
      kind: "product";
      name: string;
      description: string;
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

export function publicGuestMenu(
  document: MenuDocument,
  config: ContentLanguages,
  requested: string,
): PublicGuestMenu {
  let language: string;
  try {
    language = contentLanguageCode(requested);
  } catch {
    language = config.defaultLanguage;
  }
  if (!config.languages.includes(language)) language = config.defaultLanguage;
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
  const unit = (value: { abbreviation: Record<string, string>; staffAbbreviation: string }) =>
    text(value.abbreviation, value.staffAbbreviation);
  const walk = (members: DocumentMember[]): GuestMember[] =>
    members.flatMap((member): GuestMember[] => {
      if (member.kind === "section")
        return member.direct
          ? walk(member.members)
          : [
              {
                kind: "section",
                name: text(member.names, member.internalName),
                members: walk(member.members),
              },
            ];
      const offer = document.offers[member.menuItemId]!;
      return [
        {
          kind: "product",
          name: text(offer.customerName, offer.name),
          description: text(offer.description, null),
          price: menuPriceRange(offer),
          unit: unit(offer.unit),
          ...declarations(offer.allergens, offer.dietaryDeclarations),
          variants: offer.variants.map((v) => ({
            name: text(v.customerName, v.name),
            price: v.unitPrice,
            unit: unit(v.unit),
            ...declarations(v.allergens, v.dietaryDeclarations),
          })),
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
    name: document.menuName,
    language,
    languages: [...config.languages],
    members: walk(document.root.members),
  };
}
