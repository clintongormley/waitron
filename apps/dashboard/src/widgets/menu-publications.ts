import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  LocalTime,
  MenuPreview,
  MenuPublicationsAnswer,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type Edition = MenuPublicationsAnswer["editions"][number];

const STATE_KEYS: Record<Edition["state"], StringKey> = {
  queued: "menu_publications.state_queued",
  cancelled: "menu_publications.state_cancelled",
  activated: "menu_publications.state_activated",
};

/** Fills `{key}` placeholders; each value is inserted once, never re-read as a placeholder. */
function fill(key: StringKey, values: Record<string, string>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** A venue-local time in the screen language ("8 Oct 2026, 08:00"), its offset added only when the
 * venue clock shows that minute twice. */
export function localTimeWords(local: LocalTime): string {
  const [year, month, day] = local.date.split("-").map(Number) as [number, number, number];
  const date = new Intl.DateTimeFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  const words = fill("menu_publications.time", { date, time: local.time });
  return local.repeated
    ? fill("menu_publications.repeated_time", { time: words, offset: local.offset })
    : words;
}

function versionWords(edition: Edition): string {
  return fill("menu_publications.version", { number: String(edition.number) });
}

/**
 * A menu's scheduled versions, soonest first, then the latest settled ones, each with its
 * venue-local time and state. A queued version can be cancelled after a confirmation.
 */
@customElement("dashboard-menu-publications")
export class MenuPublicationsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* The preview panel lets its text break anywhere, which would also let the table squeeze
         the pinned Actions heading mid-word. */
      :host {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
        overflow-wrap: normal;
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .retry {
        display: flex;
      }
      wt-data-table::part(settled) {
        color: var(--wt-color-text-muted);
      }
      .question {
        margin: 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property() menuName = "";
  @property({ attribute: false }) preview: MenuPreview | null = null;

  @state() private answer: MenuPublicationsAnswer | null = null;
  @state() private loading = true;
  @state() private readError: string | null = null;
  /** A Cancel waiting for its confirmation; a refused one stays open with its refusal. */
  @state() private cancelling: Edition | null = null;
  @state() private cancelError: string | null = null;
  @state() private busy = false;

  /** The menu whose editions are followed. */
  #watching: string | null = null;
  /** A row menu's popover closes on the click, so the dialog hands focus back to its trigger. */
  #focusTarget: HTMLElement | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeOf(error);
    },
    () => {
      this.readError = null;
    },
  );

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // The query controller releases every observation when its host leaves the page.
    this.#watching = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("menuId")) this.#follow();
  }

  #follow(): void {
    if (!this.isConnected || this.menuId === "" || this.menuId === this.#watching) return;
    this.answer = null;
    this.cancelling = null;
    this.cancelError = null;
    void this.#load();
  }

  async #load(): Promise<void> {
    const menuId = this.menuId;
    this.#watching = menuId;
    this.loading = true;
    this.readError = null;
    try {
      await this.#queries.watch("getMenuPublications", [menuId], (answer) => {
        this.answer = answer;
        // The controller's recovery fires only for its own failed reads, not a failed re-read.
        this.readError = null;
      });
    } catch {
      // The query's error callback has already recorded the failure.
    } finally {
      if (menuId === this.menuId) this.loading = false;
    }
  }

  /** After a write: a failed read here is a load failure, not a failed cancel. */
  async #refresh(): Promise<void> {
    const menuId = this.menuId;
    try {
      const answer = await this.api.getMenuPublications(menuId);
      if (menuId !== this.menuId) return;
      this.answer = answer;
      this.readError = null;
    } catch (error) {
      if (menuId === this.menuId) this.readError = codeOf(error);
    }
  }

  #openCancel(edition: Edition, event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    this.#focusTarget = menu.shadowRoot!.querySelector("button");
    this.cancelError = null;
    this.cancelling = edition;
  }

  #close(): void {
    this.cancelling = null;
    this.cancelError = null;
    requestAnimationFrame(() => {
      if (this.#focusTarget?.isConnected) this.#focusTarget.focus();
      else this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
    });
  }

  async #confirmCancel(): Promise<void> {
    const target = this.cancelling;
    if (target === null || this.busy) return;
    this.busy = true;
    this.cancelError = null;
    try {
      await this.api.cancelMenuPublication(this.menuId, target.versionId);
    } catch (error) {
      this.cancelError = codeOf(error);
      // The row the refusal came from is out of date.
      if (
        this.cancelError === "menu_publication.not_queued" ||
        this.cancelError === "menu_publication.not_found"
      )
        void this.#refresh();
      return;
    } finally {
      this.busy = false;
    }
    // The cancelled row loses its menu, so focus goes to the heading.
    this.#focusTarget = null;
    this.#close();
    await this.#refresh();
  }

  #columns(): DataTableColumn<Edition>[] {
    return [
      {
        key: "version",
        label: t("menu_publications.version_column"),
        cell: (edition) =>
          html`<span data-test=${`version-${edition.versionId}`}>${versionWords(edition)}</span>`,
      },
      {
        key: "time",
        label: t("menu_publications.time_column"),
        cell: (edition) =>
          html`<span data-test=${`time-${edition.versionId}`}
            >${localTimeWords(edition.local)}</span
          >`,
      },
      {
        key: "state",
        label: t("menu_publications.state_column"),
        cell: (edition) =>
          html`<span
            part=${edition.state === "queued" ? "state" : "state settled"}
            data-test=${`state-${edition.versionId}`}
            >${t(STATE_KEYS[edition.state])}</span
          >`,
      },
      {
        key: "actions",
        label: t("menu_publications.actions"),
        pinned: "end",
        cell: (edition) =>
          edition.state !== "queued"
            ? nothing
            : html`<wt-row-actions
                label=${`${t("menu_publications.actions")}: ${versionWords(edition)}`}
                ><wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`cancel-${edition.versionId}`}
                  @click=${(event: Event) => this.#openCancel(edition, event)}
                  >${t("menu_publications.cancel")}</wt-button
                ></wt-row-actions
              >`,
      },
    ];
  }

  #renderDialog(): TemplateResult {
    const target = this.cancelling;
    return html`<wt-dialog
      data-test="cancel-dialog"
      heading=${t("menu_publications.cancel_heading")}
      .open=${target !== null}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.cancelling !== null) this.#close();
      }}
    >
      ${
        target === null
          ? nothing
          : html`<p class="question" data-test="cancel-question">
              ${fill("menu_publications.cancel_question", {
                number: String(target.number),
                time: localTimeWords(target.local),
              })}
            </p>`
      }
      <wt-form-actions
        slot="footer"
        .error=${target === null || this.cancelError === null ? "" : codeMessage(this.cancelError)}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-keep"
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("menu_publications.keep")}</wt-button
        >
        <wt-button
          variant="danger"
          data-test="cancel-confirm"
          .loading=${this.busy && target !== null}
          @click=${() => void this.#confirmCancel()}
          >${t("menu_publications.cancel")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  override render(): TemplateResult {
    return html`<h2 tabindex="-1">${t("menu_publications.heading")}</h2>
      <wt-data-table
        data-test="editions"
        aria-label=${t("menu_publications.heading")}
        noMatchesMessage=${tableNoMatches()}
        .rows=${this.answer?.editions ?? []}
        .columns=${this.#columns()}
        .rowKey=${(edition: Edition) => edition.versionId}
        .loading=${this.loading}
        .loadingMessage=${t("menu_publications.loading")}
        .emptyMessage=${t("menu_publications.empty")}
        .errorMessage=${this.readError === null ? "" : codeMessage(this.readError)}
      ></wt-data-table>
      ${
        this.readError === null
          ? nothing
          : html`<div class="retry">
              <wt-button
                data-test="editions-retry"
                variant="secondary"
                @click=${() => void this.#load()}
                >${t("menus.retry")}</wt-button
              >
            </div>`
      }
      ${this.#renderDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-publications": MenuPublicationsPanel;
  }
}
