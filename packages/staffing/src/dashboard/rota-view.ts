import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import { areaKey, type Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { dateLabel } from "./format.js";
import { hours } from "./rota-format.js";
import { t, tf } from "./strings.js";
import "./rota-by-area.js";
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
        font-weight: var(--wt-font-weight-semibold);
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
  @state() private busy = false;
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
  override render() {
    const read = this.read?.week === this.week ? this.read : undefined;
    const chosen = read?.areas.find((a) => areaKey(a.area) === this.params.area) ?? read?.areas[0];
    const matches = chosen
      ? read!.days.flatMap((d) =>
          d.areas.filter((a) => areaKey(a.area) === areaKey(chosen.area)).map((a) => a.match),
        )
      : [];
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
        ${read ? html`<wt-combobox name="area" label=${t("staffing.rota.area")} .value=${chosen ? areaKey(chosen.area) : ""} .options=${read.areas.map((a) => ({ value: areaKey(a.area), label: a.name }))} @wt-change=${(e: CustomEvent<{ value: string }>) => this.#go(this.week, e.detail.value)}></wt-combobox><span data-test="attention" role="status">${tf("staffing.rota.attention", { unfilled: String(slots.filter((s) => s.status.kind === "unfilled").length), partly: String(slots.filter((s) => s.status.kind === "partly_uncovered").length), over: String(matches.reduce((n, m) => n + m.over.length, 0)) })}</span><span class="status">${t(read.version?.status === "published" ? "staffing.rota.published" : "staffing.rota.draft")}${read.version?.changedSincePublished ? ` · ${t("staffing.rota.changed")}` : ""}</span>` : nothing}
      </div>
      ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${this.loadError}</p>` : nothing}
      ${
        read
          ? html`<div class="layout">
              <div class="grid">
                ${
                  chosen
                    ? html`<rota-by-area
                        .week=${read}
                        .area=${chosen.area}
                        .editable=${this.canWrite && read.version?.status !== "published" && !this.busy}
                        @pick-slot=${(e: CustomEvent<{ slot: Slot }>) => {
                          this.picked = e.detail.slot;
                          this.actionError = "";
                        }}
                      ></rota-by-area>`
                    : html`<p>${t("staffing.rota.empty")}</p>`
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
                          ></span
                        ><span>${hours(p)}</span>
                      </li>`,
                  )}
                </ul>
                ${
                  this.picked
                    ? html`<slot-picker
                        .week=${read}
                        .pickedSlot=${this.picked}
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
      }`;
  }
}
