import { QueryController, codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { RouteTarget } from "../routing.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
} from "./routing-client.js";
import { t } from "./strings.js";

type Editor = { kind: "station"; id?: string } | { kind: "claim"; stationId: string | null };
const NO_PREPARATION = "no_preparation";
const targetFor = (id: string): RouteTarget =>
  id === NO_PREPARATION ? { kind: "no_preparation" } : { kind: "station", stationId: id };

@customElement("dashboard-prep-stations-screen")
export class PrepStationsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin: 0;
      }
      .toolbar,
      .actions,
      .item,
      .chip {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .toolbar {
        justify-content: space-between;
        margin-bottom: var(--wt-space-4);
      }
      .cards,
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      .cards {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--wt-field-max-width)), 1fr));
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .chip {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        padding: var(--wt-space-1) var(--wt-space-2);
      }
      .item {
        justify-content: space-between;
        margin-block: var(--wt-space-2);
      }
      .form {
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: PrepStationsApi;
  @state() private view?: PrepStationsView;
  @state() private editor?: Editor;
  @state() private draft: StationInput = {
    name: "",
    displayOrder: 0,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  };
  @state() private fieldError: Record<string, string> = {};
  @state() private error = "";
  @state() private claimError = "";
  @state() private claimField = "";
  @state() private busy = false;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.error = t("prep.load_error");
    },
  );
  #loaded = false;
  override connectedCallback() {
    super.connectedCallback();
    void this.#load();
  }
  async #load() {
    try {
      let initial = !this.#loaded;
      this.#loaded = true;
      await this.#queries.watch(
        "routing",
        {
          key: "venue-service:routing",
          dependencies: QUERY_DEPENDENCIES.routing.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return api.load();
          },
        },
        (value) => {
          this.view = value;
          this.error = "";
        },
      );
    } catch {
      this.error = t("prep.load_error");
    }
  }
  #path(id: string): string {
    const byId = new Map(this.view?.categories.map((c) => [c.id, c]));
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = byId.get(current);
      if (!row) break;
      names.unshift(row.name);
      current = row.parentId;
    }
    return names.join(" › ") || id;
  }
  #stationName(id: string): string {
    return (
      this.view?.routing.stations.find((s) => s.id === id)?.name ??
      this.view?.stations.find((s) => s.id === id)?.name ??
      id
    );
  }
  #targetName(target: RouteTarget): string {
    return target.kind === "no_preparation"
      ? t("prep.no_preparation")
      : this.#stationName(target.stationId);
  }
  #claimOptions() {
    return (
      this.view?.categories.map((c) => ({
        value: c.id,
        label: `${this.#path(c.id)}${this.view?.routing.claims.find((cl) => cl.categoryId === c.id) ? ` (${this.#targetName(this.view.routing.claims.find((cl) => cl.categoryId === c.id)!.target)})` : ""}`,
      })) ?? []
    );
  }
  #targetOptions() {
    return [
      ...(this.view?.stations ?? []).map((s) => ({ value: s.id, label: s.name })),
      { value: NO_PREPARATION, label: t("prep.no_preparation") },
    ];
  }
  async #act(run: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await run();
      await this.#load();
    } catch {
      this.error = t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  async #assign(field: string, run: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.claimError = "";
    this.claimField = field;
    this.error = "";
    try {
      await run();
      await this.#load();
    } catch (e) {
      if (codeOf(e) === "route.station_inactive") this.claimError = t("prep.station_inactive");
      else this.error = t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  async #setClaim(categoryId: string, target: RouteTarget, field = categoryId) {
    await this.#assign(field, () => this.api.setClaim(categoryId, target));
  }
  #openStation(station?: PrepStation) {
    this.editor = { kind: "station", id: station?.id };
    this.draft = station
      ? {
          name: station.name,
          displayOrder: station.displayOrder,
          warmAfterMinutes: station.warmAfterMinutes,
          overdueAfterMinutes: station.overdueAfterMinutes,
          forgottenAfterMinutes: station.forgottenAfterMinutes,
        }
      : {
          name: "",
          displayOrder: 0,
          warmAfterMinutes: 5,
          overdueAfterMinutes: 10,
          forgottenAfterMinutes: 15,
        };
    this.fieldError = {};
    this.error = "";
  }
  #change(field: keyof StationInput, value: string) {
    this.draft = { ...this.draft, [field]: field === "name" ? value : Number(value) };
    this.fieldError = { ...this.fieldError, [field]: "" };
    this.error = "";
  }
  async #saveStation() {
    const d = this.draft;
    const errors: Record<string, string> = {};
    if (!d.name.trim()) errors.name = t("prep.name_required");
    if (!Number.isInteger(d.displayOrder) || d.displayOrder < 0)
      errors.displayOrder = t("prep.order_invalid");
    if (!Number.isInteger(d.warmAfterMinutes) || d.warmAfterMinutes < 1)
      errors.warmAfterMinutes = t("prep.threshold_invalid");
    if (!Number.isInteger(d.overdueAfterMinutes) || d.overdueAfterMinutes <= d.warmAfterMinutes)
      errors.overdueAfterMinutes = t("prep.threshold_invalid");
    if (
      !Number.isInteger(d.forgottenAfterMinutes) ||
      d.forgottenAfterMinutes <= d.overdueAfterMinutes
    )
      errors.forgottenAfterMinutes = t("prep.threshold_invalid");
    this.fieldError = errors;
    if (Object.keys(errors).length) {
      this.error = t("prep.fix_fields");
      return;
    }
    const id = this.editor?.kind === "station" ? this.editor.id : undefined;
    if (id && !this.view?.stations.some((station) => station.id === id)) return;
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      if (id) await this.api.updateStation(id, d);
      else await this.api.createStation(d);
      this.editor = undefined;
      await this.#load();
    } catch (e) {
      if (codeOf(e) === "station.name_taken") this.fieldError = { name: t("prep.name_taken") };
      else this.error = t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  #claims(stationId: string | null) {
    return (
      this.view?.routing.claims.filter(
        (c) =>
          c.target.kind === (stationId === null ? "no_preparation" : "station") &&
          (stationId === null || (c.target.kind === "station" && c.target.stationId === stationId)),
      ) ?? []
    );
  }
  #chips(stationId: string | null) {
    return html`<p>${t("prep.claims")}</p>
      <div class="actions">
        ${this.#claims(stationId).map((c) => html`<span class="chip">${this.#path(c.categoryId)} <wt-button size="sm" variant="secondary" data-test=${`remove-${c.categoryId}`} aria-label=${`${t("prep.remove_claim")} ${this.#path(c.categoryId)}`} @click=${() => void this.#act(() => this.api.removeClaim(c.categoryId))}>×</wt-button></span>`)}
      </div>`;
  }
  #stationCard(s: PrepStation) {
    const printers = this.view?.stationPrinters
      .filter((p) => p.stationId === s.id)
      .map((p) => this.view!.printers.find((x) => x.id === p.printerId)?.name)
      .filter(Boolean)
      .join(", ");
    const devices = this.view?.devices
      .filter((d) => d.stationId === s.id && d.kind === "kds_station" && d.active)
      .map((d) => d.label)
      .join(", ");
    return html`<wt-card data-test=${`station-${s.id}`}
      ><h2>
        ${s.name} ${s.isDefault ? html`<span class="muted">${t("prep.default")}</span>` : nothing}
      </h2>
      <p>
        ${t("prep.thresholds").replace("{warm}", String(s.warmAfterMinutes)).replace("{overdue}", String(s.overdueAfterMinutes)).replace("{forgotten}", String(s.forgottenAfterMinutes))}
      </p>
      <p>
        ${t("prep.printers")}: ${printers || t("prep.none")}
        <a href="/manage/printing-rules">${t("prep.printing_rules")}</a>
      </p>
      <p>
        ${t("prep.screens")}: ${devices || t("prep.none")}
        <a href="/manage/devices">${t("prep.devices")}</a>
      </p>
      ${this.#chips(s.id)}
      <div class="actions">
        <wt-button
          data-test=${`claim-${s.id}`}
          variant="secondary"
          @click=${() => {
            this.editor = { kind: "claim", stationId: s.id };
            this.error = "";
          }}
          >${t("prep.claim_folder")}</wt-button
        ><wt-button
          data-test=${`edit-${s.id}`}
          variant="secondary"
          @click=${() => this.#openStation(s)}
          >${t("prep.edit")}</wt-button
        >${s.isDefault ? nothing : html`<wt-button data-test=${`default-${s.id}`} variant="secondary" @click=${() => void this.#act(() => this.api.setDefaultStation(s.id))}>${t("prep.make_default")}</wt-button>`}<wt-button
          data-test=${`switch-off-${s.id}`}
          variant="danger"
          @click=${() => void this.#act(() => this.api.deactivateStation(s.id))}
          >${t("prep.switch_off")}</wt-button
        >
      </div></wt-card
    >`;
  }
  #unassigned() {
    const r = this.view!.routing;
    const destination = r.defaultStationId
      ? t("prep.fallback").replace("{name}", this.#stationName(r.defaultStationId))
      : t("venue.readiness.default_station_missing");
    return html`<wt-card data-test="unassigned"
      ><h2>${t("prep.unassigned")}</h2>
      <p>${destination}</p>
      ${r.unassigned.folders.map((f) => html`<div class="item"><span>${this.#path(f.id)}</span><wt-combobox data-test=${`assign-${f.id}`} label=${t("prep.assign_to")} .options=${this.#targetOptions()} @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#setClaim(f.id, targetFor(e.detail.value))}></wt-combobox>${this.claimError && this.claimField === f.id ? html`<p class="error" data-field-error=${f.id} role="alert">${this.claimError}</p>` : nothing}</div>`)}${r.unassigned.products.map((p) => html`<div class="item"><span>${p.name}</span><wt-combobox data-test=${`assign-${p.id}`} label=${t("prep.assign_to")} .options=${this.#targetOptions()} @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#assign(p.id, () => this.api.assignProduct(p.id, targetFor(e.detail.value)))}></wt-combobox>${this.claimError && this.claimField === p.id ? html`<p class="error" data-field-error=${p.id} role="alert">${this.claimError}</p>` : nothing}</div>`)}</wt-card
    >`;
  }
  #field(field: keyof StationInput, label: string, type = "number") {
    return html`<div>
      <wt-input
        data-test=${field === "overdueAfterMinutes" ? "overdue" : field}
        name=${field}
        label=${label}
        type=${type}
        required
        .value=${String(this.draft[field])}
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector("[data-test=save-station]"))}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(field, e.detail.value)}
      ></wt-input
      >${this.fieldError[field] ? html`<p class="error" data-field-error=${field} role="alert">${this.fieldError[field]}</p>` : nothing}
    </div>`;
  }
  #dialog() {
    if (!this.editor) return nothing;
    const editor = this.editor;
    return html`<wt-modal
      open
      heading=${editor.kind === "claim" ? t("prep.claim_folder") : editor.id ? t("prep.edit_station") : t("prep.new_station")}
      @wt-close=${() => {
        this.editor = undefined;
      }}
      ><div class="form">
        ${
          editor.kind === "claim"
            ? html`<wt-combobox
                  data-test="claim-choice"
                  label=${t("prep.folder")}
                  .options=${this.#claimOptions()}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => {
                    const id = e.detail.value;
                    void this.#setClaim(
                      id,
                      targetFor(editor.stationId ?? NO_PREPARATION),
                      "claim",
                    ).then(() => {
                      if (!this.error && !this.claimError) this.editor = undefined;
                    });
                  }}
                ></wt-combobox
                >${this.claimError && this.claimField === "claim" ? html`<p class="error" data-field-error="claim" role="alert">${this.claimError}</p>` : nothing}`
            : html`${this.#field("name", t("prep.name"), "text")}${this.#field("displayOrder", t("prep.order"))}${this.#field("warmAfterMinutes", t("prep.warm"))}${this.#field("overdueAfterMinutes", t("prep.overdue"))}${this.#field("forgottenAfterMinutes", t("prep.forgotten"))}`
        }
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          @click=${() => {
            this.editor = undefined;
          }}
          >${t("prep.cancel")}</wt-button
        >${editor.kind === "station" ? html`<wt-button data-test="save-station" ?disabled=${this.busy} @click=${() => void this.#saveStation()}>${t("prep.save")}</wt-button>` : nothing}
      </wt-form-actions></wt-modal
    >`;
  }
  override render() {
    const view = this.view;
    const active =
      view?.stations
        .filter((s) => s.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)) ?? [];
    const off = view?.routing.claims.filter((c) => c.stationOff) ?? [];
    return html`<div class="toolbar">
        <h1>${t("prep.title")}</h1>
        <wt-button @click=${() => this.#openStation()} data-test="new-station"
          >${t("prep.new_station")}</wt-button
        >
      </div>
      ${
        view
          ? html`<div class="cards">
                ${active.map((s) => this.#stationCard(s))}<wt-card data-test="no-preparation"
                  ><h2>${t("prep.no_preparation")}</h2>
                  ${this.#chips(null)}<wt-button
                    variant="secondary"
                    data-test="claim-no-preparation"
                    @click=${() => {
                      this.editor = { kind: "claim", stationId: null };
                    }}
                    >${t("prep.claim_folder")}</wt-button
                  ></wt-card
                >${this.#unassigned()}
              </div>
              ${off.length ? html`<p>${t("prep.switched_off")}: ${off.map((c) => html`${this.#path(c.categoryId)} — ${this.#targetName(c.target)}. ${t("prep.switched_off_hint")}`)}</p>` : nothing}`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.#dialog()}`;
  }
}
