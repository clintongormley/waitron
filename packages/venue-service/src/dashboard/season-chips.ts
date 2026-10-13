import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { OpeningHoursApi, SeasonDeleteImpact, SeasonInput } from "./opening-hours-client.js";
import { format, formatMonthDay } from "./hours-view.js";
import type { SeasonChip, SeasonDialog } from "./season-dialog.js";
import "./season-dialog.js";
import { byStart } from "../season-rules.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

export type { SeasonChip } from "./season-dialog.js";
export type SeasonWrites = Pick<
  OpeningHoursApi,
  "saveSeason" | "addSeason" | "deleteSeason" | "readSeasonDeleteImpact"
>;
type Refusal = { code: string; params?: Record<string, unknown> };
/** One opening of the dialog: the season it edits, or none for "+ Season", and the clock revision its
 *  writes send, so a newer read arriving mid-edit still lets the server see the clock changed. */
type Opening = { season?: SeasonChip; clockRevision: number; returnTo: HTMLElement | null };

const refusalOf = (error: unknown): Refusal => ({
  code: codeOf(error),
  params:
    typeof error === "object" && error !== null
      ? (error as { params?: Record<string, unknown> }).params
      : undefined,
});

/** The venue's seasons as tinted chips. A chip's name asks for its week (`season-week-open`), also
 *  when read-only; its ✎ and "+ Season" open the season dialog, whose writes this element sends itself, announcing each
 *  with `season-changed` so its host re-reads. */
@customElement("season-chips")
export class SeasonChips extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .label {
        color: var(--wt-color-text-muted);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid;
        border-radius: var(--wt-radius-full);
        font: inherit;
      }
      .chip button {
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .chip button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .chip[data-tint] {
        background: var(--season-tint);
        color: var(--season-on-tint);
        border-color: var(--season-tint-line);
      }
    `,
  ];
  /** Each season with its last day as the server reads it, so 29 February in a leap year. */
  @property({ attribute: false }) seasons: readonly SeasonChip[] = [];
  /** The clock revision the shown seasons were read at; a write sends the one its dialog opened at. */
  @property({ type: Number }) clockRevision = 0;
  @property({ attribute: false }) api?: SeasonWrites;
  /** Special days by id, so an end-offset refusal can name one. */
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ type: Boolean }) readOnly = false;
  @state() private opening?: Opening;
  @state() private pending: "save" | "impact" | "delete" | "" = "";
  @state() private impactFailed = false;
  @state() private refusal?: Refusal;
  @state() private impact?: SeasonDeleteImpact;
  /** The newest request, so only it clears `pending`. */
  private latestRequest = {};

  override disconnectedCallback() {
    this.opening = undefined;
    this.pending = "";
    super.disconnectedCallback();
  }
  private open(season: SeasonChip | undefined, event: Event) {
    if (this.readOnly || this.pending || this.opening || !this.api) return;
    this.refusal = undefined;
    this.impact = undefined;
    this.opening = {
      season,
      clockRevision: this.clockRevision,
      returnTo: event.currentTarget as HTMLElement,
    };
    this.dispatchEvent(new CustomEvent("season-dialog-open", { bubbles: true, composed: true }));
  }
  private openWeek(season: SeasonChip) {
    this.dispatchEvent(
      new CustomEvent<{ seasonId: string }>("season-week-open", {
        detail: { seasonId: season.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private close(opening: Opening) {
    if (this.opening !== opening) return;
    this.opening = undefined;
    this.impact = undefined;
    this.refusal = undefined;
    this.impactFailed = false;
    void this.updateComplete.then(() => opening.returnTo?.focus());
  }
  /** Runs one request for `opening`, keeping a refusal on the dialog; the result once it is still current. */
  private async run<T>(
    opening: Opening,
    pending: "save" | "impact" | "delete",
    request: () => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    const sent = (this.latestRequest = {});
    this.pending = pending;
    this.refusal = undefined;
    this.impactFailed = false;
    try {
      return { value: await request() };
    } catch (error) {
      if (this.opening === opening) {
        if (pending === "impact") this.impactFailed = true;
        else this.refusal = refusalOf(error);
      }
      return undefined;
    } finally {
      if (this.latestRequest === sent) this.pending = "";
    }
  }
  private async written(
    opening: Opening,
    pending: "save" | "delete",
    request: () => Promise<unknown>,
  ) {
    const done = await this.run(opening, pending, request);
    if (!done || this.opening !== opening || !this.isConnected) return;
    this.close(opening);
    this.dispatchEvent(new CustomEvent("season-changed", { bubbles: true, composed: true }));
  }
  private async onSave(event: CustomEvent<{ id: string | null; input: SeasonInput }>) {
    event.stopPropagation();
    const opening = this.opening;
    const api = this.api;
    if (!opening || !api || this.pending) return;
    const { id, input } = event.detail;
    const revision = opening.clockRevision;
    await this.written(opening, "save", () =>
      id === null ? api.addSeason(input, revision) : api.saveSeason(id, input, revision),
    );
  }
  private async onDelete(event: CustomEvent<{ id: string }>) {
    event.stopPropagation();
    const opening = this.opening;
    const api = this.api;
    if (!opening || !api || this.pending) return;
    const done = await this.run(opening, "impact", () =>
      api.readSeasonDeleteImpact(event.detail.id),
    );
    if (done && this.opening === opening) this.impact = done.value;
  }
  private async onConfirmDelete(event: CustomEvent<{ id: string }>) {
    event.stopPropagation();
    const opening = this.opening;
    const api = this.api;
    if (!opening || !api || this.pending || !this.impact) return;
    const revision = opening.clockRevision;
    await this.written(opening, "delete", () => api.deleteSeason(event.detail.id, revision));
  }
  private dialog() {
    const opening = this.opening;
    if (!opening) return nothing;
    return keyed(
      opening,
      html`<season-dialog
        .open=${true}
        .season=${opening.season}
        .seasons=${this.seasons}
        .specialDays=${this.specialDays}
        .pending=${this.pending}
        .impactFailed=${this.impactFailed}
        .refusal=${this.refusal}
        .confirmDelete=${this.impact}
        @season-save=${this.onSave}
        @season-delete=${this.onDelete}
        @season-delete-confirm=${this.onConfirmDelete}
        @season-delete-cancel=${(event: Event) => {
          event.stopPropagation();
          if (this.opening === opening && !this.pending) {
            this.impact = undefined;
            this.refusal = undefined;
          }
        }}
        @season-close=${(event: Event) => {
          event.stopPropagation();
          if (event.currentTarget === this.shadowRoot?.querySelector<SeasonDialog>("season-dialog"))
            this.close(opening);
        }}
      ></season-dialog>`,
    );
  }
  override render() {
    const tints = seasonTints(this.seasons);
    return html`<div class="row">
        <span class="label">${t("season.seasons")}</span>
        ${byStart(this.seasons).map((season) => {
          const range = {
            from: formatMonthDay(season.startsOn),
            to: formatMonthDay(season.lastDay),
          };
          const label = format("season.chip", { name: season.name, ...range });
          const tint = tints.get(season.id);
          const week = html`<button
            type="button"
            data-test="season-week"
            aria-label=${format(this.readOnly ? "season.week_shown" : "season.week_named", {
              name: season.name,
              ...range,
            })}
            @click=${() => this.openWeek(season)}
          >
            ${label}
          </button>`;
          return this.readOnly
            ? html`<span class="chip" data-season=${season.id} data-tint=${tint}>${week}</span>`
            : html`<span class="chip" data-season=${season.id} data-tint=${tint}
                >${week}
                <button
                  type="button"
                  data-test="season-edit"
                  aria-label=${format("season.edit_named", { name: season.name, ...range })}
                  @click=${(event: Event) => this.open(season, event)}
                >
                  ✎
                </button></span
              >`;
        })}
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                data-test="add-season"
                variant="secondary"
                @click=${(event: Event) => this.open(undefined, event)}
                >${t("season.add")}</wt-button
              >`
        }
      </div>
      ${this.dialog()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "season-chips": SeasonChips;
  }
}
