import { ContentLanguageController, baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import type { DashboardApi, DrawerCloseHistoryDto, ReportPrinter } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { guideHref } from "../help-guide.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";

type Close = DrawerCloseHistoryDto["closes"][number];

@customElement("dashboard-drawer-close-history")
export class DrawerCloseHistory extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        font-size: var(--wt-font-size-md);
      }
      details {
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }
      summary {
        cursor: pointer;
        padding: var(--wt-space-2) 0;
        min-block-size: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
      dl,
      p {
        margin: var(--wt-space-2) 0;
      }
      dt {
        font-weight: var(--wt-font-weight-bold);
      }
      dd {
        margin: 0 0 var(--wt-space-2);
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() from = "";
  @property() to = "";
  @property({ attribute: false }) printer?: ReportPrinter;
  @state() private report: DrawerCloseHistoryDto | null = null;
  @state() private drawerId = "";
  @state() private readingError = "";
  @state() private printing = "";
  @state() private printError = "";
  @state() private sentTo = "";
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readingError = codeOf(error);
    },
  );

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("from") && !changed.has("to") && !changed.has("api")) return;
    this.report = null;
    this.readingError = "";
    this.sentTo = "";
    this.printError = "";
    void this.#queries
      .watch(
        "getDrawerCloses",
        [this.from, this.to],
        (report) => {
          if (
            this.report === null &&
            !report.closes.some(({ drawerId }) => drawerId === this.drawerId)
          ) {
            this.drawerId = "";
          }
          this.report = report;
          this.readingError = "";
        },
        { passive: true },
      )
      .catch(() => {
        // The controller reports the error and retries the read when the source changes.
      });
  }

  async #print(closeId: string) {
    const printer = this.printer;
    if (printer === undefined || this.printing !== "") return;
    this.printing = closeId;
    this.sentTo = "";
    this.printError = "";
    try {
      await this.api.printDrawerClose(closeId, printer.id);
      this.sentTo = printer.name;
    } catch (error) {
      this.printError = codeOf(error);
    } finally {
      this.printing = "";
    }
  }

  override render() {
    const closes = this.report?.closes ?? [];
    const drawers = [...new Map(closes.map(({ drawerId, drawerName }) => [drawerId, drawerName]))];
    const visible =
      this.drawerId === "" ? closes : closes.filter((row) => row.drawerId === this.drawerId);
    const pending = visible.filter((row) => row.finished === null);
    const completed = visible.filter((row) => row.finished !== null);
    const renderRows = (rows: Close[]) =>
      repeat(
        rows,
        (row) => row.id,
        (row) => this.#renderClose(row, this.report!.timeZone),
      );

    return html`
      <section aria-labelledby="drawer-history">
        <h2 id="drawer-history">${t("sales.drawer_history")}</h2>
        ${
          drawers.length === 0
            ? nothing
            : html` <wt-combobox
                label=${t("sales.drawer_filter")}
                name="drawerId"
                show-empty-option
                search="auto"
                .options=${[{ value: "", label: t("sales.drawer_all") }, ...drawers.map(([value, label]) => ({ value, label }))]}
                .value=${this.drawerId}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  this.drawerId = event.detail.value;
                }}
              ></wt-combobox>`
        }
        ${this.readingError ? html`<p class="error" role="alert">${codeMessage(this.readingError)}</p>` : nothing}
        ${
          pending.length === 0
            ? nothing
            : html`
                <p class="muted">${t("sales.drawer_pending_dates")}</p>
                ${renderRows(pending)}
              `
        }
        ${renderRows(completed)}
        ${this.report !== null && visible.length === 0 ? html`<p>${t("sales.drawer_empty")}</p>` : nothing}
        <div class="error" role="alert">
          ${this.printError ? codeMessage(this.printError) : nothing}
        </div>
        <div role="status">
          ${this.sentTo ? fill("sales.drawer_print_sent", { printer: this.sentTo }) : nothing}
        </div>
        <p><a href=${guideHref("sales.drawer-close-history")}>${t("sales.drawer_help")}</a></p>
      </section>
    `;
  }

  #renderClose(
    { first, recount, finished, drawerName, assigned, deleted }: Close,
    timeZone: string,
  ) {
    const locale = currentLocale();
    const date = new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: "short",
      timeStyle: "short",
    });
    const money = (amount: string) => formatMoney(amount, locale);
    const countLine = (count: Close["first"]) =>
      fill("sales.drawer_count_detail", {
        person: count.person,
        date: date.format(new Date(count.at)),
        counted: money(count.counted),
        expected: money(count.expected),
        difference: money(count.difference),
      });
    return html`
      <details>
        <summary>
          ${drawerName} · ${date.format(new Date(finished?.at ?? first.at))} ·
          ${t(finished === null ? "sales.drawer_pending" : "sales.drawer_finished")}
        </summary>
        <dl>
          <dt>${t("sales.drawer_first")}</dt>
          <dd>${countLine(first)}</dd>
          ${
            recount === null
              ? nothing
              : html` <dt>${t("sales.drawer_recount")}</dt>
                  <dd>${countLine(recount)}</dd>`
          }
          ${
            finished === null
              ? nothing
              : html` <dt>${t("sales.drawer_finished")}</dt>
                  <dd>
                    ${fill("sales.drawer_finish_detail", {
                      person: finished.person,
                      bank: money(finished.bankWithdrawal),
                      left: money(finished.amountLeft),
                    })}
                  </dd>`
          }
        </dl>
        ${
          finished !== null && finished.cashAfterCount !== "0.00"
            ? html`<p>
                ${fill("sales.drawer_after_count", {
                  amount:
                    (finished.cashAfterCount.startsWith("-") ? "" : "+") +
                    money(finished.cashAfterCount),
                })}
              </p>`
            : nothing
        }
        ${first.cashMoved || recount?.cashMoved ? html`<p>${t("sales.drawer_moved")}</p>` : nothing}
        ${
          !deleted && (assigned || finished !== null)
            ? nothing
            : html` <p class="muted">
                ${t(deleted ? "sales.drawer_deleted" : "sales.drawer_unassigned")}
              </p>`
        }
        ${
          finished === null
            ? nothing
            : html` <wt-button
                variant="secondary"
                ?disabled=${this.printer === undefined || this.printing !== ""}
                ?loading=${this.printing === finished.id}
                @click=${() => void this.#print(finished.id)}
                >${t("sales.drawer_print")}</wt-button
              >`
        }
      </details>
    `;
  }
}
