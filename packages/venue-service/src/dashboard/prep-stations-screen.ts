import { QueryController, codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  submitOnEnter,
  ReorderController,
  reorder,
  UrlStateController,
  type ReorderModel,
} from "@waitron/ui";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import type {
  RouteTarget,
  ExceptionInput,
  RouteException,
  RoutingDecision,
  RouteExplanation,
} from "../routing.js";
import type { RoutingChange, RoutingMove, StationTimes } from "../routing-types.js";
import type { WeeklyInterval } from "../routing.js";
import { exceptionSentence } from "./exception-sentence.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
  OutputsDown,
  WatcherInput,
} from "./routing-client.js";
import { watchersOfStation, watchersSeeing, type WatcherView } from "./watchers-seen.js";
import { t } from "./strings.js";
import "./station-hours-form.js";
import "./watcher-form.js";

type StationAction =
  | { kind: "today"; stationId: string; state: "open" | "closed" | null }
  | { kind: "hours"; stationId: string }
  | { kind: "fallback" | "switch_off"; stationId: string; choice: string; confirming: boolean }
  | { kind: "switch_on"; stationId: string };
const format = (key: Parameters<typeof t>[0], values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    t(key) as string,
  );

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
      .tester-when {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-2);
      }
      .tester-when label {
        display: grid;
        gap: var(--wt-space-1);
      }
      .tester-when wt-combobox {
        min-height: var(--wt-tap-min);
      }
      .tester-when wt-input {
        min-height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        padding-inline: var(--wt-space-2);
        font: inherit;
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
      .warning {
        color: var(--wt-color-warning);
      }
    `,
  ];
  @property({ attribute: false }) api!: PrepStationsApi;
  @state() private view?: PrepStationsView;
  @state() private editor?: Editor;
  @state() private watcherEditor?: { id?: string };
  @state() private watcherRemoval?: WatcherView;
  @state() private watcherRefusal?: { code: string; params?: { field?: string } };
  @state() private watcherRemoveError = "";
  @state() private draft: StationInput = {
    name: "",
    displayOrder: 0,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  };
  @state() private fieldError: Record<string, string> = {};
  @state() private error = "";
  /** Whether `error` is a read's failure, the only message a read's success may clear. */
  #readErrorShown = false;
  @state() private claimError = "";
  @state() private claimField = "";
  @state() private busy = false;
  @state() private stationSwitchBusy = new Map<string, boolean>();
  @state() private stationSwitchError: Record<string, { field: boolean; message: string }> = {};
  @state() private exceptionOrder: string[] = [];
  @state() private exceptionDraft: ExceptionInput = {
    zoneId: null,
    categoryId: null,
    productId: null,
    target: { kind: "no_preparation" },
  };
  @state() private exceptionTarget = "";
  @state() private exceptionFieldError = "";
  @state() private assignmentChoiceKey = 0;
  @state() private testProduct = "";
  @state() private testExtras: string[] = [];
  @state() private testZone = "";
  @state() private testWhen = "now";
  @state() private testWeekday = 0;
  @state() private testTime = "12:00";
  @state() private explanation?: RouteExplanation;
  @state() private testError = "";
  @state() private stationAction?: StationAction;
  @state() private stationActionError = "";
  @state() private stationFieldError = "";
  private editingHours: readonly WeeklyInterval[] = [];
  @state() private hoursServerErrors: Record<number, string> = {};
  @state() private outputsDown: OutputsDown = { printersDown: [], screensDark: [] };
  #outputsTimer?: ReturnType<typeof setInterval>;
  #testRequest = 0;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "prep-stations") return;
      this.testProduct = this.#url.read("test") ?? "";
      void this.#explain();
    },
    { basePath: "/manage", primary: "dashboard", children: { "*": { test: "test" } } },
  );
  @state() private pending?: {
    change: RoutingChange;
    moves: RoutingMove[];
    save: () => Promise<unknown>;
    closeEditor: boolean;
    field?: string;
  };
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
    () => this.#showReadError(t("prep.load_error")),
  );
  #loaded = false;
  #showError(message: string, fromRead = false): void {
    this.error = message;
    this.#readErrorShown = fromRead;
  }
  /** A read's failure never replaces an action's message. */
  #showReadError(message: string): void {
    if (this.error === "" || this.#readErrorShown) this.#showError(message, true);
  }
  override connectedCallback() {
    super.connectedCallback();
    void this.#load();
    void this.#loadOutputs();
    this.#outputsTimer = setInterval(() => void this.#loadOutputs(), 60_000);
  }
  override disconnectedCallback() {
    if (this.#outputsTimer) clearInterval(this.#outputsTimer);
    super.disconnectedCallback();
  }
  async #loadOutputs() {
    try {
      this.outputsDown = await this.api.listOutputsDown();
    } catch {
      // The card's last observed output status remains until a later passive read succeeds.
    }
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
          if (this.#readErrorShown) this.#showError("");
          if (this.testProduct) void this.#explain();
        },
      );
    } catch {
      this.#showReadError(t("prep.load_error"));
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
    this.#showError("");
    try {
      await run();
      await this.#load();
    } catch {
      this.#showError(t("prep.save_error"));
    } finally {
      this.busy = false;
    }
  }
  async #preview(
    change: RoutingChange,
    save: () => Promise<unknown>,
    closeEditor = false,
    field?: string,
  ) {
    if (this.busy || this.pending) return;
    this.busy = true;
    this.#showError("");
    this.claimError = "";
    try {
      const moves = await this.api.preview(change);
      this.pending = { change, moves, save, closeEditor, field };
    } catch (e) {
      const rejectedField = (e as { params?: { field?: unknown } } | undefined)?.params?.field;
      if (rejectedField === "condition") this.exceptionFieldError = t("prep.exception_condition");
      else if (codeOf(e) === "route.station_inactive" && field) {
        this.claimField = field;
        this.claimError = t("prep.station_inactive");
      } else if (codeOf(e) === "route.station_inactive")
        this.#showError(t("prep.station_inactive"));
      else this.#showError(t("prep.save_error"));
      this.#restoreOrder();
    } finally {
      this.busy = false;
    }
  }
  #restoreOrder() {
    this.exceptionOrder = [...(this.view?.routing.exceptions ?? [])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((e) => e.id);
  }
  async #confirmRouting() {
    const pending = this.pending;
    if (!pending || this.busy) return;
    this.busy = true;
    try {
      await pending.save();
      this.pending = undefined;
      if (pending.closeEditor) this.editor = undefined;
      await this.#load();
    } catch (e) {
      const rejectedField = (e as { params?: { field?: unknown } } | undefined)?.params?.field;
      if (rejectedField === "condition") this.exceptionFieldError = t("prep.exception_condition");
      else if (codeOf(e) === "route.station_inactive" && pending.field) {
        this.claimField = pending.field;
        this.claimError = t("prep.station_inactive");
      } else if (codeOf(e) === "route.station_inactive") {
        this.#showError(t("prep.station_inactive"));
      } else this.#showError(t("prep.save_error"));
      this.pending = undefined;
      this.#restoreOrder();
    } finally {
      this.busy = false;
    }
  }
  #cancelRouting() {
    if (this.busy) return;
    this.pending = undefined;
    this.#restoreOrder();
    this.assignmentChoiceKey++;
  }
  async #setClaim(categoryId: string, target: RouteTarget, field = categoryId) {
    await this.#preview(
      { kind: "claim", categoryId, target },
      () => this.api.setClaim(categoryId, target),
      field === "claim",
      field,
    );
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
    this.#showError("");
  }
  #change(field: keyof StationInput, value: string) {
    this.draft = { ...this.draft, [field]: field === "name" ? value : Number(value) };
    this.fieldError = { ...this.fieldError, [field]: "" };
    this.#showError("");
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
      this.#showError(t("prep.fix_fields"));
      return;
    }
    const id = this.editor?.kind === "station" ? this.editor.id : undefined;
    if (id && !this.view?.stations.some((station) => station.id === id)) return;
    if (this.busy) return;
    this.busy = true;
    this.#showError("");
    try {
      if (id) await this.api.updateStation(id, d);
      else await this.api.createStation(d);
      this.editor = undefined;
      await this.#load();
    } catch (e) {
      if (codeOf(e) === "station.name_taken") this.fieldError = { name: t("prep.name_taken") };
      else this.#showError(t("prep.save_error"));
    } finally {
      this.busy = false;
    }
  }
  async #saveRestOfOrder(station: PrepStation, checked: boolean) {
    if (this.stationSwitchBusy.has(station.id)) return;
    this.stationSwitchBusy = new Map([...this.stationSwitchBusy, [station.id, checked]]);
    const remaining = { ...this.stationSwitchError };
    delete remaining[station.id];
    this.stationSwitchError = remaining;
    try {
      await this.api.updateStation(station.id, { showsRestOfOrder: checked });
      await this.#load();
    } catch (error) {
      const field = (error as { params?: { field?: unknown } } | undefined)?.params?.field;
      this.stationSwitchError = {
        ...this.stationSwitchError,
        [station.id]: {
          field: codeOf(error) === "management.request_invalid" && field === "showsRestOfOrder",
          message: t("prep.save_error"),
        },
      };
    } finally {
      const busy = new Map(this.stationSwitchBusy);
      busy.delete(station.id);
      this.stationSwitchBusy = busy;
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
  async #explain() {
    const request = ++this.#testRequest;
    this.explanation = undefined;
    this.testError = "";
    if (!this.testProduct || (this.testWhen === "at" && !this.testTime)) return;
    try {
      const explanation =
        this.testWhen === "now"
          ? this.testExtras.length
            ? await this.api.explain(
                this.testProduct,
                this.testZone || null,
                undefined,
                this.testExtras,
              )
            : await this.api.explain(this.testProduct, this.testZone || null)
          : this.testExtras.length
            ? await this.api.explain(
                this.testProduct,
                this.testZone || null,
                {
                  weekday: this.testWeekday,
                  timeOfDay: this.testTime,
                },
                this.testExtras,
              )
            : await this.api.explain(this.testProduct, this.testZone || null, {
                weekday: this.testWeekday,
                timeOfDay: this.testTime,
              });
      if (request === this.#testRequest) this.explanation = explanation;
    } catch {
      if (request === this.#testRequest) this.testError = t("prep.test_error");
    }
  }
  #testStationName(id: string): string {
    return (
      this.explanation?.stations.find((station) => station.id === id)?.name ?? this.#stationName(id)
    );
  }
  #testRule(decision: RoutingDecision): string {
    if (decision.kind === "default") return t("prep.test_default");
    if (decision.kind === "claim") {
      const folder = this.#path(decision.categoryId).split(" › ").at(-1)!;
      if (this.explanation?.route?.kind === "no_preparation")
        return t("prep.test_no_prep_claim")
          .replace("{folder}", folder)
          .replace("{target}", t("prep.no_preparation"));
      const claimed =
        this.explanation?.fallbacks[0]?.stationId ??
        (this.explanation?.route?.kind === "station" ? this.explanation.route.stationId : null);
      const name = claimed === null ? t("prep.no_preparation") : this.#testStationName(claimed);
      return t("prep.test_claim").replace("{station}", name).replace("{folder}", folder);
    }
    const exception = this.view?.routing.exceptions.find((row) => row.id === decision.exceptionId);
    return t("prep.test_exception").replace("{rule}", this.#exceptionText(exception));
  }
  #testFallback(step: RouteExplanation["fallbacks"][number], index: number): string {
    const explanation = this.explanation!;
    const reason = format(`prep.test_${step.why}`, {
      station: this.#testStationName(step.stationId),
    });
    const next = explanation.fallbacks[index + 1]?.stationId;
    if (next === undefined && explanation.noReplacement)
      return format("prep.test_no_replacement", { reason });
    const destination =
      next ?? (explanation.route?.kind === "station" ? explanation.route.stationId : "");
    return format("prep.test_fallback_step", {
      reason,
      destination: this.#testStationName(destination),
    });
  }
  #extraSentence(extra: RouteExplanation["extras"][number]): string {
    const name =
      this.view?.testProducts.find((product) => product.id === extra.productId)?.name ??
      extra.productId;
    const outcome = extra.outcome;
    if (outcome.kind === "follows_dish") {
      const station = extra.fallbacks[0] ? this.#testStationName(extra.fallbacks[0].stationId) : "";
      return format(`prep.test_extra_${outcome.why}`, {
        name,
        station,
        dishStation:
          this.explanation?.route?.kind === "station"
            ? this.#testStationName(this.explanation.route.stationId)
            : "",
      });
    }
    const decision = extra.decidedBy;
    const reason =
      decision?.kind === "claim"
        ? format("prep.test_extra_claim", {
            station: this.#testStationName(extra.fallbacks[0]?.stationId ?? outcome.stationId),
            folder: this.#path(decision.categoryId),
          })
        : decision?.kind === "exception"
          ? format("prep.test_extra_exception", {
              rule: this.#exceptionText(
                this.view?.routing.exceptions.find((row) => row.id === decision.exceptionId),
              ),
            })
          : t("prep.test_default");
    const fallbacks = extra.fallbacks
      .map((step, index) =>
        format("prep.test_fallback_step", {
          reason: format(`prep.test_${step.why}`, {
            station: this.#testStationName(step.stationId),
          }),
          destination: this.#testStationName(
            extra.fallbacks[index + 1]?.stationId ?? outcome.stationId,
          ),
        }),
      )
      .join(" ");
    return `${fallbacks}${fallbacks ? " " : ""}${format("prep.test_extra_made", { name, station: this.#testStationName(outcome.stationId), reason })}`;
  }
  #tester() {
    const explanation = this.explanation;
    return html`<wt-card data-test="route-tester">
      <h2>${t("prep.test_title")}</h2>
      <div class="form">
        <wt-combobox
          data-test="test-product"
          name="product"
          label=${t("prep.test_product")}
          placeholder=${t("prep.test_choose_product")}
          .value=${this.testProduct}
          .options=${this.view?.testProducts.map((product) => ({ value: product.id, label: product.name })) ?? []}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.testProduct = event.detail.value;
            this.#url.write({ dashboard: "prep-stations", test: this.testProduct || null });
            void this.#explain();
          }}
        ></wt-combobox>
        <div>
          <wt-combobox
            data-test="test-extra"
            name="extra"
            label=${t("prep.test_extras_chosen")}
            placeholder=${t("prep.test_choose_extra")}
            .value=${""}
            .options=${this.view?.testProducts.filter((product) => !this.testExtras.includes(product.id)).map((product) => ({ value: product.id, label: product.name })) ?? []}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              const id = event.detail.value;
              if (id && !this.testExtras.includes(id)) {
                this.testExtras = [...this.testExtras, id];
                void this.#explain();
              }
            }}
          ></wt-combobox>
          <div class="item">
            ${this.testExtras.map(
              (id) =>
                html`<span class="chip"
                  >${this.view?.testProducts.find((product) => product.id === id)?.name ?? id}
                  <wt-button
                    size="sm"
                    variant="secondary"
                    data-test=${`remove-extra-${id}`}
                    aria-label=${format("prep.test_remove_extra", { name: this.view?.testProducts.find((product) => product.id === id)?.name ?? id })}
                    @click=${() => {
                      this.testExtras = this.testExtras.filter((extraId) => extraId !== id);
                      void this.#explain();
                    }}
                    >×</wt-button
                  ></span
                >`,
            )}
          </div>
        </div>
        <wt-combobox
          data-test="test-zone"
          name="zone"
          label=${t("prep.service_zone")}
          placeholder=${t("prep.test_no_zone")}
          .value=${this.testZone}
          .options=${[{ value: "", label: t("prep.test_no_zone") }, ...(this.view?.zones.filter((zone) => zone.active !== false).map((zone) => ({ value: zone.id, label: zone.name })) ?? [])]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.testZone = event.detail.value;
            void this.#explain();
          }}
        ></wt-combobox>
      </div>
      <div class="tester-when">
        <wt-combobox
          name="when"
          data-test="test-when"
          label=${t("prep.test_when")}
          .value=${this.testWhen}
          .options=${[
            { value: "now", label: t("prep.test_now") },
            { value: "at", label: t("prep.test_at") },
          ]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.testWhen = event.detail.value;
            void this.#explain();
          }}
        >
        </wt-combobox>
        ${
          this.testWhen === "at"
            ? html`
                <wt-combobox
                  name="weekday"
                  data-test="test-weekday"
                  label=${t("prep.weekday")}
                  .value=${String(this.testWeekday)}
                  .options=${[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: t(`venue.day.${day}` as "venue.day.0") }))}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    this.testWeekday = Number(event.detail.value);
                    void this.#explain();
                  }}
                >
                </wt-combobox>
                <div>
                  <wt-input
                    name="time"
                    data-test="test-time"
                    type="time"
                    label=${t("prep.test_time")}
                    required
                    .value=${live(this.testTime)}
                    aria-invalid=${!this.testTime}
                    .invalid=${!this.testTime}
                    aria-describedby="test-time-error"
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      this.testTime = event.detail.value;
                      void this.#explain();
                    }}
                  ></wt-input>
                  <span id="test-time-error" class="error"
                    >${!this.testTime ? t("prep.test_time_required") : nothing}</span
                  >
                </div>
              `
            : nothing
        }
      </div>
      <div data-test="test-answer" aria-live="polite">
        ${this.testError ? html`<p class="error" role="alert">${this.testError}</p>` : nothing}
        ${explanation?.clockReadable === false ? html`<p>${t("prep.test_clock_unreadable")}</p>` : nothing}
        ${explanation?.fallbacks.map((step, index) => html`<p>${this.#testFallback(step, index)}</p>`)}
        ${explanation?.route === null && explanation.decidedBy === null ? html`<p>${t("prep.test_no_route")}</p>` : nothing}
        ${explanation?.route ? html`<p>${t("prep.test_made_at")}: ${explanation.route.kind === "station" ? this.#testStationName(explanation.route.stationId) : t("prep.no_preparation")}</p>` : nothing}
        ${
          explanation?.route?.kind === "station"
            ? (() => {
                const watching = watchersSeeing(
                  this.view?.watchers ?? [],
                  explanation.route.stationId,
                  this.testZone || null,
                );
                return html`<p>
                  ${watching.length ? format("watchers.watched_by", { list: watching.map((watcher) => watcher.name).join(", ") }) : t("watchers.none_follow")}
                </p>`;
              })()
            : nothing
        }
        ${explanation?.decidedBy ? html`<p>${t("prep.test_because")}: ${this.#testRule(explanation.decidedBy)}</p>` : nothing}
        ${explanation?.extrasWaitOnDish && this.testExtras.length ? html`<p>${t("prep.test_extras_wait")}</p>` : nothing}
        ${explanation?.extras?.map((extra) => html`<p>${this.#extraSentence(extra)}</p>`)}
      </div>
    </wt-card>`;
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
    await this.#preview({ kind: "exception_order", ids: order }, () =>
      this.api.reorderExceptions(order),
    );
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
    this.#showError("");
    this.editor = { kind: "exception", id: exception?.id };
  }
  async #saveException() {
    if (this.busy || this.editor?.kind !== "exception") return;
    const input = this.exceptionDraft;
    if (!input.zoneId && !input.categoryId && !input.productId) {
      this.exceptionFieldError = t("prep.exception_condition");
      this.#showError(t("prep.fix_fields"));
      return;
    }
    if (!this.exceptionTarget) {
      this.#showError(t("prep.exception_target_required"));
      return;
    }
    const id = this.editor.id;
    await this.#preview(
      { kind: "exception", id: id ?? null, input },
      () => (id ? this.api.updateException(id, input) : this.api.createException(input)),
      true,
    );
  }
  #exceptionTargetOptions() {
    const active = (this.view?.stations ?? [])
      .filter((station) => station.active)
      .map((station) => ({ value: station.id, label: station.name }));
    const selected = this.exceptionTarget;
    const previous =
      selected && selected !== NO_PREPARATION && !active.some((option) => option.value === selected)
        ? [
            {
              value: selected,
              label: `${this.#stationName(selected)} (${t("prep.inactive_station_label")})`,
            },
          ]
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
                              this.#showError("");
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
        ${this.#claims(stationId).map((c) => html`<span class="chip">${this.#path(c.categoryId)} <wt-button size="sm" variant="secondary" data-test=${`remove-${c.categoryId}`} aria-label=${`${t("prep.remove_claim")} ${this.#path(c.categoryId)}`} @click=${() => void this.#preview({ kind: "claim", categoryId: c.categoryId, target: null }, () => this.api.removeClaim(c.categoryId))}>×</wt-button></span>`)}
      </div>`;
  }
  #times(id: string): StationTimes | undefined {
    return this.view?.routing.stationTimes.find((row) => row.stationId === id);
  }
  #destination(id: string | null): string {
    return id
      ? format("prep.work_goes_to", { station: this.#stationName(id) })
      : t("prep.no_replacement_ask");
  }
  #todayEnd() {
    const end = this.view?.routing.todayEnds;
    return { time: end?.timeOfDay ?? "", day: t(end?.tomorrow ? "prep.tomorrow" : "prep.today") };
  }
  #stationStatus(s: PrepStation) {
    const row = this.#times(s.id);
    if (!row) return nothing;
    if (!this.view?.routing.clockReadable) return t("prep.clock_unreadable");
    if (s.isDefault) return t("prep.always_open_default");
    const destination = this.#destination(row.closedSendsTo);
    const end = this.#todayEnd();
    if (row.status.why === "opened_by_hand") return format("prep.opened_by_hand", end);
    if (row.status.why === "closed_by_hand")
      return format("prep.closed_by_hand", { ...end, destination });
    if (row.status.open) return t("prep.open_now");
    return format("prep.closed_hours", { destination });
  }
  #hoursSummary(hours: readonly WeeklyInterval[]) {
    if (!hours.length) return t("prep.always_open");
    return hours
      .map(
        (row) =>
          `${t(`venue.day.${row.weekday}` as "venue.day.0")} ${row.opensAt}–${row.closesAt}${row.closesAt < row.opensAt ? ` ${t("prep.next_day")}` : ""}`,
      )
      .join(", ");
  }
  #fallbackOptions(id: string) {
    const stored = this.#times(id)?.fallbackStationId;
    const stations = this.view?.routing.stations ?? [];
    return [
      { value: "", label: t("prep.no_replacement_choice") },
      ...stations
        .filter((row) => row.id !== id && (row.active || row.id === stored))
        .map((row) => ({
          value: row.id,
          label: row.active ? row.name : `${row.name} ${t("prep.switched_off_option")}`,
        })),
    ];
  }
  #openStationAction(action: StationAction) {
    if (this.busy) return;
    if (action.kind === "hours")
      this.editingHours = (this.#times(action.stationId)?.hours ?? []).map((row) => ({ ...row }));
    this.stationAction = action;
    this.stationActionError = "";
    this.stationFieldError = "";
    this.hoursServerErrors = {};
  }
  #cancelStationAction() {
    if (!this.busy) this.stationAction = undefined;
  }
  #openFallback(id: string, kind: "fallback" | "switch_off") {
    const fallback = this.#times(id)?.fallbackStationId;
    const active = this.view?.routing.stations.find((row) => row.id === fallback)?.active;
    this.#openStationAction({
      kind,
      stationId: id,
      choice: fallback && (active || kind === "fallback") ? fallback : "",
      confirming: false,
    });
  }
  #fallbackConfirmation(action: Extract<StationAction, { kind: "fallback" | "switch_off" }>) {
    const station = this.#stationName(action.stationId);
    const choice = action.choice;
    const sentence = choice
      ? format("prep.fallback_confirm", { station, destination: this.#stationName(choice) })
      : format("prep.fallback_confirm_ask", { station });
    const source = this.#times(action.stationId);
    if (source?.status.open && action.kind === "fallback") return sentence;
    if (!choice) return `${sentence} ${t("prep.starts_now")}`;
    const target = this.#times(choice);
    if (target?.status.open) return `${sentence} ${t("prep.starts_now")}`;
    return `${sentence} ${
      target?.closedSendsTo
        ? format("prep.fallback_closed_too", {
            station: this.#stationName(choice),
            destination: this.#stationName(target.closedSendsTo),
          })
        : format("prep.fallback_closed_ask", { station: this.#stationName(choice) })
    }`;
  }
  async #saveStationAction(hours?: readonly WeeklyInterval[]) {
    const action = this.stationAction;
    if (!action || this.busy) return;
    this.busy = true;
    this.stationActionError = "";
    this.stationFieldError = "";
    let fallbackSaved = false;
    try {
      if (action.kind === "today") await this.api.setStationToday(action.stationId, action.state);
      if (action.kind === "hours") await this.api.setStationHours(action.stationId, hours ?? []);
      if (action.kind === "fallback" || action.kind === "switch_off") {
        const choice = action.choice || null;
        if (choice !== this.#times(action.stationId)?.fallbackStationId) {
          await this.api.setStationFallback(action.stationId, choice);
          fallbackSaved = true;
        }
        if (action.kind === "switch_off") await this.api.deactivateStation(action.stationId);
      }
      if (action.kind === "switch_on") await this.api.activateStation(action.stationId);
      this.stationAction = undefined;
      await this.#load();
    } catch (e) {
      if (fallbackSaved) await this.#load();
      const code = codeOf(e);
      const field = (e as { params?: { field?: string } } | undefined)?.params?.field;
      if (action.kind === "hours" && field?.startsWith("hours.")) {
        const index = Number(field.slice(6));
        if (Number.isInteger(index)) this.hoursServerErrors = { [index]: t("venue.time_distinct") };
      } else if (code === "station.fallback_loop" || code === "route.station_inactive")
        this.stationFieldError = t(
          code === "station.fallback_loop" ? "prep.fallback_loop" : "prep.station_inactive",
        );
      else
        this.stationActionError =
          code === "station.not_found"
            ? `${t("prep.save_error")} ${t("prep.station_not_found")}`
            : t(code === "time_zone.unreadable" ? "prep.time_zone_unreadable" : "prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  #warnings(id: string) {
    const printers = this.outputsDown.printersDown.filter((row) => row.stationId === id);
    const screens = this.outputsDown.screensDark.filter((row) => row.stationId === id);
    return html`<div class="station-warnings">
      ${printers.map((row) => html`<p class="warning">${format("prep.printer_down", { printer: row.printerName, time: new Date(row.since).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) })}</p>`)}
      ${screens.map((row) => html`<p class="warning">${row.lastSeenAt ? format("prep.screen_dark", { time: new Date(row.lastSeenAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) }) : t("prep.screen_never")}</p>`)}
    </div>`;
  }
  #stationCard(s: PrepStation) {
    const watching = watchersOfStation(this.view?.watchers ?? [], s.id);
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
      <div class="status">
        <p data-test=${`status-${s.id}`}>${this.#stationStatus(s)}</p>
        ${this.#warnings(s.id)}
      </div>
      ${
        s.isDefault
          ? nothing
          : html`
              <div class="actions">
                <wt-button
                  variant="secondary"
                  data-test=${`${this.#times(s.id)?.status.open ? "close" : "open"}-today-${s.id}`}
                  @click=${() => this.#openStationAction({ kind: "today", stationId: s.id, state: this.#times(s.id)?.status.open ? "closed" : "open" })}
                  >${t(this.#times(s.id)?.status.open ? "prep.close_today" : "prep.open_today")}</wt-button
                >
                ${this.#times(s.id)?.today ? html`<wt-button variant="secondary" data-test=${`schedule-${s.id}`} @click=${() => this.#openStationAction({ kind: "today", stationId: s.id, state: null })}>${t("prep.back_to_schedule")}</wt-button>` : nothing}
              </div>
              <p>${t("venue.hours")}: ${this.#hoursSummary(this.#times(s.id)?.hours ?? [])}</p>
              <wt-button
                variant="secondary"
                data-test=${`edit-hours-${s.id}`}
                @click=${() => this.#openStationAction({ kind: "hours", stationId: s.id })}
                >${t("prep.edit_hours")}</wt-button
              >
              <wt-combobox
                data-test=${`fallback-${s.id}`}
                name=${`fallback-${s.id}`}
                label=${t("prep.when_closed")}
                placeholder=${t("prep.no_replacement_choice")}
                .searchPlaceholder=${t("prep.search_stations")}
                .options=${this.#fallbackOptions(s.id)}
                .value=${live(this.#times(s.id)?.fallbackStationId ?? "")}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#openStationAction({ kind: "fallback", stationId: s.id, choice: event.detail.value, confirming: true })}
              ></wt-combobox>
              <wt-button
                variant="secondary"
                data-test=${`change-fallback-${s.id}`}
                @click=${() => this.#openFallback(s.id, "fallback")}
                >${t("prep.change_fallback")}</wt-button
              >
            `
      }
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
      ${watching.length ? html`<p>${format("watchers.watched_by", { list: watching.map((watcher) => watcher.name).join(", ") })}</p>` : nothing}
      <wt-switch
        name="showsRestOfOrder"
        label=${t("prep.shows_rest_of_order")}
        .checked=${live(this.stationSwitchBusy.get(s.id) ?? s.showsRestOfOrder)}
        .disabled=${this.stationSwitchBusy.has(s.id)}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          void this.#saveRestOfOrder(s, event.detail.checked);
        }}
      ></wt-switch>
      ${this.stationSwitchError[s.id]?.field ? html`<p class="error" data-field-error="showsRestOfOrder" role="alert">${this.stationSwitchError[s.id]!.message}</p>` : nothing}
      <p class="muted">${t("prep.shows_rest_of_order_hint")}</p>
      ${this.#chips(s.id)}
      <div class="actions">
        <wt-button
          data-test=${`claim-${s.id}`}
          variant="secondary"
          @click=${() => {
            this.editor = { kind: "claim", stationId: s.id };
            this.#showError("");
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
          @click=${() => this.#openFallback(s.id, "switch_off")}
          >${t("prep.switch_off")}</wt-button
        >
      </div>
      ${this.stationSwitchError[s.id] && !this.stationSwitchError[s.id]!.field ? html`<p class="error" role="alert">${this.stationSwitchError[s.id]!.message}</p>` : nothing}</wt-card
    >`;
  }
  #watchers() {
    const view = this.view!;
    const ordered = [...view.watchers]
      .filter((watcher) => watcher.active)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    return html`<section data-test="watchers-group">
      <div class="toolbar">
        <h2>${t("watchers.title")}</h2>
        <wt-button
          data-test="new-watcher"
          @click=${() => {
            this.watcherEditor = {};
            this.watcherRefusal = undefined;
          }}
          >${t("watchers.new")}</wt-button
        >
      </div>
      <div class="cards">
        ${ordered.map((watcher) => {
          const follows = watcher.everyStation
            ? t("watchers.every_station")
            : view.stations
                .filter((station) => station.active && watcher.stationIds.includes(station.id))
                .map((station) => station.name)
                .join(", ");
          const zones = watcher.everyZone
            ? t("watchers.every_zone")
            : view.zones
                .filter((zone) => zone.active !== false && watcher.zoneIds.includes(zone.id))
                .map((zone) => zone.name)
                .join(", ");
          const screens = view.devices
            .filter((device) => device.watcherId === watcher.id && device.active)
            .map((device) => device.label)
            .join(", ");
          const printers = view.printers
            .filter(
              (printer) =>
                watcher.printerIds.includes(printer.id) || printer.watcherId === watcher.id,
            )
            .map((printer) => printer.name)
            .join(", ");
          return html`<wt-card data-test=${`watcher-${watcher.id}`}
            ><h3>${watcher.name}</h3>
            <p>${format("watchers.follows", { list: follows })}</p>
            <p>${format("watchers.for", { list: zones })}</p>
            ${watcher.runsPass ? html`<p>${t("watchers.runs_pass")}</p>` : nothing}
            <p>
              ${t("watchers.screens")}: ${screens || t("prep.none")}
              <a href="/manage/devices">${t("prep.devices")}</a>
            </p>
            <p>
              ${t("watchers.printers")}: ${printers || t("prep.none")}
              <a href="/manage/printing-rules">${t("prep.printing_rules")}</a>
            </p>
            <div class="actions">
              <wt-button
                variant="secondary"
                data-test=${`edit-watcher-${watcher.id}`}
                @click=${() => {
                  this.watcherEditor = { id: watcher.id };
                  this.watcherRefusal = undefined;
                }}
                >${t("prep.edit")}</wt-button
              >
              <wt-button
                variant="danger"
                data-test=${`remove-watcher-${watcher.id}`}
                @click=${() => {
                  this.watcherRemoval = watcher;
                  this.watcherRemoveError = "";
                }}
                >${t("watchers.remove")}</wt-button
              >
            </div>
          </wt-card>`;
        })}
      </div>
    </section>`;
  }
  async #saveWatcher(input: WatcherInput) {
    if (this.busy || !this.watcherEditor) return;
    this.busy = true;
    try {
      if (this.watcherEditor.id) await this.api.updateWatcher(this.watcherEditor.id, input);
      else await this.api.createWatcher(input);
      this.watcherEditor = undefined;
      await this.#load();
    } catch (error) {
      this.watcherRefusal = error as { code: string; params?: { field?: string } };
    } finally {
      this.busy = false;
    }
  }
  async #removeWatcher() {
    if (this.busy || !this.watcherRemoval) return;
    this.busy = true;
    try {
      await this.api.removeWatcher(this.watcherRemoval.id);
      this.watcherRemoval = undefined;
      await this.#load();
    } catch (error) {
      this.watcherRemoveError =
        codeOf(error) === "watcher.not_found" ? t("watchers.not_found") : t("prep.save_error");
    } finally {
      this.busy = false;
    }
  }
  #watcherDialogs() {
    const watcher = this.view?.watchers.find((row) => row.id === this.watcherEditor?.id);
    return html`${
      this.watcherEditor
        ? html`<wt-modal
            size="standard"
            open
            data-test="watcher-modal"
            heading=${watcher?.name ?? t("watchers.new")}
            .dismissible=${!this.busy}
            @wt-close=${() => {
              this.watcherEditor = undefined;
            }}
          >
            <watcher-form
              .watcher=${watcher}
              .stations=${this.view?.stations ?? []}
              .zones=${this.view?.zones ?? []}
              .refusal=${this.watcherRefusal}
              .busy=${this.busy}
              @watcher-save=${(event: CustomEvent<{ input: WatcherInput }>) => void this.#saveWatcher(event.detail.input)}
              @watcher-cancel=${() => {
                this.watcherEditor = undefined;
              }}
            ></watcher-form>
          </wt-modal>`
        : nothing
    }
    ${
      this.watcherRemoval
        ? html`<wt-modal
            size="compact"
            open
            data-test="remove-watcher-modal"
            heading=${t("watchers.remove")}
            .dismissible=${!this.busy}
            @wt-close=${() => {
              this.watcherRemoval = undefined;
            }}
          >
            <p>${format("watchers.remove_confirm", { name: this.watcherRemoval.name })}</p>
            ${this.watcherRemoveError ? html`<p class="error" role="alert">${this.watcherRemoveError}</p>` : nothing}
            <wt-form-actions slot="footer"
              ><wt-button
                slot="cancel"
                variant="secondary"
                @click=${() => {
                  this.watcherRemoval = undefined;
                }}
                >${t("venue.cancel")}</wt-button
              ><wt-button
                data-test="confirm-remove-watcher"
                variant="danger"
                ?disabled=${this.busy}
                @click=${() => void this.#removeWatcher()}
                >${t("watchers.remove")}</wt-button
              ></wt-form-actions
            >
          </wt-modal>`
        : nothing
    }`;
  }
  #unassigned() {
    const r = this.view!.routing;
    const destination = r.defaultStationId
      ? t("prep.fallback").replace("{name}", this.#stationName(r.defaultStationId))
      : t("venue.readiness.default_station_missing");
    return keyed(
      this.assignmentChoiceKey,
      html`<wt-card data-test="unassigned"
        ><h2>${t("prep.unassigned")}</h2>
        <p>${destination}</p>
        ${r.unassigned.folders.map((f) => html`<div class="item"><span>${this.#path(f.id)}</span><wt-combobox data-test=${`assign-${f.id}`} label=${t("prep.assign_to")} .options=${this.#targetOptions()} @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#setClaim(f.id, targetFor(e.detail.value))}></wt-combobox>${this.claimError && this.claimField === f.id ? html`<p class="error" data-field-error=${f.id} role="alert">${this.claimError}</p>` : nothing}</div>`)}${r.unassigned.products.map(
          (p) =>
            html`<div class="item">
              <span>${p.name}</span
              ><wt-combobox
                data-test=${`assign-${p.id}`}
                label=${t("prep.assign_to")}
                .options=${this.#targetOptions()}
                @wt-change=${(e: CustomEvent<{ value: string }>) => {
                  const target = targetFor(e.detail.value);
                  void this.#preview(
                    { kind: "assignment", productId: p.id, target },
                    () => this.api.assignProduct(p.id, target),
                    false,
                    p.id,
                  );
                }}
              ></wt-combobox
              >${this.claimError && this.claimField === p.id ? html`<p class="error" data-field-error=${p.id} role="alert">${this.claimError}</p>` : nothing}
            </div>`,
        )}</wt-card
      >`,
    );
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
    if (!this.editor || this.pending) return nothing;
    const editor = this.editor;
    return html`<wt-modal
      size=${editor.kind === "claim" || editor.kind === "exception_delete" ? "compact" : "standard"}
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
                        this.#showError("");
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
                      this.#showError("");
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
                      this.#showError("");
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
                        );
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
                    @click=${() => void this.#preview({ kind: "exception_delete", id: editor.id }, () => this.api.deleteException(editor.id), true)}
                    >${t("prep.delete")}</wt-button
                  >`
                : nothing
        }
      </wt-form-actions></wt-modal
    >`;
  }
  #previewDialog() {
    const pending = this.pending;
    if (!pending) return nothing;
    const claim = pending.change.kind === "claim" ? pending.change : null;
    const oldClaim = claim?.target
      ? this.view?.routing.claims.find((c) => c.categoryId === claim.categoryId)
      : undefined;
    const movedClaim =
      oldClaim && claim?.target && JSON.stringify(oldClaim.target) !== JSON.stringify(claim.target);
    return html`<wt-modal
      size="wide"
      open
      .dismissible=${!this.busy}
      data-test="routing-preview"
      heading=${t("prep.preview_title")}
      @wt-close=${() => this.#cancelRouting()}
    >
      ${movedClaim && claim ? html`<p>${t("prep.claim_move").replace("{folder}", this.#path(claim.categoryId)).replace("{from}", this.#targetName(oldClaim.target)).replace("{to}", this.#targetName(claim.target!))}</p>` : nothing}
      ${
        pending.moves.length
          ? html`<p>${t("prep.preview_moves")}</p>
              <div class="table-wrap" tabindex="0">
                <table>
                  <thead>
                    <tr>
                      <th>${t("prep.preview_product")}</th>
                      <th>${t("prep.service_zone")}</th>
                      <th>${t("prep.preview_from")}</th>
                      <th>${t("prep.preview_to")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pending.moves.map(
                      (move) =>
                        html`<tr>
                          <td>${move.productName}</td>
                          <td>${move.zoneName ?? t("prep.any_zone")}</td>
                          <td>${move.from ? this.#targetName(move.from) : t("prep.no_station")}</td>
                          <td>
                            ${move.to ? this.#targetName(move.to) : t(move.toNoReplacement ? "prep.no_replacement" : "prep.no_station")}
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
          : html`<p>${t("prep.preview_none")}</p>`
      }
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-routing"
          ?disabled=${this.busy}
          @click=${() => this.#cancelRouting()}
          >${t("prep.cancel")}</wt-button
        ><wt-button
          data-test="confirm-routing"
          ?disabled=${this.busy}
          @click=${() => void this.#confirmRouting()}
          >${t("prep.confirm")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
  #stationActionDialog() {
    const action = this.stationAction;
    if (!action) return nothing;
    const station = this.view?.stations.find((row) => row.id === action.stationId);
    const times = this.#times(action.stationId);
    if (action.kind === "hours")
      return html`<station-hours-form
        data-test="station-action-modal"
        .inDialog=${true}
        .hours=${this.editingHours}
        .serverErrors=${this.hoursServerErrors}
        .saveError=${this.stationActionError}
        .busy=${this.busy}
        @hours-save=${(event: CustomEvent<{ hours: WeeklyInterval[] }>) => void this.#saveStationAction(event.detail.hours)}
        @hours-cancel=${() => this.#cancelStationAction()}
      ></station-hours-form>`;
    const end = this.#todayEnd();
    const isFallback = action.kind === "fallback" || action.kind === "switch_off";
    const heading =
      action.kind === "switch_off"
        ? t("prep.switch_off")
        : action.kind === "fallback"
          ? t("prep.when_closed")
          : action.kind === "switch_on"
            ? t("prep.switch_on")
            : action.kind === "today" && action.state === "closed"
              ? t("prep.close_today")
              : action.kind === "today" && action.state === "open"
                ? t("prep.open_today")
                : t("prep.back_to_schedule");
    const todaySentence =
      action.kind === "today" && action.state === "closed"
        ? times?.closedSendsTo
          ? format("prep.close_confirm", {
              station: station?.name ?? action.stationId,
              destination: this.#stationName(times.closedSendsTo),
              ...end,
            })
          : format("prep.close_confirm_ask", { station: station?.name ?? action.stationId, ...end })
        : "";
    return html`<wt-modal
      size="compact"
      open
      data-test="station-action-modal"
      heading=${heading}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#cancelStationAction()}
    >
      ${todaySentence ? html`<p>${todaySentence}</p>` : nothing}
      ${
        isFallback
          ? html`
              ${action.kind === "switch_off" ? html`<p>${format("prep.switch_off_confirm", { station: station?.name ?? action.stationId })}</p>` : nothing}
              ${
                station?.isDefault
                  ? nothing
                  : html`<wt-combobox
                        data-test="station-fallback"
                        name="station-fallback"
                        label=${t("prep.when_closed")}
                        placeholder=${t("prep.no_replacement_choice")}
                        .searchPlaceholder=${t("prep.search_stations")}
                        .options=${this.#fallbackOptions(action.stationId)}
                        .value=${action.choice}
                        ?disabled=${this.busy}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          if (this.busy) return;
                          this.stationAction = {
                            ...action,
                            choice: event.detail.value,
                            confirming: false,
                          };
                          this.stationFieldError = "";
                        }}
                      ></wt-combobox>
                      ${this.stationFieldError ? html`<p class="error" role="alert" data-field-error="fallback">${this.stationFieldError}</p>` : nothing}`
              }
              ${action.confirming ? html`<p data-test="fallback-confirmation">${this.#fallbackConfirmation(action)}</p>` : nothing}
            `
          : nothing
      }
      ${this.stationActionError ? html`<p class="error" role="alert">${this.stationActionError}</p>` : nothing}
      ${html`<wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#cancelStationAction()}
          >${t("prep.cancel")}</wt-button
        ><wt-button
          data-test="confirm-station-action"
          ?disabled=${this.busy}
          @click=${() => {
            if (this.busy) return;
            if (isFallback && !action.confirming && !station?.isDefault)
              this.stationAction = { ...action, confirming: true };
            else void this.#saveStationAction();
          }}
          >${t("prep.confirm")}</wt-button
        ></wt-form-actions
      >`}
    </wt-modal>`;
  }
  override render() {
    const view = this.view;
    const active =
      view?.stations
        .filter((s) => s.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)) ?? [];
    const off = view?.routing.claims.filter((c) => c.stationOff) ?? [];
    const inactive = view?.stations.filter((station) => !station.active) ?? [];
    return html`<div class="toolbar">
        <h1>${t("prep.title")}</h1>
        <wt-button @click=${() => this.#openStation()} data-test="new-station"
          >${t("prep.new_station")}</wt-button
        >
      </div>
      ${
        view
          ? html`${this.#tester()}${this.#exceptions()}
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
              ${this.#watchers()}
              ${
                inactive.length
                  ? html`<section>
                      <h2>${t("prep.switched_off")}</h2>
                      ${inactive.map(
                        (station) =>
                          html`<wt-card data-test=${`inactive-${station.id}`}
                            ><h3>${station.name}</h3>
                            <p>
                              ${this.#times(station.id)?.closedSendsTo ? format("prep.off_goes_to", { station: this.#stationName(this.#times(station.id)!.closedSendsTo!) }) : t("prep.off_asks")}
                            </p>
                            <p>
                              ${this.#times(station.id)?.closedSendsTo ? t("prep.switched_off_hint") : t("prep.switched_off_no_replacement")}
                            </p>
                            ${this.#warnings(station.id)}
                            <div class="actions">
                              <wt-button
                                variant="secondary"
                                data-test=${`change-fallback-${station.id}`}
                                @click=${() => this.#openFallback(station.id, "fallback")}
                                >${t("prep.change_fallback")}</wt-button
                              ><wt-button
                                data-test=${`switch-on-${station.id}`}
                                @click=${() => this.#openStationAction({ kind: "switch_on", stationId: station.id })}
                                >${t("prep.switch_on")}</wt-button
                              >
                            </div></wt-card
                          >`,
                      )}
                    </section>`
                  : nothing
              }
              ${off.length ? html`<p>${t("prep.switched_off")}: ${off.map((c) => html`${this.#path(c.categoryId)} — ${this.#targetName(c.target)}. ${this.#times(c.target.kind === "station" ? c.target.stationId : "")?.closedSendsTo ? t("prep.switched_off_hint") : t("prep.switched_off_no_replacement")}`)}</p>` : nothing}`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.#dialog()}${this.#previewDialog()}${this.#stationActionDialog()}${this.#watcherDialogs()}`;
  }
}
