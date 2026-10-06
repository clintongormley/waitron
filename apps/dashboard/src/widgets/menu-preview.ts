import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { formatMoney } from "@waitron/shared";
import "./menu-structure-tree.js";
import type {
  DocumentMember,
  MenuChange,
  MenuDocument,
  MenuPreview,
  MenuStructureNode,
  MenuStatus,
  ProductChangeField,
  SectionChangeField,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { codeMessage } from "../i18n/codes.js";
import { localizedName } from "../i18n/localized.js";
import { PATH_SEPARATOR } from "./category-form.js";
import { describeSetting } from "./price-source.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

/** How the host's last publish ended, for the panel to say. */
export type PublishResult =
  | { kind: "published"; number: number; warnings?: MenuPreview["warnings"] }
  | { kind: "stale" }
  | { kind: "failed"; reason: string };

const PRODUCT_FIELDS: Record<ProductChangeField, StringKey> = {
  names: "menu_preview.field_names",
  description: "menu_preview.field_description",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
  unit: "menu_preview.field_unit",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
  vat: "menu_preview.field_vat",
  ordering: "menu_preview.field_ordering",
  variants: "menu_preview.field_variants",
  extras: "menu_preview.field_extras",
  options: "menu_preview.field_options",
};

const SECTION_FIELDS: Record<SectionChangeField, StringKey> = {
  names: "menu_preview.field_name",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
};

const SOURCES: Record<MenuChange["source"], StringKey> = {
  this_menu: "menu_preview.source_this_menu",
  shared_product: "menu_preview.source_shared_product",
  included_menu: "menu_preview.source_included_menu",
};

/** Fills `{key}` placeholders; each value is inserted once, never re-read as a placeholder. */
function fill(key: StringKey, values: Record<string, string>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** A menu's publication state in words, for the menus list and the editor: what it is, and the live
 * version and its publication time beside it. */
export function statusWords(status: MenuStatus): {
  label: string;
  live: { version: string; time: string } | null;
} {
  if (status.state === "unpublished") return { label: t("menu_status.unpublished"), live: null };
  const number = { number: String(status.version) };
  const time = formatIsoMinute(status.publishedAt);
  return status.state === "current"
    ? {
        label: t("menu_status.current"),
        live: { version: fill("menu_status.current_version", number), time },
      }
    : {
        label: t("menu_status.changed"),
        live: { version: fill("menu_status.changed_version", number), time },
      };
}

const listFormats = new Map<string, Intl.ListFormat>();

function list(items: readonly string[]): string {
  const locale = currentLocale();
  let format = listFormats.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: "conjunction" });
    listFormats.set(locale, format);
  }
  return format.format(items);
}

/**
 * A published-menu document in the structure tree's shape, with the names the tree shows: a product
 * by its offer's staff name, a section by its internal name. A list holds a product or a section at
 * most once (`section_members_product_uq`, `section_members_child_uq`), so what a member names keys
 * it within its list.
 */
export function documentTree(document: MenuDocument): {
  nodes: MenuStructureNode[];
  products: { id: string; name: string }[];
  sections: { id: string; internalName: string }[];
} {
  const products = new Map<string, string>();
  const sections = new Map<string, string>();
  const nodes = (members: DocumentMember[]): MenuStructureNode[] =>
    members.map((member) => {
      if (member.kind === "product") {
        const offer = document.offers[member.menuItemId];
        if (offer !== undefined) products.set(member.productId, offer.name);
        return {
          memberId: `p:${member.productId}`,
          ref: { kind: "product", productId: member.productId },
        };
      }
      sections.set(member.sectionId, member.internalName);
      return {
        memberId: `s:${member.sectionId}`,
        ref: { kind: "section", sectionId: member.sectionId },
        children: nodes(member.members),
      };
    });
  const root = nodes(document.root.members);
  return {
    nodes: root,
    products: [...products].map(([id, name]) => ({ id, name })),
    sections: [...sections].map(([id, internalName]) => ({ id, internalName })),
  };
}

/** Says a publish did not happen, what is still live, and that the working edits are kept. */
export function publishFailure(menu: string, status: MenuStatus | null, reason: string): string {
  return status !== null && status.state !== "unpublished"
    ? fill("menu_preview.failed_kept", { menu, number: String(status.version), reason })
    : fill("menu_preview.failed", { menu, reason });
}

/**
 * What publishing one menu would change from its live version, each change in words with where it
 * came from, the warnings that do not stop it, the button that publishes the menu, and the whole menu
 * read-only as the publish would make it live, or as it is live when there is nothing to publish. The
 * host reads the preview and performs the publish: the button asks for it as `wt-menu-publish` with
 * the hash the preview showed, and a failed read offers `wt-preview-retry`.
 */
@customElement("dashboard-menu-preview")
export class MenuPreviewPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-5);
        min-width: 0;
      }
      section {
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      p {
        margin: 0;
      }
      ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      li {
        overflow-wrap: anywhere;
      }
      .source,
      .help,
      .note {
        color: var(--wt-color-text-muted);
      }
      .help {
        font-size: var(--wt-font-size-sm);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .result {
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-inline-start-width: var(--wt-space-1);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }
      .result.ok {
        border-inline-start-color: var(--wt-color-success);
      }
      .result.alert {
        border-inline-start-color: var(--wt-color-danger);
      }
      .warnings li::marker {
        color: var(--wt-color-warning);
      }
      .actions {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property() menuName = "";
  /** Null while the live version is being read. */
  @property({ attribute: false }) status: MenuStatus | null = null;
  /** The live version could not be read. */
  @property({ type: Boolean }) statusFailed = false;
  /** Null while the changes are being worked out, or when that failed. */
  @property({ attribute: false }) preview: MenuPreview | null = null;
  /** The preview could not be read. */
  @property({ type: Boolean }) failed = false;
  @property() failureReason = "";
  @property({ type: Boolean }) publishing = false;
  @property({ attribute: false }) result: PublishResult | null = null;

  @state() private confirmingHash: string | null = null;
  #publishedWarnings: MenuPreview["warnings"] = [];

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("preview") || changed.has("menuName")) this.confirmingHash = null;
  }

  #warningWords(warnings = this.preview?.warnings ?? []): string[] {
    let missing = 0;
    const portions: string[] = [];
    for (const warning of warnings) {
      if (warning.kind === "extra_portion_precision") {
        portions.push(
          fill("menu_preview.extra_portion_precision", {
            list: warning.listName,
            product: warning.name,
            amount: `${warning.portion} ${localizedName(warning.abbreviation)}`.trim(),
            precision: String(warning.precision),
          }),
        );
      } else missing += 1;
    }
    const shortcuts =
      missing === 0
        ? []
        : [
            fill(
              missing === 1 ? "menu_preview.shortcut_missing_one" : "menu_preview.shortcut_missing",
              { count: String(missing), menu: this.menuName },
            ),
          ];
    return [...shortcuts, ...portions];
  }

  /** One place inside a sentence. */
  #place(path: readonly string[]): string {
    return path.length === 0 ? t("menu_preview.top_level") : path.join(PATH_SEPARATOR);
  }

  #places(paths: readonly (readonly string[])[]): string {
    return list(paths.map((path) => this.#place(path)));
  }

  /** A change at one place: its own wording at the top level, else `key` with the place filled. */
  #at(key: StringKey, top: StringKey, path: readonly string[], values: Record<string, string>) {
    return path.length === 0
      ? fill(top, values)
      : fill(key, { ...values, place: this.#place(path) });
  }

  #words(change: MenuChange): string {
    switch (change.kind) {
      case "product_added":
        return this.#at(
          "menu_preview.product_added",
          "menu_preview.product_added_top",
          change.under,
          { name: change.name },
        );
      case "product_removed":
        return this.#at(
          "menu_preview.product_removed",
          "menu_preview.product_removed_top",
          change.under,
          { name: change.name },
        );
      case "product_deleted":
        return fill("menu_preview.product_deleted", { name: change.name });
      case "product_moved":
        return fill("menu_preview.product_moved", {
          name: change.name,
          from: this.#places(change.from),
          to: this.#places(change.to),
        });
      case "price_changed":
        return fill("menu_preview.price_changed", {
          name: change.name,
          from: formatMoney(change.from, currentLocale()),
          to: formatMoney(change.to, currentLocale()),
        });
      case "product_changed":
        return fill("menu_preview.changed_fields", {
          name: change.name,
          fields: change.fields.map((field) => t(PRODUCT_FIELDS[field])).join(", "),
        });
      case "extra_unit_changed": {
        const locale = currentLocale().slice(0, 2);
        const unit = (abbreviations: Record<string, string>) =>
          abbreviations[locale] ?? abbreviations.en ?? Object.values(abbreviations)[0] ?? "";
        return fill("menu_preview.extra_unit_changed", {
          list: change.listName,
          name: change.name,
          from: unit(change.from.abbreviation),
          fromPrecision: String(change.from.precision),
          to: unit(change.to.abbreviation),
          toPrecision: String(change.to.precision),
        });
      }
      case "extra_portion_changed": {
        const locale = currentLocale().slice(0, 2);
        const unit = (abbreviations: Record<string, string>) =>
          abbreviations[locale] ?? abbreviations.en ?? Object.values(abbreviations)[0] ?? "";
        return fill("menu_preview.extra_portion_changed", {
          list: change.listName,
          name: change.name,
          from: `${change.from.portion} ${unit(change.from.abbreviation)}`.trim(),
          to: `${change.to.portion} ${unit(change.to.abbreviation)}`.trim(),
        });
      }
      case "extra_max_quantity_changed":
        return fill("menu_preview.extra_max_quantity_changed", {
          list: change.listName,
          name: change.name,
          from: change.from === null ? t("menu_preview.no_limit") : String(change.from),
          to: change.to === null ? t("menu_preview.no_limit") : String(change.to),
        });
      case "section_added":
        return this.#at(
          "menu_preview.section_added",
          "menu_preview.section_added_top",
          change.under,
          { name: change.name },
        );
      case "section_removed":
        return this.#at(
          "menu_preview.section_removed",
          "menu_preview.section_removed_top",
          change.under,
          { name: change.name },
        );
      case "section_changed":
        return change.fields.length === 1 && change.fields[0] === "names"
          ? fill("menu_preview.section_renamed", { name: change.name })
          : fill("menu_preview.changed_fields", {
              name: change.name,
              fields: change.fields.map((field) => t(SECTION_FIELDS[field])).join(", "),
            });
      case "order_changed":
        return this.#at(
          "menu_preview.order_changed",
          "menu_preview.order_changed_top",
          change.list,
          {},
        );
      case "home_shortcuts_changed":
        return t("menu_preview.home_shortcuts_changed");
      case "home_display_changed":
        return fill("menu_preview.home_display_changed", {
          device: t(change.device === "handheld" ? "home.device_handheld" : "home.device_till"),
        });
      case "menu_renamed":
        return fill("menu_preview.menu_renamed", { from: change.from, to: change.to });
    }
  }

  #source(change: MenuChange): string {
    const source = t(SOURCES[change.source]);
    return change.alsoOn?.length
      ? fill("menu_preview.also_on", { source, menus: list(change.alsoOn) })
      : source;
  }

  /** The live version's number when the working menu is exactly that version, else null. Read
   * from the state that came with the preview, so both describe the same moment. */
  #upToDate(preview: MenuPreview): number | null {
    const { status } = preview;
    return status.state !== "unpublished" && status.hash === preview.hash ? status.version : null;
  }

  #publish(event: Event, confirmed = false): void {
    event.stopPropagation();
    if (this.publishing || this.preview === null || this.preview.clashes.length > 0) return;
    if (this.preview.warnings.length && !confirmed) {
      this.confirmingHash = this.preview.hash;
      return;
    }
    if (confirmed && this.confirmingHash !== this.preview.hash) return;
    this.#publishedWarnings = this.preview.warnings;
    this.confirmingHash = null;
    this.dispatchEvent(
      new CustomEvent("wt-menu-publish", {
        detail: { hash: this.preview.hash },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderLive() {
    const status = this.status;
    const words =
      status === null
        ? t(this.statusFailed ? "menu_preview.live_error" : "menu_preview.live_loading")
        : status.state === "unpublished"
          ? t("menu_preview.never_published")
          : fill("menu_preview.live_version", {
              number: String(status.version),
              time: formatIsoMinute(status.publishedAt),
            });
    return html`<section aria-labelledby="live-heading">
      <h2 id="live-heading">${t("menu_preview.live_heading")}</h2>
      <p
        data-test="live"
        class=${this.statusFailed && status === null ? "error" : ""}
        role=${status !== null ? nothing : this.statusFailed ? "alert" : "status"}
      >
        ${words}
      </p>
    </section>`;
  }

  #renderResult() {
    const result = this.result;
    if (result === null) return nothing;
    if (result.kind === "published")
      return html`<p class="result ok" role="status" data-test="result">
        ${fill("menu_preview.published", {
          menu: this.menuName,
          number: String(result.number),
        })}
        ${this.#warningWords(result.warnings ?? this.#publishedWarnings).map((words) => html`<span>${words}</span>`)}
      </p>`;
    const message =
      result.kind === "stale"
        ? codeMessage("menu.changed_since_preview")
        : publishFailure(this.menuName, this.status, result.reason);
    return html`<p class="result alert" role="alert" data-test="result">${message}</p>`;
  }

  #renderChanges() {
    const preview = this.preview;
    let body;
    if (this.failed)
      body = html`<p class="error" role="alert" data-test="preview-error">
          ${this.failureReason || t("menu_preview.error")}
        </p>
        <div>
          <wt-button
            variant="secondary"
            data-test="preview-retry"
            @click=${(event: Event) => {
              event.stopPropagation();
              this.dispatchEvent(
                new CustomEvent("wt-preview-retry", { detail: {}, bubbles: true, composed: true }),
              );
            }}
            >${t("menus.retry")}</wt-button
          >
        </div>`;
    else if (preview === null)
      body = html`<p class="note" role="status" data-test="preview-loading">
        ${t("menu_preview.loading")}
      </p>`;
    else if (this.#upToDate(preview) !== null)
      body = html`<p data-test="nothing">
        ${fill("menu_preview.nothing", { number: String(this.#upToDate(preview)) })}
      </p>`;
    else if (preview.changes.length === 0)
      body = html`<p class="note" data-test="no-changes">${t("menu_preview.no_changes")}</p>`;
    else
      body = html`<ul data-test="changes">
        ${preview.changes.map(
          (change) =>
            html`<li>
              ${this.#words(change)} <span class="source">— ${this.#source(change)}</span>
            </li>`,
        )}
      </ul>`;
    return html`<section aria-labelledby="changes-heading">
      <h2 id="changes-heading">${t("menu_preview.changes_heading")}</h2>
      ${body}
    </section>`;
  }

  #renderWarnings() {
    const warnings = this.failed ? [] : (this.preview?.warnings ?? []);
    if (warnings.length === 0) return nothing;
    return html`<section class="warnings" aria-labelledby="warnings-heading">
      <h2 id="warnings-heading">${t("menu_preview.warnings_heading")}</h2>
      <p class="help" data-test="warnings-note">${t("menu_preview.warnings_note")}</p>
      <ul data-test="warnings">
        ${this.#warningWords().map((words) => html`<li>${words}</li>`)}
      </ul>
    </section>`;
  }

  /** The whole menu, as the publish would make it live, or as it is live when there is nothing to
   * publish. */
  #renderDocument() {
    const preview = this.preview;
    if (this.failed || preview === null) return nothing;
    const heading = t(
      this.#upToDate(preview) === null
        ? "menu_preview.document_heading"
        : "menu_preview.document_heading_live",
    );
    const tree = documentTree(preview.document);
    const sectionNames = new Map(tree.sections.map(({ id, internalName }) => [id, internalName]));
    const presented = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
      nodes.map((node) =>
        node.ref.kind === "section"
          ? {
              ...node,
              internalName: sectionNames.get(node.ref.sectionId),
              children: presented(node.children ?? []),
            }
          : node,
      );
    return html`<section data-test="document" aria-labelledby="document-heading">
      <h2 id="document-heading">${heading}</h2>
      <dashboard-menu-structure-tree
        readonly
        label=${heading}
        .nodes=${presented(tree.nodes)}
        .products=${tree.products}
      ></dashboard-menu-structure-tree>
    </section>`;
  }

  #renderPublish() {
    if (this.failed || this.preview === null || this.#upToDate(this.preview) !== null)
      return nothing;
    const menu = { menu: this.menuName };
    return html`<div class="actions">
      <wt-button
        variant="primary"
        data-test="publish"
        .loading=${this.publishing}
        .disabled=${this.preview.clashes.length > 0}
        @click=${(event: Event) => this.#publish(event)}
        >${fill(
          this.publishing ? "menu_preview.publishing" : "menu_preview.publish",
          menu,
        )}</wt-button
      >
      <p class="help" data-test="only-this-menu">${fill("menu_preview.only_this_menu", menu)}</p>
    </div>`;
  }

  #renderClashes() {
    const clashes = this.preview?.clashes ?? [];
    if (!clashes.length) return nothing;
    return html`<section>
      <h2 data-test="clash-count">
        ${fill(clashes.length === 1 ? "menu_preview.clash_count" : "menu_preview.clashes_count", { count: String(clashes.length) })}
      </h2>
      <ul data-test="clashes">
        ${clashes.map((clash) => {
          const offer = Object.values(this.preview!.document.offers).find(
            (offer) => offer.productId === clash.productId,
          );
          const name = offer?.name ?? clash.productId;
          const variant = clash.variantId
            ? (offer?.variants.find((variant) => variant.id === clash.variantId)?.name ??
              clash.variantId)
            : null;
          const words = describeSetting(
            {
              state: "clash",
              candidates:
                clash.candidates as import("@waitron/catalogue/src/menu-combine-types.js").Candidate<
                  import("@waitron/shared").Decimal
                >[],
            },
            { product: name },
            t,
          );
          return html`<li>
            ${name}${variant ? ` — ${variant}` : ""}: ${t("menu_prices.menu_price")} — ${words}
          </li>`;
        })}
      </ul>
    </section>`;
  }

  override render() {
    return html`${this.#renderLive()} ${this.#renderResult()} ${this.#renderChanges()}
    ${this.#renderWarnings()} ${this.#renderClashes()} ${this.#renderPublish()}
    ${this.#renderDocument()}
    ${
      this.confirmingHash === null
        ? nothing
        : html`<wt-dialog
            .open=${this.confirmingHash !== null}
            heading=${fill("menu_preview.publish", { menu: this.menuName })}
            data-test="publish-confirmation"
            @wt-close=${(event: Event) => {
              event.stopPropagation();
              this.confirmingHash = null;
            }}
          >
            ${this.#warningWords().map((words) => html`<p>${words}</p>`)}
            <wt-form-actions slot="footer">
              <wt-button
                slot="cancel"
                variant="secondary"
                @click=${() => {
                  this.confirmingHash = null;
                }}
                >${t("action.cancel")}</wt-button
              >
              <wt-button
                data-test="publish-confirm"
                .disabled=${this.publishing || this.preview === null || !!this.preview.clashes.length}
                @click=${(event: Event) => this.#publish(event, true)}
                >${fill("menu_preview.publish", { menu: this.menuName })}</wt-button
              >
            </wt-form-actions>
          </wt-dialog>`
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-preview": MenuPreviewPanel;
  }
}
