import { QueryController, codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  submitOnEnter,
  ReorderController,
  reorder,
  type ReorderModel,
} from "@waitron/ui";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { RouteTarget, ExceptionInput, RouteException } from "../routing.js";
import { exceptionSentence } from "./exception-sentence.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
} from "./routing-client.js";
import { t } from "./strings.js";

type Editor =
  | { kind: "station"; id?: string }
  | { kind: "claim"; stationId: string | null }
  | { kind: "exception"; id?: string }
  | { kind: "exception_delete"; id: string };
const NO_PREPARATION = "no_preparation";
const targetFor = (id: string): RouteTarget =>
  id === NO_PREPARATION ? { kind: "no_preparation" } : { kind: "station", stationId: id };

@customElement("dashboard-prep-stations-screen")
export class PrepStationsScreen extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
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
      .exception-layout {
        display: grid;
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-4);
      }
      .exception-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
      }
      .exception-table {
        table-layout: fixed;
      }
      .exception-table th:first-child,
      .exception-table td:first-child,
      .exception-table th:last-child,
      .exception-table td:last-child {
        width: var(--wt-tap-min);
      }
      .exception-table td:nth-child(2) {
        overflow-wrap: anywhere;
      }
      .exception-table th:last-child,
      .exception-table td:last-child {
        position: sticky;
        inset-inline-end: 0;
        background: var(--wt-color-surface);
      }
      .warnings .chip {
        border-color: var(--wt-color-warning);
      }
      .warnings {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1);
        margin-top: var(--wt-space-1);
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
  @state() private exceptionOrder: string[] = [];
  @state() private exceptionDraft: ExceptionInput = {
    zoneId: null,
    categoryId: null,
    productId: null,
    target: { kind: "no_preparation" },
  };
  @state() private exceptionTarget = "";
  @state() private exceptionFieldError = "";
  #pointerChanged = false;
  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.exceptionOrder,
      move: (id, to, via) => this.#moveException(id, to, via),
      drop: () => {
        if (this.#pointerChanged) {
          this.#pointerChanged = false;
          void this.#saveExceptionOrder();
        }
      },
      label: (id) => this.#exceptionText(this.view?.routing.exceptions.find((e) => e.id === id)),
      busy: () => this.busy,
      get reorderLabel() {
        return t("prep.reorder_exception");
      },
    } satisfies ReorderModel,
    { announce: () => t("prep.reordered") },
  );
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
          this.exceptionOrder = [...value.routing.exceptions]
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((e) => e.id);
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
  #exceptionText(exception?: RouteException): string {
    if (!exception || !this.view) return "";
    return exceptionSentence(exception, {
      categories: this.view.categories.map((c) => ({ id: c.id, name: this.#path(c.id) })),
      products: this.view.products,
      zones: this.view.zones,
      stations: this.view.routing.stations,
    });
  }
  #moveException(id: string, to: number, via: "key" | "pointer") {
    const next = reorder(this.exceptionOrder, this.exceptionOrder.indexOf(id), to);
    if (next.join() === this.exceptionOrder.join()) return;
    this.exceptionOrder = next;
    if (via === "key") void this.#saveExceptionOrder();
    else this.#pointerChanged = true;
  }
  async #saveExceptionOrder() {
    if (this.busy) return;
    const order = [...this.exceptionOrder];
    this.busy = true;
    this.error = "";
    try {
      await this.api.reorderExceptions(order);
      await this.#load();
    } catch {
      this.exceptionOrder = [...(this.view?.routing.exceptions ?? [])]
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((e) => e.id);
      this.error = t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  #openException(exception?: RouteException) {
    this.exceptionDraft = exception
      ? {
          zoneId: exception.zoneId,
          categoryId: exception.categoryId,
          productId: exception.productId,
          target: exception.target,
        }
      : { zoneId: null, categoryId: null, productId: null, target: { kind: "no_preparation" } };
    this.exceptionTarget = exception
      ? exception.target.kind === "station"
        ? exception.target.stationId
        : NO_PREPARATION
      : "";
    this.exceptionFieldError = "";
    this.error = "";
    this.editor = { kind: "exception", id: exception?.id };
  }
  async #saveException() {
    if (this.busy || this.editor?.kind !== "exception") return;
    const input = this.exceptionDraft;
    if (!input.zoneId && !input.categoryId && !input.productId) {
      this.exceptionFieldError = t("prep.exception_condition");
      this.error = t("prep.fix_fields");
      return;
    }
    if (!this.exceptionTarget) {
      this.error = t("prep.exception_target_required");
      return;
    }
    const id = this.editor.id;
    this.busy = true;
    this.error = "";
    try {
      if (id) await this.api.updateException(id, input);
      else await this.api.createException(input);
      this.editor = undefined;
      await this.#load();
    } catch (e) {
      const field = (e as { params?: { field?: unknown } } | undefined)?.params?.field;
      if (field === "condition") this.exceptionFieldError = t("prep.exception_condition");
      else if (codeOf(e) === "route.station_inactive") this.error = t("prep.station_inactive");
      else this.error = t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  #exceptionTargetOptions() {
    const active = (this.view?.stations ?? [])
      .filter((station) => station.active)
      .map((station) => ({ value: station.id, label: station.name }));
    const selected = this.exceptionTarget;
    const previous =
      selected && selected !== NO_PREPARATION && !active.some((option) => option.value === selected)
        ? [{ value: selected, label: `${this.#stationName(selected)} (${t("prep.switched_off")})` }]
        : [];
    return [...active, ...previous, { value: NO_PREPARATION, label: t("prep.no_preparation") }];
  }
  #exceptionOptions() {
    return [
      { value: "", label: t("prep.everything") },
      ...(this.view?.categories.map((c) => ({
        value: `category:${c.id}`,
        label: this.#path(c.id),
      })) ?? []),
      ...(this.view?.products.map((p) => ({ value: `product:${p.id}`, label: p.name })) ?? []),
    ];
  }
  #exceptions() {
    const byId = new Map(this.view!.routing.exceptions.map((e) => [e.id, e]));
    return html`<wt-card data-test="exceptions" class="exception-layout">
      <div class="exception-head">
        <h2>${t("prep.exceptions")}</h2>
        <wt-button data-test="add-exception" @click=${() => this.#openException()}
          >${t("prep.add_exception")}</wt-button
        >
      </div>
      <div class="table-wrap" tabindex="0">
        <table class="exception-table">
          <thead>
            <tr>
              <th scope="col">
                <span class="visually-hidden">${t("prep.reorder_exception")}</span>
              </th>
              <th scope="col">${t("prep.exception_rule")}</th>
              <th scope="col"><span class="visually-hidden">${t("prep.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.exceptionOrder,
              (id) => id,
              (id) => {
                const e = byId.get(id);
                return e
                  ? html`<tr data-id=${id}>
                      <td class="handle-cell">${this.#reorder.handle(id)}</td>
                      <td>
                        ${this.#exceptionText(e)}
                        <div class="warnings">
                          ${e.neverMatches ? html`<span class="chip">${t("prep.never_used")}</span>` : nothing}${e.stationOff ? html`<span class="chip">${t("prep.exception_station_off")}</span>` : nothing}
                        </div>
                      </td>
                      <td>
                        <wt-row-actions
                          align="end"
                          label=${`${t("prep.actions")}: ${this.#exceptionText(e)}`}
                          ><wt-button
                            data-test=${`edit-exception-${id}`}
                            variant="secondary"
                            @click=${() => this.#openException(e)}
                            >${t("prep.edit")}</wt-button
                          ><wt-button
                            data-test=${`delete-${id}`}
                            variant="danger"
                            @click=${() => {
                              this.editor = { kind: "exception_delete", id };
                              this.error = "";
                            }}
                            >${t("prep.delete")}</wt-button
                          ></wt-row-actions
                        >
                      </td>
                    </tr>`
                  : nothing;
              },
            )}
          </tbody>
        </table>
      </div>
      ${this.#reorder.liveRegion()}
    </wt-card>`;
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
      heading=${editor.kind === "claim" ? t("prep.claim_folder") : editor.kind === "exception_delete" ? t("prep.confirm_delete_exception") : editor.kind === "exception" ? (editor.id ? t("prep.edit_exception") : t("prep.add_exception")) : editor.id ? t("prep.edit_station") : t("prep.new_station")}
      @wt-close=${() => {
        this.editor = undefined;
      }}
      ><div class="form">
        ${
          editor.kind === "exception_delete"
            ? html`<p>
                ${this.#exceptionText(this.view?.routing.exceptions.find((e) => e.id === editor.id))}
              </p>`
            : editor.kind === "exception"
              ? html`<div>
                    <wt-combobox
                      data-test="exception-what"
                      name="what"
                      label=${t("prep.what")}
                      placeholder=${t("prep.everything")}
                      .options=${this.#exceptionOptions()}
                      .value=${this.exceptionDraft.categoryId ? `category:${this.exceptionDraft.categoryId}` : this.exceptionDraft.productId ? `product:${this.exceptionDraft.productId}` : ""}
                      @wt-change=${(e: CustomEvent<{ value: string }>) => {
                        const value = e.detail.value;
                        this.exceptionDraft = {
                          ...this.exceptionDraft,
                          categoryId: value.startsWith("category:") ? value.slice(9) : null,
                          productId: value.startsWith("product:") ? value.slice(8) : null,
                        };
                        this.exceptionFieldError = "";
                        this.error = "";
                      }}
                    ></wt-combobox
                    >${this.exceptionFieldError ? html`<p class="error" role="alert" data-field-error="condition">${this.exceptionFieldError}</p>` : nothing}
                  </div>
                  <wt-combobox
                    data-test="exception-zone"
                    name="zone"
                    label=${t("prep.service_zone")}
                    placeholder=${t("prep.any_zone")}
                    .options=${[{ value: "", label: t("prep.any_zone") }, ...(this.view?.zones.filter((z) => z.active !== false).map((z) => ({ value: z.id, label: z.name })) ?? [])]}
                    .value=${this.exceptionDraft.zoneId ?? ""}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => {
                      this.exceptionDraft = {
                        ...this.exceptionDraft,
                        zoneId: e.detail.value || null,
                      };
                      this.exceptionFieldError = "";
                      this.error = "";
                    }}
                  ></wt-combobox
                  ><wt-combobox
                    data-test="exception-target"
                    name="target"
                    label=${t("prep.made_at")}
                    required
                    .options=${this.#exceptionTargetOptions()}
                    .value=${this.exceptionTarget}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => {
                      this.exceptionTarget = e.detail.value;
                      this.exceptionDraft = {
                        ...this.exceptionDraft,
                        target: targetFor(e.detail.value),
                      };
                      this.error = "";
                    }}
                  ></wt-combobox>`
              : editor.kind === "claim"
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
        >${
          editor.kind === "station"
            ? html`<wt-button
                data-test="save-station"
                ?disabled=${this.busy}
                @click=${() => void this.#saveStation()}
                >${t("prep.save")}</wt-button
              >`
            : editor.kind === "exception"
              ? html`<wt-button
                  data-test="save-exception"
                  ?disabled=${this.busy || !this.exceptionTarget}
                  @click=${() => void this.#saveException()}
                  >${t("prep.save")}</wt-button
                >`
              : editor.kind === "exception_delete"
                ? html`<wt-button
                    data-test="confirm-delete-exception"
                    variant="danger"
                    ?disabled=${this.busy}
                    @click=${() =>
                      void this.#act(() => this.api.deleteException(editor.id)).then(() => {
                        if (!this.error) this.editor = undefined;
                      })}
                    >${t("prep.delete")}</wt-button
                  >`
                : nothing
        }
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
          ? html`${this.#exceptions()}
              <div class="cards">
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
