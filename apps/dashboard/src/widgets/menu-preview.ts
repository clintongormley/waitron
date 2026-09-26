import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { formatMoney } from "@waitron/shared";
import type {
  MenuChange,
  MenuPreview,
  MenuStatus,
  ProductChangeField,
  SectionChangeField,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

/** How the host's last publish ended, for the panel to say. */
export type PublishResult =
  { kind: "published"; number: number } | { kind: "stale" } | { kind: "failed"; reason: string };

const PRODUCT_FIELDS: Record<ProductChangeField, StringKey> = {
  names: "menu_preview.field_names",
  description: "menu_preview.field_description",
  image: "menu_preview.field_image",
  unit: "menu_preview.field_unit",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
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
  shared_section: "menu_preview.source_shared_section",
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

/** Says a publish did not happen, what is still live, and that the working edits are kept. */
export function publishFailure(menu: string, status: MenuStatus | null, reason: string): string {
  return status !== null && status.state !== "unpublished"
    ? fill("menu_preview.failed_kept", { menu, number: String(status.version), reason })
    : fill("menu_preview.failed", { menu, reason });
}

/**
 * What publishing one menu would change from its live version, each change in words with where it
 * came from, the warnings that do not stop it, and the button that publishes the menu. The host reads
 * the preview and performs the publish: the button asks for it as `wt-menu-publish` with the hash the
 * preview showed, and a failed read offers `wt-preview-retry`.
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
  @property({ type: Boolean }) publishing = false;
  @property({ attribute: false }) result: PublishResult | null = null;

  /** One place, named as the Prices tab names it. */
  #place(path: readonly string[]): string {
    return path.length === 0 ? t("menu_prices.top_level") : path.join(" › ");
  }

  #places(paths: readonly (readonly string[])[]): string {
    return new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(
      paths.map((path) => this.#place(path)),
    );
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
      case "layout_changed":
        return fill("menu_preview.layout_changed", { name: change.name });
      case "default_layout_changed":
        return fill("menu_preview.default_layout_changed", { from: change.from, to: change.to });
      case "menu_renamed":
        return fill("menu_preview.menu_renamed", { from: change.from, to: change.to });
    }
  }

  #source(change: MenuChange): string {
    const source = t(SOURCES[change.source]);
    return change.alsoOn?.length
      ? fill("menu_preview.also_on", { source, menus: change.alsoOn.join(", ") })
      : source;
  }

  /** The live version's number when the working menu is exactly that version, else null. */
  #upToDate(): number | null {
    const status = this.status;
    return status !== null && status.state !== "unpublished" && status.hash === this.preview?.hash
      ? status.version
      : null;
  }

  #publish(): void {
    if (this.publishing || this.preview === null) return;
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
          ${t("menu_preview.error")}
        </p>
        <div>
          <wt-button
            variant="secondary"
            data-test="preview-retry"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent("wt-preview-retry", { detail: {}, bubbles: true, composed: true }),
              )}
            >${t("menus.retry")}</wt-button
          >
        </div>`;
    else if (preview === null)
      body = html`<p class="note" role="status" data-test="preview-loading">
        ${t("menu_preview.loading")}
      </p>`;
    else if (this.#upToDate() !== null)
      body = html`<p data-test="nothing">
        ${fill("menu_preview.nothing", { number: String(this.#upToDate()) })}
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
        ${warnings.map(
          (warning) =>
            html`<li>
              ${fill("menu_preview.shortcut_omitted", {
                name: warning.name,
                layout: warning.layoutName,
              })}
            </li>`,
        )}
      </ul>
    </section>`;
  }

  #renderPublish() {
    if (this.failed || this.preview === null || this.#upToDate() !== null) return nothing;
    const menu = { menu: this.menuName };
    return html`<div class="actions">
      <wt-button
        variant="primary"
        data-test="publish"
        .loading=${this.publishing}
        @click=${() => this.#publish()}
        >${fill(
          this.publishing ? "menu_preview.publishing" : "menu_preview.publish",
          menu,
        )}</wt-button
      >
      <p class="help" data-test="only-this-menu">${fill("menu_preview.only_this_menu", menu)}</p>
    </div>`;
  }

  override render() {
    return html`${this.#renderLive()} ${this.#renderResult()} ${this.#renderChanges()}
    ${this.#renderWarnings()} ${this.#renderPublish()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-preview": MenuPreviewPanel;
  }
}
