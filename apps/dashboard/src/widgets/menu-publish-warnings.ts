import { css, html, nothing, type TemplateResult } from "lit";
import type { MenuPreview } from "../api/client.js";
import { staffPresentationName } from "@waitron/shared";
import { localizedName } from "../i18n/localized.js";
import { fill, t } from "../i18n/t.js";
import { conjunctionList } from "../i18n/list.js";
import { publicationBlockerCount } from "./menu-publication-actions.js";
import { leftToBrowser } from "../navigation.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

export const publishWarningStyles = css`
  .menu-publish-warnings,
  .menu-publish-warnings ul {
    display: grid;
    gap: var(--wt-space-2);
    min-width: 0;
    margin: 0;
    padding-inline-start: var(--wt-space-5);
    overflow-wrap: anywhere;
  }
  .menu-publish-warnings p {
    margin: 0;
  }
  .menu-publish-warnings a {
    color: var(--wt-color-primary-text);
  }
`;

export function openProduct(event: MouseEvent, id: string): void {
  if (leftToBrowser(event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget!.dispatchEvent(
    new CustomEvent("wt-edit-product", {
      detail: { productId: id },
      bubbles: true,
      composed: true,
    }),
  );
}

export function renderMenuWarnings(
  warnings: MenuPreview["warnings"],
  menuName: string,
  compact = false,
): TemplateResult {
  const missing = warnings.filter((warning) => warning.kind === "shortcut_missing").length;
  return html`<ul class="menu-publish-warnings" data-test="warnings">
    ${missing === 0 ? [] : html`<li>${fill(missing === 1 ? "menu_preview.shortcut_missing_one" : "menu_preview.shortcut_missing", { count: String(missing), menu: menuName })}</li>`}
    ${warnings.map((warning) => {
      if (warning.kind === "extra_portion_precision")
        return html`<li>
          ${fill("menu_preview.extra_portion_precision", { list: warning.listName, product: warning.name, amount: `${warning.portion} ${localizedName(warning.abbreviation)}`.trim(), precision: String(warning.precision) })}
        </li>`;
      if (warning.kind === "allergens_unreviewed") {
        const products = warning.products.map(
          (product) =>
            html`<li>
              <a
                href=${`/products/product/${encodeURIComponent(product.id)}`}
                @click=${(event: MouseEvent) => openProduct(event, product.id)}
                >${staffPresentationName({ name: product.parentName ?? product.name, variantName: product.parentName === null ? null : product.name })}</a
              >
            </li>`,
        );
        return compact
          ? products
          : html`<li>
              <p>${t("menu_preview.allergens_unreviewed")}</p>
              <ul>
                ${products}
              </ul>
            </li>`;
      }
      return [];
    })}
  </ul>`;
}

export function renderFoldedMenuWarnings(warnings: MenuPreview["warnings"], menuName: string) {
  const groups = [
    {
      kind: "allergens_unreviewed",
      one: "menu_preview.allergens_count_one",
      many: "menu_preview.allergens_count",
    },
    {
      kind: "shortcut_missing",
      one: "menu_preview.shortcuts_count_one",
      many: "menu_preview.shortcuts_count",
    },
    {
      kind: "extra_portion_precision",
      one: "menu_preview.portions_count_one",
      many: "menu_preview.portions_count",
    },
  ] as const;
  return groups.map(({ kind, one, many }) => {
    const entries = warnings.filter((warning) => warning.kind === kind);
    const count = entries.reduce(
      (total, entry) => total + (entry.kind === "allergens_unreviewed" ? entry.products.length : 1),
      0,
    );
    return count === 0
      ? nothing
      : html`<wt-disclosure heading=${fill(count === 1 ? one : many, { count: String(count) })}>
          ${renderMenuWarnings(entries, menuName, true)}
        </wt-disclosure>`;
  });
}

export function renderDeclarationsAdvisory(changes: MenuPreview["changes"]) {
  const names = new Set<string>();
  for (const change of changes) {
    if (change.kind !== "product_changed" && change.kind !== "set_menu_changed") continue;
    if (change.fields.some((field) => field === "allergens" || field === "diet"))
      names.add(change.kind === "product_changed" ? change.name : change.setMenu.name);
  }
  return names.size === 0
    ? nothing
    : html`<p data-test="declarations-advisory">
        ${fill("menu_preview.declarations_advisory", { names: conjunctionList([...names]) })}
      </p>`;
}

export interface PublishWarningConfirmation {
  preview: MenuPreview;
  menuName: string;
  actionLabel: string;
  busy: boolean;
  confirm: () => void;
  cancel: () => void;
}

export function renderPublishWarningConfirmation(
  options: PublishWarningConfirmation,
): TemplateResult {
  return html`<wt-dialog
    .open=${true}
    heading=${options.actionLabel}
    data-test="publish-confirmation"
    .dismissible=${!options.busy}
    @wt-close=${(event: Event) => {
      event.stopPropagation();
      options.cancel();
    }}
  >
    ${renderMenuWarnings(options.preview.warnings, options.menuName)}
    <wt-form-actions slot="footer">
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="publish-cancel"
        ?disabled=${options.busy}
        @click=${(event: Event) => {
          event.stopPropagation();
          options.cancel();
        }}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        variant="primary"
        data-test="publish-confirm"
        .loading=${options.busy}
        ?disabled=${options.busy || publicationBlockerCount(options.preview) > 0}
        @click=${(event: Event) => {
          event.stopPropagation();
          options.confirm();
        }}
        >${options.actionLabel}</wt-button
      >
    </wt-form-actions>
  </wt-dialog>`;
}
