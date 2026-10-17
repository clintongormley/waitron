import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import "./publish-dialog.js";
import "./shift-edit-dialog.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import { areaKey, type Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { dateLabel } from "./format.js";
import { hours } from "./rota-format.js";
import { EVERYONE, chosenShow, matchesFor } from "./rota-model.js";
import { breachText } from "./rota-warnings.js";
import { t, tf } from "./strings.js";
import "./rota-by-area.js";
import "./rota-by-person.js";
import "./slot-picker.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";

const step = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
@customElement("staffing-rota")
export class RotaView extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container: rota / inline-size;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-3);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .head wt-combobox {
        min-width: calc(var(--wt-tap-min) * 4);
      }
      .layout {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: start;
      }
      .grid {
        flex: 1 1 70%;
        min-width: 0;
        max-width: 100%;
      }
      aside {
        flex: 1 1 calc(var(--wt-tap-min) * 5);
        min-width: 0;
        max-width: 100%;
      }
      @container rota (width < 1100px) {
        .grid,
        aside {
          flex-basis: 100%;
        }
      }
      small.status {
        display: block;
      }
      h3 {
        font-size: var(--wt-font-size-md);
        margin: 0 0 var(--wt-space-2);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--wt-space-4);
      }
      li {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-1);
        border-block-end: 1px solid var(--wt-color-border);
        overflow-wrap: anywhere;
      }
      li[data-over-contract] {
        color: var(--wt-color-warning);
        font-weight: var(--wt-font-weight-bold);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .status {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) api!: StaffingApi;
  @property() week = "";
  @property({ attribute: false }) params: Readonly<Record<string, string>> = {};
  @property({ type: Boolean }) canWrite = false;
  @property({ attribute: false }) open!: (view: string, params: Record<string, string>) => void;
  @state() private read?: RotaWeek;
  @state() private loadError = "";
  @state() private actionError = "";
  @state() private picked?: Slot;
  @state() private editor?: { shiftId?: string; businessDay?: string; personId?: string };
  @state() private busy = false;
  @state() private warnings?: { breaches: RosterBreach[]; ruleset: WorkTimeRuleset | null };
  @state() private warningsError = "";
  @state() private swapNotice: number | undefined;
  @state() private changingError = "";
  @state() private publishing = false;
  @state() private publishError = "";
  // The rota observation triggers this read; a second live observation would duplicate it.
  readonly #warningQueries = new QueryController(
    this,
    () => undefined,
    (e) => {
      this.warnings = undefined;
      this.warningsError = tf("staffing.rota.warnings_error", { reason: codeMessage(codeOf(e)) });
    },
  );
  #watching = "";
  #area = "";
  #generation = 0;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (e) => {
      this.loadError = tf("staffing.rota.load_error", { reason: codeMessage(codeOf(e)) });
    },
    () => {
      this.loadError = "";
    },
  );
  override connectedCallback() {
    super.connectedCallback();
    this.#watching = "";
    this.requestUpdate();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#generation++;
  }
  override willUpdate() {
    if ((this.params.area ?? "") !== this.#area) {
      this.#area = this.params.area ?? "";
      this.picked = undefined;
      this.actionError = "";
    }
    if (this.week && this.week !== this.#watching) {
      this.#watching = this.week;
      this.#generation++;
      this.editor = undefined;
      this.warnings = undefined;
      this.warningsError = "";
      this.publishing = false;
      this.swapNotice = undefined;
      this.changingError = "";
      this.publishError = "";
      this.#warningQueries.release("rota-warnings");
      this.picked = undefined;
      this.actionError = "";
      this.busy = false;
      this.loadError = "";
      this.#watch();
    }
  }
  #watch() {
    const week = this.week;
    void this.api
      .watchRota(this.#queries, week, (read) => {
        this.read = read;
        this.loadError = "";
        this.warnings = undefined;
        void this.api
          .watchRotaWarnings(this.#warningQueries, read.locationId, week, (warnings) => {
            this.warnings = warnings;
            this.warningsError = "";
          })
          .catch(() => undefined);
        if (read.version?.status === "published") {
          this.publishing = false;
          this.editor = undefined;
        }
        if (
          this.picked &&
          !this.busy &&
          (read.version?.status === "published" ||
            !read.days
              .flatMap((d) => d.areas)
              .flatMap((a) => a.match.slots)
              .some((s) => s.slot.key === this.picked!.key && s.status.kind === "unfilled"))
        )
          this.picked = undefined;
      })
      .catch(() => undefined);
  }
  #go(week: string, area = this.params.area) {
    this.open("rota", { week, ...(area ? { area } : {}) });
  }
  async #fill(personId: string) {
    const slot = this.picked,
      read = this.read,
      generation = this.#generation;
    if (
      this.busy ||
      !slot ||
      !read ||
      read.week !== this.week ||
      read.version?.status === "published" ||
      !this.canWrite
    )
      return;
    this.busy = true;
    this.actionError = "";
    try {
      await this.api.addRotaShift({
        week: this.week,
        businessDay: slot.businessDay,
        area: slot.area,
        staffRoleId: slot.staffRoleId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        personId,
      });
      if (generation !== this.#generation) return;
      this.picked = undefined;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.actionError = tf("staffing.rota.save_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #changeWeek() {
    const generation = this.#generation;
    if (this.busy || !this.canWrite || this.read?.version?.status !== "published") return;
    this.busy = true;
    this.changingError = "";
    try {
      const result = await this.api.changeRotaWeek(this.week);
      if (generation !== this.#generation) return;
      this.swapNotice = result.openSwaps.length || undefined;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.changingError = tf("staffing.rota.change_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #publish() {
    const version = this.read?.version,
      generation = this.#generation;
    if (
      this.busy ||
      !this.canWrite ||
      !this.publishing ||
      !this.warnings ||
      version?.status !== "draft"
    )
      return;
    this.busy = true;
    this.publishError = "";
    try {
      await this.api.publishRota(version.id);
      if (generation !== this.#generation) return;
      this.publishing = false;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.publishError = tf("staffing.rota.publish_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  override render() {
    const read = this.read?.week === this.week ? this.read : undefined;
    const show = read ? chosenShow(read, this.params.area) : undefined;
    const matches = read && show ? matchesFor(read, show) : [];
    const slots = matches.flatMap((m) => m.slots);
    return html`<div class="head">
        <wt-button
          variant="secondary"
          data-test="previous-week"
          aria-label=${t("staffing.rota.previous")}
          @click=${() => this.#go(step(this.week, -7))}
          >‹</wt-button
        >
        <h2 data-test="week">
          ${this.week ? `${dateLabel(this.week)} – ${dateLabel(step(this.week, 6))}` : ""}
        </h2>
        <wt-button
          variant="secondary"
          data-test="next-week"
          aria-label=${t("staffing.rota.next")}
          @click=${() => this.#go(step(this.week, 7))}
          >›</wt-button
        >
        ${read ? html`<wt-combobox name="area" label=${t("staffing.month.area")} search="never" .value=${show!.kind === "area" ? show!.key : EVERYONE} .options=${[{ value: EVERYONE, label: t("staffing.rota.everyone") }, ...read.areas.map((a) => ({ value: areaKey(a.area), label: a.name }))]} @wt-change=${(e: CustomEvent<{ value: string }>) => this.#go(this.week, e.detail.value)}></wt-combobox><span data-test="attention" role="status">${tf("staffing.rota.attention", { unfilled: String(slots.filter((s) => s.status.kind === "unfilled").length), partly: String(slots.filter((s) => s.status.kind === "partly_uncovered").length), over: String(matches.reduce((n, m) => n + m.over.length, 0)) })}</span><span class="status">${t(read.version?.status === "published" ? "staffing.rota.published" : "staffing.rota.draft")}${read.version?.changedSincePublished ? ` · ${t("staffing.rota.changed")}` : ""}</span>` : nothing}
      </div>
      ${
        read && this.warnings
          ? this.warnings.ruleset === null
            ? html`<p role="status">${t("staffing.rota.no_rules")}</p>`
            : html`<p role="status" data-test="labour-count">
                ${this.warnings.breaches.length === 1 ? t("staffing.rota.labour_one") : tf("staffing.rota.labour_count", { count: String(this.warnings.breaches.length) })}
              </p>`
          : nothing
      }
      ${this.swapNotice ? html`<p role="status" data-test="swap-notice">${tf(this.swapNotice === 1 ? "staffing.rota.open_swap_one" : "staffing.rota.open_swaps", { count: String(this.swapNotice) })}</p>` : nothing}
      ${this.changingError ? html`<p role="alert">${this.changingError}</p>` : nothing}
      ${read?.version?.status === "published" && this.canWrite ? html`<wt-button data-test="change-week" ?disabled=${this.busy} @click=${() => void this.#changeWeek()}>${t("staffing.rota.change_week")}</wt-button>` : nothing}
      ${this.warningsError ? html`<p role="alert">${this.warningsError}</p>` : nothing}
      ${
        read?.version?.status === "draft" && this.canWrite
          ? html`<wt-button
              data-test="publish-week"
              variant=${this.warnings ? "primary" : "secondary"}
              ?disabled=${this.busy || !this.warnings}
              @click=${() => {
                this.publishing = true;
                this.publishError = "";
              }}
              >${t("staffing.rota.publish")}</wt-button
            >`
          : nothing
      }
      ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${this.loadError}</p>` : nothing}
      ${
        read
          ? html`<div class="layout">
              <div class="grid">
                ${read.areas.length === 0 ? html`<p>${t("staffing.rota.empty")}</p>` : nothing}
                ${
                  show!.kind === "everyone"
                    ? html`<rota-by-person
                        .week=${read}
                        .canAdd=${read.areas.length > 0}
                        .breaches=${this.warnings?.breaches ?? []}
                        .editable=${this.canWrite && read.version?.status !== "published" && !this.busy}
                        @edit-shift=${(e: CustomEvent<{ shiftId: string }>) => {
                          this.editor = e.detail;
                        }}
                        @add-shift=${(
                          e: CustomEvent<{ personId: string; businessDay: string }>,
                        ) => {
                          this.editor = e.detail;
                        }}
                      ></rota-by-person>`
                    : html`<rota-by-area
                        .week=${read}
                        .breaches=${this.warnings?.breaches ?? []}
                        .area=${show!.area}
                        .editable=${this.canWrite && read.version?.status !== "published" && !this.busy}
                        @edit-shift=${(e: CustomEvent<{ shiftId: string }>) => {
                          this.editor = e.detail;
                        }}
                        @pick-slot=${(e: CustomEvent<{ slot: Slot }>) => {
                          this.picked = e.detail.slot;
                          this.actionError = "";
                        }}
                      ></rota-by-area>`
                }
              </div>
              <aside>
                <h3>${t("staffing.rota.people")}</h3>
                <ul>
                  ${read.people.map(
                    (p) =>
                      html`<li
                        data-person=${p.personId}
                        ?data-over-contract=${p.contractedMinutes !== null && p.plannedMinutes > p.contractedMinutes}
                      >
                        <span
                          >${p.name}<small class="status"
                            >${p.staffRoleIds.map((id) => read.staffRoles.find((r) => r.id === id)?.name).join(", ")}</small
                          >
                          ${this.warnings?.breaches.filter((b) => b.personId === p.personId && !("shiftId" in b)).map((b) => html`<small class="status">${breachText(b)}</small>`)} </span
                        ><span>${hours(p)}</span>
                      </li>`,
                  )}
                </ul>
                ${
                  this.picked
                    ? html`<slot-picker
                        .week=${read}
                        .pickedSlot=${this.picked}
                        .ruleset=${this.warnings?.ruleset ?? null}
                        .busy=${this.busy}
                        .error=${this.actionError}
                        @choose=${(e: CustomEvent<{ personId: string }>) => void this.#fill(e.detail.personId)}
                        @close-picker=${() => {
                          this.picked = undefined;
                          this.actionError = "";
                        }}
                      ></slot-picker>`
                    : nothing
                }
              </aside>
            </div>`
          : this.loadError
            ? nothing
            : html`<p role="status">${t("staffing.rota.loading")}</p>`
      }
      ${
        read
          ? html`<rota-shift-dialog
              .open=${!!this.editor}
              .api=${this.api}
              .week=${read}
              .shiftId=${this.editor?.shiftId}
              .businessDay=${this.editor?.businessDay ?? ""}
              .personId=${this.editor?.personId ?? ""}
              @shift-close=${() => {
                this.editor = undefined;
              }}
              @shift-saved=${() => {
                this.editor = undefined;
                this.#watch();
              }}
            ></rota-shift-dialog>`
          : nothing
      }
      <rota-publish-dialog
        .open=${this.publishing}
        .week=${read}
        .breaches=${this.warnings?.breaches ?? []}
        .busy=${this.busy}
        .error=${this.publishError}
        @back=${() => {
          if (!this.busy) this.publishing = false;
        }}
        @publish=${() => void this.#publish()}
      ></rota-publish-dialog>`;
  }
}
