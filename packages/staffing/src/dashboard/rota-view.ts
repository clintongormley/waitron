import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import "./publish-dialog.js";
import "./shift-edit-dialog.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import { fixedTitle, fixedTitleStyles } from "@waitron/venue-service/dashboard/fixed-title";
import { areaKey, type Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { weekTitleParts } from "./format.js";
import {
  EVERYONE,
  attentionTargets,
  chosenShow,
  summary,
  weekCounts,
  weekShiftCount,
  type Show,
  type Target,
} from "./rota-model.js";
import { STAFFING_STRINGS, countWords, t, tf } from "./strings.js";
import "./rota-by-area.js";
import "./rota-by-person.js";
import "./rota-popup.js";
import { slotHeading } from "./slot-picker.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";

const step = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

let widthCandidates: TemplateResult[] | undefined;
/** The titles of every week whose Monday falls in 2026, in each interface language, its month
 *  names shaped as the links are, as the Calendar Week sizes its title. */
function titleCandidates(): TemplateResult[] {
  if (!widthCandidates) {
    widthCandidates = [];
    for (const language of Object.keys(STAFFING_STRINGS))
      for (let monday = "2026-01-05"; monday < "2027-01-01"; monday = step(monday, 7))
        widthCandidates.push(
          html`${weekTitleParts(monday, language).map((part) =>
            part.month ? html`<span class="title-link">${part.text}</span>` : part.text,
          )}`,
        );
  }
  return widthCandidates;
}
@customElement("staffing-rota")
export class RotaView extends LitElement {
  static override styles = [
    baseStyles,
    fixedTitleStyles,
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
      .title-link {
        display: inline-block;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
      .title-link:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .head wt-combobox {
        min-width: calc(var(--wt-tap-min) * 4);
      }
      .end {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-inline-start: auto;
      }
      .state {
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-sunken);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .state[data-published] {
        border-color: var(--wt-color-success);
        background: var(--wt-color-surface);
        color: var(--wt-color-success);
      }
      .note {
        color: var(--wt-color-text-muted);
      }
      .attention {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-1);
      }
      .count {
        min-block-size: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: none;
        color: var(--wt-color-warning);
        font: inherit;
        font-weight: var(--wt-font-weight-medium);
        text-decoration: underline dotted;
        text-underline-offset: var(--wt-space-1);
        cursor: pointer;
      }
      .summary {
        color: var(--wt-color-text-muted);
      }
      .summary[data-summary="all_filled"] {
        color: var(--wt-color-success);
        font-weight: var(--wt-font-weight-medium);
      }
      .labour {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-medium);
      }
      .swap {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: StaffingApi;
  @property() week = "";
  @property({ attribute: false }) params: Readonly<Record<string, string>> = {};
  @property({ type: Boolean }) canWrite = false;
  @property({ type: Boolean }) canWriteStaffing = false;
  @property({ type: Boolean }) canOpenStaffing = false;
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
  #anchor: HTMLElement | undefined;
  /** The slot key the popup was last opened for. */
  #shownFor: string | undefined;
  #generation = 0;
  /** The target each count button last focused, to step on from. */
  #stepped: Partial<Record<"unfilled" | "partly" | "over", Target>> = {};
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
  override updated() {
    const popup = this.renderRoot.querySelector("rota-popup");
    const picked = this.picked;
    if (!picked) {
      if (this.#shownFor !== undefined) popup?.hide();
      this.#shownFor = undefined;
      return;
    }
    if (this.#shownFor === picked.key) {
      void this.#reanchor(picked);
      return;
    }
    this.#shownFor = picked.key;
    void this.renderRoot.querySelector<LitElement>("slot-picker")!.updateComplete.then(() => {
      if (this.picked === picked) popup!.show(this.#anchor!);
    });
  }
  /** A slot's card is a new element once the grid turns editable or read-only, as it does while a
   *  fill is in flight, so an open popup follows the card carrying the picked slot's key. */
  async #reanchor(picked: Slot) {
    const grid = this.renderRoot.querySelector<LitElement>("rota-by-area");
    if (!grid) return;
    await grid.updateComplete;
    const card = grid.shadowRoot!.querySelector<HTMLElement>(`[data-slot="${picked.key}"]`);
    const popup = this.renderRoot.querySelector("rota-popup");
    if (this.picked !== picked || !card || card === this.#anchor) return;
    this.#anchor = card;
    if (popup?.shown) popup.show(card);
  }
  readonly #popupClosed = () => {
    // A close that arrives while the popup is open again belongs to an earlier showing: leave the
    // pick alone.
    if (this.renderRoot.querySelector("rota-popup")?.shown) return;
    this.picked = undefined;
    this.actionError = "";
  };
  /** A fill that settles once its picker is gone leaves focus on nothing: the card it started
   *  from was redrawn while the fill was in flight. */
  async #refocus(key: string) {
    await this.updateComplete;
    const grid = this.renderRoot.querySelector<LitElement>("rota-by-area");
    if (this.picked || !grid) return;
    await grid.updateComplete;
    if (document.activeElement === document.body)
      grid.shadowRoot!.querySelector<HTMLElement>(`[data-slot="${key}"]`)?.focus();
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
      if (generation === this.#generation) {
        this.busy = false;
        void this.#refocus(slot.key);
      }
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
  #attention(read: RotaWeek, show: Show) {
    const kind = summary(read, show);
    if (kind !== "counts") {
      const words = t(`staffing.rota.${kind}`);
      return {
        words,
        body: html`<span class="summary" data-test="summary" data-summary=${kind}>${words}</span>`,
      };
    }
    const counts = weekCounts(read, show);
    const kinds = (["unfilled", "partly", "over"] as const).filter((k) => counts[k] > 0);
    return {
      words: kinds.map((k) => countWords(k, counts[k])).join(" · "),
      body: kinds.map(
        (k, i) =>
          html`${i ? " · " : nothing}<button
              type="button"
              class="count"
              data-kind=${k}
              @click=${() => void this.#step(read, show, k)}
            >
              ${countWords(k, counts[k])}
            </button>`,
      ),
    };
  }
  async #step(read: RotaWeek, show: Show, kind: "unfilled" | "partly" | "over") {
    const targets = attentionTargets(read, show, kind);
    const same = (a: Target, b: Target | undefined) =>
      !!b && (["businessDay", "slotKey", "shiftId", "header"] as const).every((k) => a[k] === b[k]);
    const next =
      targets[(targets.findIndex((t) => same(t, this.#stepped[kind])) + 1) % targets.length]!;
    const grid = this.renderRoot.querySelector<
      LitElement & { focusTarget(target: Target): boolean }
    >(show.kind === "everyone" ? "rota-by-person" : "rota-by-area")!;
    await grid.updateComplete;
    if (grid.focusTarget(next)) this.#stepped[kind] = next;
  }
  #labour() {
    if (!this.warnings) return nothing;
    if (this.warnings.ruleset === null)
      return html`<span class="note" aria-hidden="true">·</span>
        <span class="note" role="status" data-test="no-rules"
          >${t("staffing.rota.no_rules")}</span
        >`;
    const count = this.warnings.breaches.length;
    return html`<span class="labour" role="status" data-test="labour-count"
      ><span aria-hidden="true">⚠</span>
      ${count === 1 ? t("staffing.rota.labour_one") : tf("staffing.rota.labour_count", { count: String(count) })}</span
    >`;
  }
  #action(read: RotaWeek) {
    if (!this.canWrite) return nothing;
    if (read.version?.status === "published")
      return html`<wt-button
        variant="secondary"
        data-test="change-week"
        ?disabled=${this.busy}
        @click=${() => void this.#changeWeek()}
        >${t("staffing.rota.change_week")}</wt-button
      >`;
    const ready = !!this.warnings && weekShiftCount(read) > 0;
    return html`<wt-button
      data-test="publish-week"
      variant=${ready ? "primary" : "secondary"}
      ?disabled=${this.busy || !ready}
      @click=${() => {
        this.publishing = true;
        this.publishError = "";
      }}
      >${t(read.version?.changedSincePublished ? "staffing.rota.publish_changes" : "staffing.rota.publish")}</wt-button
    >`;
  }
  #title(show: Show | undefined) {
    if (!this.week) return nothing;
    return weekTitleParts(this.week).map((part) => {
      const { month } = part;
      if (!month || !this.canOpenStaffing) return part.text;
      return html`<button
        type="button"
        class="title-link"
        aria-describedby="month-hint"
        @click=${() =>
          this.open("staffing", { month, ...(show?.kind === "area" ? { area: show.key } : {}) })}
      >
        ${part.text}
      </button>`;
    });
  }
  override render() {
    const read = this.read?.week === this.week ? this.read : undefined;
    const show = read ? chosenShow(read, this.params.area) : undefined;
    const attention = read && show ? this.#attention(read, show) : undefined;
    const published = read?.version?.status === "published";
    return html`<div class="head" data-test="bar">
        <wt-button
          variant="secondary"
          data-test="previous-week"
          aria-label=${t("staffing.rota.previous")}
          @click=${() => this.#go(step(this.week, -7))}
          >‹</wt-button
        >
        ${fixedTitle(html`<h2 data-test="week">${this.#title(show)}</h2>`, titleCandidates())}
        <wt-button
          variant="secondary"
          data-test="next-week"
          aria-label=${t("staffing.rota.next")}
          @click=${() => this.#go(step(this.week, 7))}
          >›</wt-button
        >
        ${
          read
            ? html`<wt-combobox
                  name="area"
                  label=${t("staffing.month.area")}
                  search="never"
                  .value=${show!.kind === "area" ? show!.key : EVERYONE}
                  .options=${[{ value: EVERYONE, label: t("staffing.rota.everyone") }, ...read.areas.map((a) => ({ value: areaKey(a.area), label: a.name }))]}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#go(this.week, e.detail.value)}
                ></wt-combobox>
                <div class="end">
                  <span class="state" data-test="state" ?data-published=${published}
                    >${t(published ? "staffing.rota.published" : "staffing.rota.draft")}</span
                  >
                  ${
                    !published && read.version?.changedSincePublished
                      ? html`<span class="note" data-test="still-published"
                          >${t("staffing.rota.still_published")}</span
                        >`
                      : nothing
                  }
                  <span class="attention" data-test="attention">${attention!.body}</span>
                  ${this.#labour()} ${this.#action(read)}
                </div>`
            : nothing
        }
      </div>
      <span id="month-hint" class="visually-hidden">${t("staffing.rota.month_hint")}</span>
      <span class="visually-hidden" role="status" data-test="attention-status"
        >${attention?.words ?? ""}</span
      >
      ${this.swapNotice ? html`<p class="swap" role="status" data-test="swap-notice">${tf(this.swapNotice === 1 ? "staffing.rota.open_swap_one" : "staffing.rota.open_swaps", { count: String(this.swapNotice) })}</p>` : nothing}
      ${this.changingError ? html`<p role="alert">${this.changingError}</p>` : nothing}
      ${this.warningsError ? html`<p role="alert">${this.warningsError}</p>` : nothing}
      ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${this.loadError}</p>` : nothing}
      ${this.actionError && !this.picked ? html`<p class="error" role="alert" data-test="fill-error">${this.actionError}</p>` : nothing}
      ${
        read
          ? html`${read.areas.length === 0 ? html`<p>${t("staffing.rota.empty")}</p>` : nothing}
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
                      @add-shift=${(e: CustomEvent<{ personId: string; businessDay: string }>) => {
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
                      @pick-slot=${(e: CustomEvent<{ slot: Slot; anchor: HTMLElement }>) => {
                        this.picked = e.detail.slot;
                        this.#anchor = e.detail.anchor;
                        this.actionError = "";
                      }}
                    ></rota-by-area>`
              }
              <rota-popup
                .heading=${this.picked ? slotHeading(read, this.picked) : ""}
                @rota-popup-close=${this.#popupClosed}
              >
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
              </rota-popup>`
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
