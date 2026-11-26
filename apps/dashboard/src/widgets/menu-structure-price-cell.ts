import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { formatDecimalInput } from "@waitron/ui";
import { stringToCents, type CombinedOffer, type Decimal, type Setting } from "@waitron/shared";
import "@waitron/ui/src/components/wt-price-input.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { MenuStructureDraft } from "./menu-structure-draft.js";
import { structurePriceKey } from "./menu-structure-draft.js";
import { withoutOwn } from "./menu-price-inheritance.js";
import { priceText } from "./form-fields.js";
import { placeName } from "./price-source.js";
import type { Product } from "../api/client.js";

export interface StructurePricing {
  draft: MenuStructureDraft;
  offers: ReadonlyMap<string, CombinedOffer>;
  errors: ReadonlyMap<string, string>;
}

export function priceSetting(
  offer: CombinedOffer,
  variantId?: string,
): Setting<Decimal> | undefined {
  return variantId === undefined
    ? offer.price
    : offer.variants.find((variant) => variant.variantId === variantId)?.price;
}

function usualPriceNote(value: string, inherited: Setting<Decimal> | undefined, part: string) {
  return value && inherited?.state === "decided"
    ? html`<span part=${`note ${part}`}
        >${fill("menus.usual_price", { price: priceText(inherited.value) })}</span
      >`
    : nothing;
}

export function narrowUsualPriceNote(
  pricing: StructurePricing,
  productId: string,
  variantId?: string,
) {
  const offer = pricing.offers.get(productId);
  if (!offer || (variantId === undefined && offer.variants.length)) return nothing;
  const setting = priceSetting(offer, variantId);
  return usualPriceNote(
    pricing.draft.price(productId, variantId),
    setting && withoutOwn(setting),
    "narrow-usual-price",
  );
}

function clashCandidates(setting: Extract<Setting<Decimal>, { state: "clash" }>): string {
  return setting.candidates
    .map((candidate) => {
      const place = placeName(candidate.place, t);
      return "value" in candidate
        ? fill("menu_prices.source_candidate", { price: priceText(candidate.value), place })
        : fill("menu_prices.candidate_undecided", { place });
    })
    .join(", ");
}

function structurePriceRange(offer: CombinedOffer) {
  const prices = offer.variants.flatMap(({ price }) =>
    price.state === "decided" ? [price.value] : [],
  );
  if (prices.length !== offer.variants.length) return t("menu_prices.clash");
  prices.sort((a, b) => Math.sign(stringToCents(a) - stringToCents(b)));
  const low = prices[0]!;
  const high = prices.at(-1)!;
  return stringToCents(low) === stringToCents(high)
    ? priceText(low)
    : fill("menu_prices.range", { low: priceText(low), high: priceText(high) });
}

export function structurePriceCell(
  pricing: StructurePricing,
  productId: string,
  variantId: string | undefined,
  name: string,
  busy: boolean,
  change: (value: string) => void,
  variants: Product["variants"] | undefined,
) {
  const offer = pricing.offers.get(productId);
  if (offer === undefined) return nothing;
  if (variantId === undefined && offer.variants.length > 0) {
    const clashes = offer.variants.flatMap(({ variantId, price }) =>
      price.state === "clash"
        ? [
            fill("menu_prices.variant_clash", {
              variant: variants?.find(({ id }) => id === variantId)?.name ?? variantId,
              candidates: clashCandidates(price),
            }),
          ]
        : [],
    );
    return html`<span part="structure-price">
      ${structurePriceRange(offer)}
      ${clashes.length ? html`<span part="structure-clash">${clashes.join(" ")}</span>` : nothing}
    </span>`;
  }
  const setting = priceSetting(offer, variantId);
  if (!setting) return nothing;
  const inherited = withoutOwn(setting);
  const value = pricing.draft.price(productId, variantId);
  const locale = currentLocale();
  const inheritedValue = inherited.state === "decided" ? inherited.value : null;
  const inheritedText = inheritedValue === null ? "" : priceText(inheritedValue);
  const clash =
    setting.state === "clash"
      ? fill("menu_prices.clash_prices", {
          candidates: clashCandidates(setting),
        })
      : "";
  const key = structurePriceKey(productId, variantId);
  return html`<span part="structure-price">
    <wt-price-input
      part="structure-price-field"
      name="menu-price"
      data-price-key=${key}
      label=${fill("menu_prices.override_label", { name })}
      hide-label
      fixed-unit
      ?readonly=${busy}
      ?overriding=${value !== ""}
      locale=${locale}
      .value=${live(value)}
      .error=${pricing.errors.get(key) ?? ""}
      placeholder=${inheritedValue === null ? t("menu_prices.clash_placeholder") : formatDecimalInput(inheritedValue, locale)}
      hint=${clash || (inheritedValue === null ? t("menu_prices.override_help_clash") : fill("menu_prices.override_help", { price: inheritedText }))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change(event.detail.value);
      }}
    ></wt-price-input>
    ${usualPriceNote(value, inherited, "usual-price")}
    ${clash ? html`<span part="structure-clash" aria-hidden="true">${clash}</span>` : nothing}
  </span>`;
}
