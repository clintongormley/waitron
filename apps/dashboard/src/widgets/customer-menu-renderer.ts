import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { styleMap } from "lit/directives/style-map.js";
import { readableTextColor } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import { tileFill } from "@waitron/catalogue/src/device-home.js";
import {
  resolveMenuText,
  menuPriceRange,
  type MenuView,
  type MenuText,
} from "@waitron/catalogue/src/customer-menu-presentation.js";
import { menuTargetKey } from "@waitron/catalogue/src/menu-navigation.js";
import type {
  DocumentMember,
  FrozenOffer,
  FrozenOfferVariant,
  FrozenExtraItem,
  MenuDocument,
  MenuField,
  MenuTarget,
} from "@waitron/catalogue/src/menu-document-types.js";
import "@waitron/ui/src/components/wt-number-stepper.js";

type ProductTarget = Extract<MenuTarget, { kind: "product" }>;
type SectionTarget = Extract<MenuTarget, { kind: "section" }>;
type Named = {
  name: string;
  customerName: Record<string, string> | null;
  kitchenName?: string | null;
};
export interface CustomerMenuRenderInput {
  document: MenuDocument;
  view: MenuView;
  languages: ContentLanguages;
  expanded: ReadonlySet<string>;
  detail: MenuTarget | null;
  selectedVariantId: string | null;
  picks: ReadonlyMap<string, number>;
  options: ReadonlyMap<string, string>;
  highlighted: readonly MenuTarget[];
  label: (key: string, values?: Readonly<Record<string, string>>) => string;
  mediaUrl: (filename: string) => string;
  onExpand: (target: MenuTarget) => void;
  onDetail: (target: MenuTarget | null) => void;
  onVariant: (id: string | null) => void;
  onPick: (listId: string, productId: string, quantity: number) => void;
  onOption: (listId: string, labelId: string) => void;
}

export const customerMenuStyles: CSSResult = css`
  :host {
    display: block;
    min-width: 0;
  }
  .menu,
  .members,
  .detail,
  .modifier,
  .facts {
    display: grid;
    gap: var(--wt-space-3);
    min-width: 0;
  }
  .members {
    padding-inline-start: var(--wt-space-3);
    border-inline-start: 1px solid var(--wt-color-border);
  }
  .section,
  .product,
  .detail,
  .modifier {
    min-width: 0;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    padding: var(--wt-space-3);
    background: var(--wt-color-surface);
  }
  h2,
  h3,
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  h2,
  h3 {
    font-size: var(--wt-font-size-md);
    font-weight: var(--wt-font-weight-bold);
  }
  button {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    color: var(--wt-color-text);
    background: var(--wt-color-surface);
    font: inherit;
    text-align: start;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  button:hover {
    background: var(--wt-color-surface-lifted);
  }
  button[aria-pressed="true"] {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-surface-lifted);
  }
  button:focus-visible,
  [data-change-target]:focus {
    outline: 2px solid var(--wt-color-primary);
    outline-offset: var(--wt-space-1);
  }
  .heading,
  .choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    min-width: 0;
  }
  .thumb {
    width: calc(var(--wt-tap-min) * 2);
    height: calc(var(--wt-tap-min) * 2);
    object-fit: cover;
    border-radius: var(--wt-radius-sm);
  }
  .image {
    display: inline-grid;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    align-content: center;
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-bg);
  }
  .image[data-painted] {
    background: var(--menu-image-fill);
    color: var(--menu-image-ink);
  }
  .image [hidden] {
    display: none;
  }
  .note,
  .empty {
    font-size: var(--wt-font-size-sm);
    color: var(--wt-color-text-muted);
    overflow-wrap: anywhere;
  }
  [data-change-target] {
    min-width: 0;
    overflow-wrap: anywhere;
    scroll-margin: var(--wt-space-4);
  }
  [data-highlighted] {
    outline: 2px solid var(--wt-color-primary);
    outline-offset: var(--wt-space-1);
  }
  .change-marker {
    font-weight: var(--wt-font-weight-bold);
    color: var(--wt-color-primary);
  }
`;

function text(
  input: CustomerMenuRenderInput,
  map: Readonly<Record<string, string>> | null,
  staff: string | null,
): TemplateResult {
  const value: MenuText = resolveMenuText(map, staff, input.view, input.languages);
  return html`<span lang=${value.language ?? nothing}
      >${value.text || input.label("missing_value")}</span
    >${value.missingRequested ? html`<span class="note"> ${input.label("missing_translation", { language: input.view.kind === "customer" ? input.view.language : input.languages.defaultLanguage })}${value.origin === "staff" ? html` · ${input.label("staff_fallback")}` : nothing}</span>` : nothing}`;
}
function named(input: CustomerMenuRenderInput, value: Named) {
  return text(input, value.customerName, value.name);
}
function fieldTarget<T extends ProductTarget | SectionTarget>(base: T, field: MenuField): T {
  return { ...base, field };
}
function value(input: CustomerMenuRenderInput, target: MenuTarget, body: unknown): TemplateResult {
  const key = menuTargetKey(target);
  const highlighted = input.highlighted.some((t) => menuTargetKey(t) === key);
  return html`<div
    tabindex="-1"
    data-change-target=${key}
    data-field=${target.kind === "product" || target.kind === "section" ? target.field.kind : target.kind}
    ?data-highlighted=${highlighted}
  >
    ${highlighted ? html`<span class="change-marker">${input.label("changed")} · </span>` : nothing}${body}
  </div>`;
}
function image(
  input: CustomerMenuRenderInput,
  filename: string | null,
  color: string | null = null,
): TemplateResult {
  const fill = tileFill("thumbnails", filename, color);
  const paint =
    fill.kind !== "color"
      ? {}
      : { "--menu-image-fill": fill.color, "--menu-image-ink": readableTextColor(fill.color) };
  return html`<span class="image" ?data-painted=${fill.kind === "color"} style=${styleMap(paint)}
    >${
      filename === null
        ? html`<span class="note">${input.label("image_missing")}</span>`
        : keyed(
            filename,
            html`<img
                class="thumb"
                src=${input.mediaUrl(filename)}
                alt=""
                @error=${(event: Event) => {
                  const img = event.currentTarget as HTMLImageElement;
                  img.hidden = true;
                  img.nextElementSibling?.removeAttribute("hidden");
                }}
              /><span class="note" hidden>${input.label("image_missing")}</span>`,
          )
    }</span
  >`;
}
function price(input: CustomerMenuRenderInput, base: ProductTarget, amount: string) {
  return value(
    input,
    fieldTarget(base, { kind: "price" }),
    html`${input.label("price")}: ${input.label("amount", { amount })}`,
  );
}
function unit(
  input: CustomerMenuRenderInput,
  base: ProductTarget,
  item: FrozenOffer | FrozenOfferVariant | FrozenExtraItem,
) {
  return value(
    input,
    fieldTarget(base, { kind: "unit" }),
    html`${input.label("unit")}: ${text(input, item.unit.abbreviation, null)}`,
  );
}
function allergens(
  input: CustomerMenuRenderInput,
  declarations: FrozenOffer["allergens"],
): TemplateResult {
  return html`${declarations === null ? input.label("allergens_unknown") : Object.keys(declarations).length === 0 ? input.label("no_allergens") : Object.entries(declarations).map(([code, declaration]) => html`<p>${input.label(declaration.presence)} ${input.label(code)}${declaration.source ? ` (${declaration.source})` : nothing}</p>`)}`;
}
function diet(
  input: CustomerMenuRenderInput,
  item: FrozenOffer | FrozenOfferVariant,
): TemplateResult {
  const pending = item.diet === null || item.dietDerivation?.pending === true;
  return html`${pending ? html`<p>${input.label("diet_unknown")}</p>` : nothing}${item.diet === null ? nothing : Object.entries(item.diet).map(([name, setting]) => html`<p>${input.label(name)}: ${Array.isArray(setting) ? setting.map((s) => input.label(s)).join(", ") : input.label(String(setting))}</p>`)}${item.dietaryDeclarations.map((d) => html`<p>${input.label(d)}</p>`)}`;
}
function modifiers(
  input: CustomerMenuRenderInput,
  base: ProductTarget,
  offer: FrozenOffer,
): TemplateResult {
  return html`${offer.offeredModifiers.map((list) => {
    const listBase: ProductTarget = { ...base, listId: list.id };
    const membersTarget = fieldTarget(listBase, { kind: "members" });
    const membersHighlighted = input.highlighted.some(
      (t) => menuTargetKey(t) === menuTargetKey(membersTarget),
    );
    const membersMarker = membersHighlighted
      ? html`<span class="change-marker">${input.label("changed")}</span>`
      : nothing;
    const heading = value(
      input,
      fieldTarget(listBase, { kind: "summary" }),
      html`<h3>${named(input, list)}</h3>`,
    );
    if (list.kind === "options")
      return html`<section
        class="modifier"
        data-modifier=${list.id}
        tabindex="-1"
        data-field="members"
        ?data-highlighted=${membersHighlighted}
        data-change-target=${menuTargetKey(fieldTarget(listBase, { kind: "members" }))}
      >
        ${membersMarker}${heading}${value(
          input,
          fieldTarget(listBase, { kind: "default" }),
          html`${input.label("default")}:
          ${
            list.labels.find((l) => l.id === list.defaultLabelId)
              ? named(
                  input,
                  list.labels.find((l) => l.id === list.defaultLabelId)!,
                )
              : input.label("missing_value")
          }`,
        )}
        <div class="choices">
          ${list.labels.map((option) => {
            const optionBase = { ...listBase, optionLabelId: option.id };
            return value(
              input,
              fieldTarget(optionBase, { kind: "summary" }),
              html`<button
                  type="button"
                  data-option=${option.id}
                  aria-pressed=${String(input.options.get(list.id) === option.id)}
                  @click=${() => input.onOption(list.id, option.id)}
                >
                  ${named(input, option)}</button
                >${inspection(input, optionBase, option)}`,
            );
          })}
        </div>
        ${inspection(input, listBase, list)}
      </section>`;
    const total = list.items.reduce(
      (sum, item) => sum + (input.picks.get(JSON.stringify([list.id, item.productId])) ?? 0),
      0,
    );
    const conflict =
      (list.maxPicks !== null && total > list.maxPicks) ||
      list.items.some(
        (item) =>
          item.maxQuantity !== null &&
          (input.picks.get(JSON.stringify([list.id, item.productId])) ?? 0) > item.maxQuantity,
      );
    return html`<section
      class="modifier"
      data-modifier=${list.id}
      tabindex="-1"
      data-field="members"
      ?data-highlighted=${membersHighlighted}
      data-change-target=${menuTargetKey(fieldTarget(listBase, { kind: "members" }))}
    >
      ${membersMarker}${heading}${value(
        input,
        fieldTarget(listBase, { kind: "limits" }),
        html`<p>
            ${input.label("min_picks", { min: String(list.minPicks) })} ·
            ${list.maxPicks === null ? input.label("unlimited") : input.label("max_picks", { max: String(list.maxPicks) })}
          </p>
          ${total < list.minPicks ? html`<p class="note">${input.label("min_picks", { min: String(list.minPicks - total) })}</p>` : nothing}${conflict ? html`<p class="note">${input.label("conflict")}</p>` : nothing}`,
      )}${list.items.map((item) => {
        const extraBase = { ...listBase, extraProductId: item.productId };
        const count = input.picks.get(JSON.stringify([list.id, item.productId])) ?? 0;
        const listRemaining =
          list.maxPicks === null ? null : Math.max(0, list.maxPicks - total + count);
        const max =
          item.maxQuantity === null
            ? listRemaining
            : listRemaining === null
              ? item.maxQuantity
              : Math.min(item.maxQuantity, listRemaining);
        return html`<div class="facts">
          ${value(input, fieldTarget(extraBase, { kind: "summary" }), html`<h3>${named(input, item)}</h3>`)}${value(input, fieldTarget(extraBase, { kind: "image" }), image(input, item.image))}${price(input, extraBase, item.price)}${value(input, fieldTarget(extraBase, { kind: "portion" }), html`${input.label("portion")}: ${item.portion} ${text(input, item.unit.abbreviation, null)}`)}${unit(input, extraBase, item)}${value(input, fieldTarget(extraBase, { kind: "maxQuantity" }), html`${input.label("max_quantity")}: ${item.maxQuantity === null ? input.label("unlimited") : String(item.maxQuantity)}`)}${item.preselected ? html`<p class="note">${input.label("preselected")}</p>` : nothing}${value(input, fieldTarget(extraBase, { kind: "default" }), html`${input.label("preselected")}: ${input.label(String(item.preselected))}`)}${value(input, fieldTarget(extraBase, { kind: "allergens" }), allergens(input, item.addAllergens))}${value(input, fieldTarget(extraBase, { kind: "diet" }), html`${item.suitableFor.map((d) => input.label(d)).join(", ") || input.label("diet_unknown")}`)}<wt-number-stepper
            name=${JSON.stringify(["menu-pick", list.id, item.productId])}
            data-list=${list.id}
            data-product=${item.productId}
            .label=${resolveMenuText(item.customerName, item.name, input.view, input.languages).text}
            .value=${String(count)}
            .min=${0}
            .max=${max}
            .decreaseLabel=${(name: string) => input.label("decrease", { name })}
            .increaseLabel=${(name: string) => input.label("increase", { name })}
            @wt-change=${(event: CustomEvent<{ value: string }>) => input.onPick(list.id, item.productId, Number(event.detail.value))}
          ></wt-number-stepper
          >${inspection(input, extraBase, item)}
        </div>`;
      })}${inspection(input, listBase, list)}
    </section>`;
  })}`;
}
function sameSubject(a: ProductTarget | SectionTarget, b: ProductTarget | SectionTarget): boolean {
  return (
    menuTargetKey({ ...a, field: { kind: "summary" } }) ===
    menuTargetKey({ ...b, field: { kind: "summary" } })
  );
}
function inspection(
  input: CustomerMenuRenderInput,
  base: ProductTarget | SectionTarget,
  item: object,
): TemplateResult {
  const requested = [input.detail, ...input.highlighted].filter(
    (t): t is ProductTarget | SectionTarget =>
      t !== null && (t.kind === "product" || t.kind === "section") && sameSubject(t, base),
  );
  const fields = new Map(requested.map((t) => [menuTargetKey(t), t]));
  return html`${[...fields.values()].flatMap((t) => {
    const field = t.field;
    if (field.kind === "summary") return [];
    const row = item as Record<string, unknown>;
    if (field.kind === "name") {
      const stored =
        field.audience === "staff"
          ? (row.name ?? row.internalName)
          : field.audience === "kitchen"
            ? row.kitchenName
            : (row.customerName ?? row.names) &&
              (row.customerName ?? (row.names as Record<string, string>));
      const content =
        field.audience === "customer"
          ? (stored as Record<string, string> | null)?.[
              field.language ?? input.languages.defaultLanguage
            ]
          : stored;
      return [
        value(
          input,
          t,
          html`<span class="note"
              >${input.label(field.audience === "customer" ? "stored_translation" : "staff_inspection")}</span
            >
            <span lang=${field.language ?? nothing}
              >${typeof content === "string" && content.trim() ? content : input.label("missing_value")}</span
            >`,
        ),
      ];
    }
    if (field.kind === "description")
      return [
        value(
          input,
          t,
          html`${input.label("description")}:
            <span lang=${field.language}
              >${(row.description as Record<string, string> | null)?.[field.language]?.trim() || input.label("missing_value")}</span
            >`,
        ),
      ];
    if (["override", "vat", "color"].includes(field.kind)) {
      const content =
        field.kind === "override"
          ? (row.menuPrice ?? row.grossPrice)
          : field.kind === "vat"
            ? row.vatClass
            : row.color;
      return [
        value(
          input,
          t,
          html`<span class="note">${input.label("staff_inspection")}</span>
            ${input.label(field.kind)}:
            ${typeof content === "string" ? content : input.label("missing_value")}`,
        ),
      ];
    }
    return [];
  })}`;
}
function detail(input: CustomerMenuRenderInput): TemplateResult | typeof nothing {
  if (input.detail?.kind !== "product") return nothing;
  const base: ProductTarget = {
    ...input.detail,
    variantId: undefined,
    listId: undefined,
    extraProductId: undefined,
    optionLabelId: undefined,
    field: { kind: "summary" },
  };
  const offer = input.document.offers[base.menuItemId];
  if (offer === undefined) return html`<p class="missing">${input.label("missing_offer")}</p>`;
  const selected = offer.variants.find((v) => v.id === input.selectedVariantId);
  const item = selected ?? offer;
  const itemBase = selected ? { ...base, variantId: selected.id } : base;
  const description = resolveMenuText(offer.description, null, input.view, input.languages);
  return html`<section
    class="detail"
    data-detail
    aria-label=${resolveMenuText(offer.customerName, offer.name, input.view, input.languages).text}
  >
    <button type="button" data-back @click=${() => input.onDetail(null)}>
      ${input.label("back")}</button
    >${value(input, base, html`<h2>${named(input, offer)}</h2>`)}${value(input, fieldTarget(itemBase, { kind: "image" }), image(input, item.image, "color" in item ? (item.color ?? null) : null))}${selected ? value(input, fieldTarget(itemBase, { kind: "summary" }), html`<h3>${named(input, selected)}</h3>`) : nothing}${price(input, itemBase, item.unitPrice)}${unit(input, itemBase, item)}${description.text ? html`<p>${text(input, offer.description, null)}</p>` : nothing}${inspection(input, base, offer)}${selected ? inspection(input, itemBase, selected) : nothing}${value(input, fieldTarget(itemBase, { kind: "allergens" }), allergens(input, item.allergens))}${value(input, fieldTarget(itemBase, { kind: "diet" }), diet(input, item))}${value(input, fieldTarget(base, { kind: "ordering" }), html`<span class="note">${input.label("ordering")}: ${input.label(offer.ordering ?? "public")}</span>`)}${value(input, fieldTarget(base, { kind: "variants" }), html`<div class="choices">${offer.variants.map((variant) => html`<button type="button" data-variant=${variant.id} aria-pressed=${String(variant.id === input.selectedVariantId)} @click=${() => input.onVariant(variant.id)}>${named(input, variant)} · ${input.label("amount", { amount: variant.unitPrice })}</button>`)}</div>`)}${value(input, fieldTarget(base, { kind: "extras" }), html`${input.label("extras")}`)}${value(input, fieldTarget(base, { kind: "options" }), html`${input.label("options")}`)}${modifiers(input, base, offer)}
  </section>`;
}
function members(
  input: CustomerMenuRenderInput,
  list: readonly DocumentMember[],
  path: string[],
): TemplateResult {
  return html`${
    list.length === 0
      ? html`<p class="empty">${input.label("empty")}</p>`
      : list.map((member) => {
          if (member.kind === "section") {
            if (path.includes(member.sectionId)) return nothing;
            const sectionIds = [...path, member.sectionId];
            const base: SectionTarget = { kind: "section", sectionIds, field: { kind: "summary" } };
            const expanded = input.expanded.has(menuTargetKey(base));
            return html`<section class="section" data-section=${JSON.stringify(sectionIds)}>
              ${value(input, base, html`<div class="heading">${value(input, fieldTarget(base, { kind: "image" }), image(input, member.image, member.color))}<button type="button" aria-expanded=${String(expanded)} @click=${() => input.onExpand(base)}>${text(input, member.names, member.internalName)}</button></div>`)}${inspection(input, base, member)}${expanded ? value(input, { kind: "list", sectionIds }, html`<div class="members">${members(input, member.members, sectionIds)}</div>`) : nothing}
            </section>`;
          }
          const offer = input.document.offers[member.menuItemId];
          if (offer === undefined)
            return html`<p class="missing">${input.label("missing_offer")}</p>`;
          const base: ProductTarget = {
            kind: "product",
            sectionIds: path,
            menuItemId: member.menuItemId,
            productId: member.productId,
            field: { kind: "summary" },
          };
          const range = menuPriceRange(offer);
          return html`<article class="product">
            <button
              type="button"
              data-product-open=${menuTargetKey(base)}
              @click=${() => input.onDetail(base)}
            >
              <span class="heading"
                >${image(input, offer.image, offer.color ?? null)}${named(input, offer)}</span
              ><span
                >${range.min === range.max ? input.label("amount", { amount: range.min }) : `${input.label("amount", { amount: range.min })} – ${input.label("amount", { amount: range.max })}`}
                / ${text(input, offer.unit.abbreviation, null)}</span
              >
            </button>
          </article>`;
        })
  }`;
}
export function renderCustomerMenu(input: CustomerMenuRenderInput): TemplateResult {
  return html`<div class="menu">
    ${value(
      input,
      { kind: "title", menuId: input.document.menuId },
      html`<h2>${input.document.menuName}</h2>
        ${input.view.kind === "customer" ? html`<p class="note">${input.label("internal_title")}</p>` : nothing}`,
    )}${value(input, { kind: "list", sectionIds: [] }, html`<div class="members">${members(input, input.document.root.members, [])}</div>`)}${detail(input)}
  </div>`;
}
