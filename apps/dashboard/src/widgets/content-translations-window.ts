import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import { languageDisplayName } from "@waitron/shared";
import {
  translationCellKey,
  type TranslationCell,
  type TranslationCellRef,
  type TranslationItem,
} from "@waitron/catalogue/src/content-translation-types.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import type { TranslationDrafts } from "./content-translations-model.js";

export function languageWindow(
  languages: readonly string[],
  anchor: string,
  width: "phone" | "desktop",
  focused: string | null,
): string[] {
  const count = width === "phone" ? 1 : 4;
  const start = Math.min(
    Math.max(0, languages.indexOf(anchor)),
    Math.max(0, languages.length - count),
  );
  const selected = new Set(languages.slice(Math.max(0, start - 1), start + count + 1));
  if (focused && languages.includes(focused)) selected.add(focused);
  return languages.filter((language) => selected.has(language));
}

const rowKey = (row: Pick<TranslationItem, "kind" | "id">) => JSON.stringify([row.kind, row.id]);

function editorHref(row: TranslationItem): string {
  const id = encodeURIComponent(row.id);
  const parent = encodeURIComponent(row.parent?.id ?? "");
  switch (row.kind) {
    case "product":
    case "variant":
      return `/manage/catalogue/product/${id}`;
    case "option_list":
      return `/manage/modifiers/view/options/list/${id}`;
    case "option_label":
      return `/manage/modifiers/view/options/list/${parent}`;
    case "extra_list":
      return `/manage/modifiers/view/extras/list/${id}`;
    case "menu":
    case "section":
    case "included_menu":
      return `/manage/menus/menu/${parent}/view/structure`;
    case "unit":
      return "/manage/units";
  }
}

export interface TranslationWindowChange {
  cell: TranslationCellRef;
  value: string;
  accepted: boolean;
}

@customElement("dashboard-content-translation-window")
export class ContentTranslationWindow extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      .row {
        padding-block: var(--wt-space-3);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
      }
      .name {
        overflow-wrap: anywhere;
        margin-block: 0 var(--wt-space-3);
      }
      a {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(var(--translation-columns), minmax(0, 1fr));
        gap: var(--wt-space-3);
      }
      :host([width="phone"]) .fields {
        grid-template-columns: minmax(0, 1fr);
      }
      .language {
        display: grid;
        gap: var(--wt-space-3);
        min-inline-size: 0;
      }
    `,
  ];
  @property({ attribute: false }) rows: readonly TranslationItem[] = [];
  @property({ attribute: false }) languages: readonly string[] = [];
  @property() anchor = "";
  @property({ reflect: true }) width: "phone" | "desktop" = "desktop";
  @property({ attribute: false }) drafts!: TranslationDrafts;
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) errors: readonly { cell: TranslationCellRef; message: string }[] =
    [];
  @state() private focused: TranslationCellRef | null = null;
  @state() private rejected = new Map<string, string>();
  #focusedRow?: TranslationItem;
  #selection?: {
    node: HTMLInputElement;
    start: number | null;
    end: number | null;
    direction: "forward" | "backward" | "none" | null;
  };

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("drafts")) {
      this.focused = null;
      this.#focusedRow = undefined;
      this.rejected = new Map();
      this.#selection = undefined;
      return;
    }
    const control = this.shadowRoot?.activeElement;
    const native = control?.shadowRoot?.activeElement;
    this.#selection =
      native instanceof HTMLInputElement
        ? {
            node: native,
            start: native.selectionStart,
            end: native.selectionEnd,
            direction: native.selectionDirection,
          }
        : undefined;
  }
  get hasRejectedEdits(): boolean {
    return this.rejected.size > 0;
  }
  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const held = this.#selection;
    this.#selection = undefined;
    if (held?.node.isConnected && held.node.getRootNode() instanceof ShadowRoot) {
      held.node.focus({ preventScroll: true });
      held.node.setSelectionRange(held.start, held.end, held.direction ?? undefined);
    }
  }
  #focus(row: TranslationItem, cell: TranslationCell): void {
    this.#focusedRow = row;
    if (!this.focused || translationCellKey(this.focused) !== translationCellKey(cell)) {
      this.focused = { kind: cell.kind, id: cell.id, language: cell.language, field: cell.field };
      this.dispatchEvent(
        new CustomEvent("translation-focus", {
          detail: { cell: this.focused },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
  #blur(): void {
    queueMicrotask(() => {
      if (this.shadowRoot?.activeElement?.tagName === "WT-INPUT") return;
      this.focused = null;
      this.#focusedRow = undefined;
      this.dispatchEvent(
        new CustomEvent("translation-focus", {
          detail: { cell: null },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }
  #edit(cell: TranslationCell, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const accepted = this.drafts.edit(cell, event.detail.value);
    const rejected = new Map(this.rejected);
    if (accepted) rejected.delete(translationCellKey(cell));
    else rejected.set(translationCellKey(cell), event.detail.value);
    this.rejected = rejected;
    this.dispatchEvent(
      new CustomEvent<TranslationWindowChange>("translation-change", {
        detail: {
          cell: { kind: cell.kind, id: cell.id, language: cell.language, field: cell.field },
          value: event.detail.value,
          accepted,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }
  override render() {
    if (!this.drafts) return nothing;
    const languages = languageWindow(
      this.languages,
      this.anchor,
      this.width,
      this.focused?.language ?? null,
    );
    let rows = this.rows.slice(0, 50);
    const held = this.#focusedRow;
    if (this.focused && held && !rows.some((row) => rowKey(row) === rowKey(held)))
      rows = [held, ...rows.slice(0, 49)];
    const overflow = this.drafts.staged().length > 100;
    const staged = new Set(this.drafts.staged().map(translationCellKey));
    return html`${repeat(
      rows,
      rowKey,
      (row) =>
        html`<section
          class="row"
          data-translation-row=${rowKey(row)}
          role="group"
          aria-label=${row.parent ? `${row.parent.name} › ${row.name}` : row.name}
        >
          <p class="name">${row.parent ? `${row.parent.name} › ${row.name}` : row.name}</p>
          <a
            href=${editorHref(row)}
            aria-label=${fill("content_gaps.open_named", { name: row.name })}
            @click=${(event: MouseEvent) => {
              if ((row.kind !== "product" && row.kind !== "variant") || leftToBrowser(event))
                return;
              event.preventDefault();
              this.dispatchEvent(
                new CustomEvent("translation-open", {
                  detail: { row },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            >${t("content_gaps.open")}</a
          >
          <div class="fields" style=${`--translation-columns: ${languages.length}`}>
            ${repeat(
              languages,
              (language) => language,
              (language) =>
                html`<div class="language" lang=${language}>
                  ${repeat(
                    row.cells.filter((cell) => cell.language === language),
                    translationCellKey,
                    (cell) => {
                      const key = translationCellKey(cell);
                      const fault = this.errors.find(
                        (error) => translationCellKey(error.cell) === key,
                      )?.message;
                      const active = this.drafts.origin(cell) !== null;
                      return html`<wt-input
                          name=${`translation-${cell.kind}-${cell.id}-${cell.language}-${cell.field}`}
                          lang=${language}
                          label=${`${languageDisplayName(language, currentLocale())}${row.kind === "unit" ? ` · ${t(cell.field === "name" ? "units.name" : "units.abbreviation")}` : ""}`}
                          placeholder=${cell.effectiveText?.trim() || cell.effectiveDefaultText?.trim() || cell.staffText || ""}
                          .value=${this.rejected.get(key) ?? this.drafts.value(cell)}
                          .error=${fault || (this.rejected.has(key) ? t("translations.input_unavailable") : "")}
                          ?disabled=${this.disabled || !cell.eligible || (overflow && !active)}
                          @focusin=${() => this.#focus(row, cell)}
                          @focusout=${() => this.#blur()}
                          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(cell, event)}
                        ></wt-input>
                        ${
                          staged.has(key)
                            ? html`<wt-button
                                data-unstage=${key}
                                variant="secondary"
                                ?disabled=${this.disabled}
                                aria-label=${fill("translations.unstage_named", { name: row.name, language: languageDisplayName(language, currentLocale()), field: t(cell.field === "name" ? "units.name" : "units.abbreviation") })}
                                @click=${() => {
                                  this.drafts.unstage(cell);
                                  const rejected = new Map(this.rejected);
                                  rejected.delete(key);
                                  this.rejected = rejected;
                                  this.dispatchEvent(
                                    new CustomEvent<TranslationWindowChange>("translation-change", {
                                      detail: {
                                        cell,
                                        value: this.drafts.value(cell),
                                        accepted: true,
                                      },
                                      bubbles: true,
                                      composed: true,
                                    }),
                                  );
                                  this.requestUpdate();
                                }}
                                >${t("translations.unstage")}</wt-button
                              >`
                            : nothing
                        }`;
                    },
                  )}
                </div>`,
            )}
          </div>
        </section>`,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-translation-window": ContentTranslationWindow;
  }
}
