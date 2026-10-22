import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { BUILT_IN_THEME_NAME, WAITRON_CHOICES } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { countOf } from "../widgets/count-text.js";
import { settingsCard, settingsCardStyles } from "../widgets/settings-card.js";
import "../widgets/theme-name-dialog.js";
import type { ThemeNameDialog, ThemeNameRequest } from "../widgets/theme-name-dialog.js";
import { copyName } from "../widgets/theme-names.js";
import { saveDialogLine } from "../widgets/theme-words.js";
import { repaintVenueTheme } from "../widgets/venue-theme-repaint.js";

export type ThemesChanged =
  | { kind: "saved"; theme: ThemeView }
  | { kind: "created"; theme: ThemeView; inUse: boolean }
  | { kind: "renamed"; theme: ThemeView }
  | { kind: "deleted"; id: string; inUse: string | null }
  | { kind: "switched"; inUse: string | null };

export type ThemeEdit = { id: string } | { kind: "new" };

const WAITRON_KEY = "waitron";
const PRIMARY = "--wt-color-primary";
const BG = "--wt-color-bg";
/** Repeats DRAWER_BREAKPOINT's literal (`dashboard-app.ts`), as `settings-card.ts` does in CSS. */
const PHONE = "(max-width: 48rem)";

interface Row {
  key: string;
  name: string;
  builtIn: boolean;
  inUse: boolean;
  colours: [string, string, string];
  warnings: number;
  /** null on Waitron's row. */
  view: ThemeView | null;
}

function coloursOf(view: ThemeView | null): [string, string, string] {
  const brand = view?.choices?.brandColor ?? WAITRON_DEFAULTS.light[PRIMARY]!;
  const light = (view?.choices && view.light) || WAITRON_DEFAULTS.light;
  const dark = (view?.choices && view.dark) || WAITRON_DEFAULTS.dark;
  return [brand, light[BG]!, dark[BG]!];
}

function rowsOf(list: ThemeList): Row[] {
  return [
    {
      key: WAITRON_KEY,
      name: BUILT_IN_THEME_NAME,
      builtIn: true,
      inUse: list.inUse === null,
      colours: coloursOf(null),
      warnings: 0,
      view: null,
    },
    ...list.themes.map((view) => ({
      key: view.id,
      name: view.name,
      builtIn: false,
      inUse: list.inUse === view.id,
      colours: coloursOf(view),
      warnings: view.warnings.length,
      view,
    })),
  ];
}

@customElement("dashboard-themes-card")
export class ThemesCard extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-data-table::part(chip) {
        display: inline-block;
        vertical-align: middle;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        margin-inline-end: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
      }
      wt-data-table::part(tag) {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: 0 var(--wt-space-2);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
      wt-data-table::part(tag built-in) {
        margin-inline-start: var(--wt-space-2);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }
      wt-data-table::part(tag in-use) {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(tag hard-to-read) {
        border-color: var(--wt-color-warning);
        color: var(--wt-color-warning);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) list: ThemeList | undefined;
  @property({ attribute: false }) canEdit = false;
  /** The stored theme the Look card's editor has open. */
  @property({ attribute: false }) editingId: string | null = null;
  @state() private phone = false;
  @state() private submitting = false;
  readonly #phone = matchMedia(PHONE);
  readonly #onPhone = () => {
    this.phone = this.#phone.matches;
  };

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#onPhone();
    this.#phone.addEventListener("change", this.#onPhone);
  }

  override disconnectedCallback(): void {
    this.#phone.removeEventListener("change", this.#onPhone);
    super.disconnectedCallback();
  }

  #columns(): DataTableColumn<Row>[] {
    const columns: DataTableColumn<Row>[] = [
      {
        key: "name",
        label: t("appearance.themes_name"),
        cell: (row) =>
          html`<span data-test=${`theme-row-${row.key}`}>${row.name}</span>${
              row.builtIn
                ? html`<span part="tag built-in" data-test="tag-built-in"
                    >${t("appearance.built_in")}</span
                  >`
                : nothing
            }`,
      },
    ];
    if (!this.phone) {
      columns.push({
        key: "colours",
        label: t("appearance.themes_colours"),
        cell: (row) =>
          row.colours.map(
            (colour) =>
              html`<span part="chip" aria-hidden="true" style="background:${colour}"></span>`,
          ),
      });
    }
    columns.push({
      key: "status",
      label: t("appearance.themes_status"),
      cell: (row) => this.#status(row),
    });
    if (this.canEdit) {
      columns.push({
        key: "actions",
        label: t("appearance.theme_actions"),
        pinned: "end",
        cell: (row) => this.#menu(row),
      });
    }
    return columns;
  }

  #item(row: Row, kind: string, label: string, onClick: () => void): TemplateResult {
    return html`<wt-button
      align="start"
      data-test=${`${kind}-${row.key}`}
      variant=${kind === "delete" ? "danger" : "ghost"}
      ?disabled=${this.submitting}
      @click=${onClick}
      >${label}</wt-button
    >`;
  }

  #menu(row: Row): TemplateResult {
    const view = row.view;
    return html`<wt-row-actions label=${`${t("appearance.theme_actions")}: ${row.name}`}>
      ${row.inUse ? nothing : this.#item(row, "use", t("appearance.use_everywhere"), () => {})}
      ${
        view === null
          ? nothing
          : html`${this.#item(row, "edit", t("action.edit"), () => this.#edit({ id: view.id }))}
            ${this.#item(row, "rename", t("appearance.rename"), () => this.#rename(view))}`
      }
      ${this.#item(row, "copy", t("appearance.make_copy"), () => this.#copy(row))}
      ${
        view === null || view.id === this.editingId
          ? nothing
          : this.#item(row, "delete", t("action.delete"), () => {})
      }
    </wt-row-actions>`;
  }

  #edit(detail: ThemeEdit): void {
    this.dispatchEvent(
      new CustomEvent<ThemeEdit>("theme-edit", { detail, bubbles: true, composed: true }),
    );
  }

  #changed(detail: ThemesChanged): void {
    this.dispatchEvent(
      new CustomEvent<ThemesChanged>("themes-changed", { detail, bubbles: true, composed: true }),
    );
  }

  #nameDialog(): ThemeNameDialog | null {
    return this.renderRoot.querySelector("dashboard-theme-name-dialog");
  }

  /** Set before the request's first await: the menus stay disabled until it answers. */
  async #write<T>(send: () => Promise<T>): Promise<T> {
    this.submitting = true;
    try {
      return await send();
    } finally {
      this.submitting = false;
    }
  }

  #ask(request: ThemeNameRequest): void {
    this.#nameDialog()?.show(request);
  }

  #rename(view: ThemeView): void {
    this.#ask({
      kind: "rename",
      name: view.name,
      inUse: false,
      warningLines: [],
      submit: async ({ name }) => {
        const renamed = await this.#write(() => this.api.renameTheme(view.id, name));
        this.#changed({ kind: "renamed", theme: renamed });
      },
    });
  }

  #copy(row: Row): void {
    const choices = row.view?.choices ?? null;
    this.#ask({
      kind: "copy",
      name: copyName(row.name),
      inUse: false,
      warningLines:
        choices === null
          ? []
          : row.view!.warnings.map((warning) => saveDialogLine(warning, choices)),
      submit: async ({ name, inUse }) => {
        const created = await this.#write(() =>
          this.api.createTheme({ name, theme: choices ?? WAITRON_CHOICES, inUse }),
        );
        this.#changed({ kind: "created", theme: created, inUse });
        if (inUse) repaintVenueTheme(this.api);
      },
    });
  }

  #status(row: Row): TemplateResult[] {
    const tags: TemplateResult[] = [];
    if (row.inUse) {
      tags.push(
        html`<span part="tag in-use" data-test="tag-in-use">${t("appearance.in_use")}</span>`,
      );
    }
    if (row.warnings > 0) {
      tags.push(
        html`<span part="tag hard-to-read" data-test="tag-hard-to-read"
          ><wt-icon name="warning"></wt-icon>${countOf(
            "appearance.hard_to_read_count",
            row.warnings,
          )}</span
        >`,
      );
    }
    return tags;
  }

  override render() {
    if (this.list === undefined) return nothing;
    return html`${settingsCard({
      id: "themes-card",
      heading: t("appearance.themes"),
      editing: false,
      action: this.canEdit
        ? html`<wt-button
            data-test="new-theme"
            variant="secondary"
            @click=${() => this.#edit({ kind: "new" })}
            >${t("appearance.new_theme")}</wt-button
          >`
        : nothing,
      body: html`<wt-data-table
        aria-label=${t("appearance.themes_table")}
        .rows=${rowsOf(this.list)}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
      ></wt-data-table>`,
    })}${
      this.canEdit ? html`<dashboard-theme-name-dialog></dashboard-theme-name-dialog>` : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-themes-card": ThemesCard;
  }
}
