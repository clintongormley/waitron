import { DragEdgeScroll } from "@waitron/ui/src/drag-edge-scroll.js";
import { QueryController, codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  submitOnEnter,
  ReorderController,
  reorder,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import {
  holdPageCursor,
  releasePageCursor,
  pointerElementsAt,
} from "@waitron/ui/src/reorder-table.js";
import { keyed } from "lit/directives/keyed.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import {
  cellKey,
  selectRoutingCell,
  selectionRulesFromModel,
  targetKey,
  type CellAddress,
  type RouteTarget,
  type RoutingModel,
  type RoutingSelectionRules,
} from "../routing.js";
import type { RoutingChange, RoutingMove, StationTimes } from "../routing-types.js";
import { format, formatDate } from "./hours-view.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
} from "./routing-client.js";
import "./routing-grid.js";
import { rowInModel } from "./routing-grid-model.js";
import type {
  RoutingCellChange,
  RoutingDefaultRefusal,
  RoutingPending,
  RoutingRefusal,
} from "./routing-grid.js";
import { t } from "./strings.js";
import "./station-table.js";
import "./station-editor.js";
import {
  refusalOf,
  listedPrinterIds,
  stationPrinterOptions,
  stationRefusalField,
  type StationEditorSave,
  type StationRefusal,
} from "./station-editor.js";
import { StationDisableDialog } from "./station-disable-dialog.js";

type StationAction = { kind: "switch_off" | "switch_on"; stationId: string };

type Editor = { kind: "station" };
type NewStation = StationInput & { printerIds: string[] };
const PREP_TABS = ["stations", "routing", "settings"] as const;
type PrepTab = (typeof PREP_TABS)[number];
const TIMING_FIELDS = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;
type TimingField = (typeof TIMING_FIELDS)[number];
const TIMING_LABELS = {
  warmAfterMinutes: "prep.warm",
  overdueAfterMinutes: "prep.overdue",
  forgottenAfterMinutes: "prep.forgotten",
} as const;

type SettingsDraft = {
  stationId: string;
  field: TimingField;
  value: string;
  fieldError: string;
  error: string;
  attempted: boolean;
};
const sameAddress = (a: CellAddress, b: CellAddress) => cellKey(a) === cellKey(b);

/** One line per active device whose kitchen screens show the station, naming those screens' kinds. */
function screenDevices(devices: PrepStationsView["devices"], stationId: string) {
  const lines = devices.flatMap((device) => {
    if (!device.active) return [];
    const kinds = device.kitchenScreens
      .filter(
        (screen) =>
          screen.available &&
          screen.stations.some((slot) => slot.id === stationId && slot.available),
      )
      .map((screen) => t(`prep.screen_kind.${screen.kind}`));
    return kinds.length === 0
      ? []
      : [format("prep.tickets.screen_device", { device: device.label, kinds: kinds.join(", ") })];
  });
  return lines.length === 0
    ? t("prep.none")
    : lines.map((line) => html`<span data-test="screen-device">${line}</span>`);
}

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
      wt-tabs[data-routes]::part(tablist) {
        flex-wrap: wrap;
      }
      wt-tabs::part(tab-actions) {
        max-width: 50%;
      }
      wt-data-table::part(settings-cell) {
        display: grid;
        gap: var(--wt-space-2);
        max-width: calc(var(--wt-tap-min) * 5);
        white-space: normal;
      }
      wt-data-table::part(settings-rest) {
        inline-size: calc(var(--wt-tap-min) * 5);
        grid-template-columns: minmax(0, 1fr);
      }
      wt-data-table::part(cell-actions) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(edit-printers) {
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        min-height: var(--wt-tap-min);
        padding: 0;
        text-decoration: underline;
      }
      wt-data-table::part(inherited) {
        --wt-color-text: var(--wt-color-text-muted);
      }
      h1 {
        margin: 0;
      }
      .toolbar,
      .actions {
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
      .form {
        padding-block: var(--wt-space-3);
      }
      .warning {
        color: var(--wt-color-warning);
      }
    `,
  ];
  @property({ attribute: false }) api!: PrepStationsApi;
  @state() private view?: PrepStationsView;
  @state() private settingsEditor?: SettingsDraft;
  @state() private settingsBusy = false;
  @state() private editor?: Editor;
  @state() private draft: NewStation = {
    name: "",
    displayOrder: 0,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
    printerIds: [],
  };
  @state() private fieldError: Record<string, string> = {};
  @state() private error = "";
  /** Whether `error` is a read's failure, the only message a read's success may clear. */
  #readErrorShown = false;
  @state() private busy = false;
  @state() private stationAttempted = false;
  @state() private stationAction?: StationAction;
  @state() private stationActionError = "";
  @state() private tab: PrepTab = "stations";
  @state() private stationOrder?: string[];
  @state() private stationAnnouncement = "";
  #stationDrag?: { id: string; pointerId: number; changed: boolean };
  /** The station the editor opened for; `token` tells one opening from the next. */
  @state() private stationEdit?: { token: object; station: PrepStation };
  @state() private stationEditBusy = false;
  @state() private stationEditRefusal?: StationRefusal;
  #routingTimer?: ReturnType<typeof setInterval>;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "prep-stations") return;
      const requested = this.#url.read("view");
      this.tab = PREP_TABS.find((tab) => tab === requested) ?? "stations";
      if (this.tab !== requested)
        this.#url.write({ dashboard: "prep-stations", view: this.tab }, true);
    },
    {
      basePath: "/manage",
      primary: "dashboard",
      children: { "*": { view: "view" } },
    },
  );
  /** A cell choice whose route-change preview is open. */
  @state() private pending?: {
    change: RoutingChange;
    moves: RoutingMove[];
    save: () => Promise<unknown>;
    isCurrent: () => boolean;
  };
  /** The grid shows this choice at its address until the preview or save settles. */
  @state() private cellChoice: RoutingPending | null = null;
  @state() private cellRefusal: RoutingRefusal | null = null;
  /** A refused Make default: shown on the page, as every station action's is, and in the editor. */
  @state() private defaultRefusal: RoutingDefaultRefusal | null = null;
  /**
   * The refusal `#dropChoice` set, which a refresh that puts its row and zone back in the grid
   * clears.
   */
  #droppedRefusal?: RoutingRefusal;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => this.#showReadError(t("prep.load_error")),
    () => {
      if (this.#readErrorShown) this.#showError("");
    },
  );
  #cellScope?: DraftScope<string>;
  #cellScopeOwner?: object;
  /** A confirmed choice whose refresh is open: it keeps its committed scope until that settles. */
  #cellRefreshing?: object;
  /** A written choice the grid keeps showing until a read replaces the model. */
  #writtenChoice?: RoutingPending;
  #cellRun = 0;
  #stationEditRun = 0;
  #stationScope?: DraftScope<NewStation>;
  #stationBaseline?: NewStation;
  #stationIdentity?: object;
  #stationActionIdentity?: object;
  #settingsScope?: DraftScope<string>;
  #settingsIdentity?: object;
  #leave?: LeaveCoordinator;

  #settingsCurrent(identity: object | undefined): boolean {
    return this.isConnected && identity === this.#settingsIdentity;
  }
  #settingsValue(editor: SettingsDraft): string {
    const value = editor.value.trim();
    return value === "" ? "" : Number.isFinite(Number(value)) ? String(Number(value)) : value;
  }
  #syncSettingsDraft(): void {
    if (!this.settingsEditor) {
      this.#settingsScope?.dispose();
      this.#settingsScope = undefined;
      this.#settingsIdentity = undefined;
    } else if (!this.#settingsIdentity) {
      const id = (this.#settingsIdentity = {});
      this.#leave ??= leaveCoordinatorFor(this);
      this.#settingsScope = draftScopeFor(this, {
        id,
        current: () => this.#settingsValue(this.settingsEditor!),
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          if (this.settingsEditor) this.settingsEditor = { ...this.settingsEditor, value };
        },
      }).scope;
    }
  }
  #leaveSettings(reason: LeaveReason, identity: object | undefined, proceed: () => void): void {
    if (!this.#settingsCurrent(identity) || this.settingsBusy) return;
    if (!this.#settingsScope || !this.#leave) proceed();
    else
      void this.#leave!.request({
        scopes: [this.#settingsScope.id],
        reason,
        proceed: () => {
          if (this.#settingsCurrent(identity) && !this.settingsBusy) proceed();
        },
      });
  }
  #openSettings(editor: SettingsDraft): void {
    this.#leaveSettings("navigation", this.#settingsIdentity, () => {
      this.#settingsScope?.dispose();
      this.#settingsScope = undefined;
      this.#settingsIdentity = undefined;
      this.settingsEditor = editor;
      this.#syncSettingsDraft();
    });
  }
  #cancelSettings(reason: LeaveReason, identity: object | undefined): void {
    this.#leaveSettings(reason, identity, () => {
      this.settingsEditor = undefined;
      this.#syncSettingsDraft();
    });
  }

  #syncStationDrafts(): void {
    if (this.editor?.kind !== "station") {
      this.#stationBaseline = undefined;
      this.#stationScope?.dispose();
      this.#stationScope = undefined;
      this.#stationIdentity = undefined;
    } else if (!this.#stationIdentity) {
      const id = (this.#stationIdentity = {});
      this.#stationBaseline ??= { ...this.draft };
      this.#leave ??= leaveCoordinatorFor(this);
      this.#stationScope = draftScopeFor(this, {
        id,
        current: () => this.draft,
        snapshot: (value) => ({ ...value, printerIds: [...value.printerIds] }),
        equal: (a, b) =>
          (Object.keys(a) as (keyof NewStation)[]).every((key) =>
            key === "printerIds"
              ? a.printerIds.length === b.printerIds.length &&
                a.printerIds.every((printerId) => b.printerIds.includes(printerId))
              : Object.is(a[key], b[key]),
          ),
        restore: (value) => {
          this.draft = { ...value, printerIds: [...value.printerIds] };
        },
      }).scope;
      this.#stationScope.commit(this.#stationBaseline);
    }
  }

  readonly #beforeAddClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const identity = this.#stationIdentity;
    const scope = this.#stationScope;
    if (!scope || !this.#leave) return true;
    const outcome = await this.#leave.request({ scopes: [scope.id], reason, proceed() {} });
    return identity === this.#stationIdentity && outcome === "proceeded";
  };

  /** Dirty from the moment a choice's preview opens until Confirm saves it or Cancel drops it. */
  #syncCellDraft(): void {
    const pending = this.pending;
    if (!pending) {
      if (this.#cellScopeOwner !== this.#cellRefreshing) this.#releaseCellScope();
      return;
    }
    if (this.#cellScopeOwner === pending) return;
    this.#releaseCellScope();
    const saved = targetKey(this.#savedCell(pending.change.address));
    const chosen = targetKey(pending.change.target);
    let held = false;
    this.#cellScopeOwner = pending;
    this.#leave ??= leaveCoordinatorFor(this);
    this.#cellScope = this.#leave?.register({
      id: pending,
      current: () => (held ? chosen : saved),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: () => {
        held = false;
        if (this.pending === pending) {
          this.pending = undefined;
          this.cellChoice = null;
        }
      },
    });
    held = true;
    this.#cellScope?.changed();
  }
  #releaseCellScope(): void {
    this.#cellScope?.dispose();
    this.#cellScope = undefined;
    this.#cellScopeOwner = undefined;
  }
  #leaveCell(reason: LeaveReason, proceed: () => void): void {
    const scope = this.#cellScope;
    if (this.busy) return;
    if (!scope) {
      proceed();
      return;
    }
    void this.#leave!.request({
      scopes: [scope.id],
      reason,
      proceed: () => {
        if (this.isConnected && !this.busy) proceed();
      },
    });
  }

  #loaded = false;
  #showError(message: string, fromRead = false): void {
    this.error = message;
    this.#readErrorShown = fromRead;
  }
  /** A read's failure never replaces an action's message. */
  #showReadError(message: string): void {
    if (this.error === "" || this.#readErrorShown) this.#showError(message, true);
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (!this.isConnected) return;
    if (
      this.pending?.change.address.row.kind === "no_category" &&
      !this.busy &&
      !this.#addressShown(this.pending.change.address)
    ) {
      this.#dropChoice(this.pending.change.address);
      this.pending = undefined;
    }
    this.#syncStationDrafts();
    this.#syncSettingsDraft();
    this.#syncCellDraft();
    const changedState = changed as Map<PropertyKey, unknown>;
    if (changedState.has("view") && this.#writtenChoice !== undefined) {
      if (this.cellChoice === this.#writtenChoice) this.cellChoice = null;
      this.#writtenChoice = undefined;
    }
    if (changedState.has("tab")) {
      this.cellRefusal = null;
      this.defaultRefusal = null;
      this.#closeCellEditor();
    }
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
    void this.#load();
    if (!this.api.liveData) {
      this.#routingTimer = setInterval(() => void this.#load(), 60_000);
    }
  }
  override disconnectedCallback() {
    this.#cellRun++;
    if (
      this.#stationIdentity ||
      this.pending !== undefined ||
      this.cellChoice !== null ||
      this.stationAction !== undefined
    )
      this.busy = false;
    this.stationAction = undefined;
    this.#stationActionIdentity = undefined;
    this.settingsEditor = undefined;
    this.settingsBusy = false;
    this.#settingsScope?.dispose();
    this.#settingsScope = undefined;
    this.#settingsIdentity = undefined;
    this.#stationScope?.dispose();
    this.stationEditBusy = false;
    this.pending = undefined;
    this.cellChoice = null;
    this.cellRefusal = null;
    this.defaultRefusal = null;
    this.#writtenChoice = undefined;
    this.#cellRefreshing = undefined;
    this.#releaseCellScope();
    this.#stationScope = undefined;
    this.#stationIdentity = undefined;
    this.#leave = undefined;
    if (this.#routingTimer) clearInterval(this.#routingTimer);
    super.disconnectedCallback();
    this.#endStationDrag();
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
          if (
            this.cellRefusal !== null &&
            this.cellRefusal === this.#droppedRefusal &&
            this.#addressShown(this.cellRefusal.address)
          )
            this.cellRefusal = null;
          this.#dropUnlistedPrinters(value.printers);
        },
      );
    } catch {
      this.#showReadError(t("prep.load_error"));
    }
  }
  /** A printer deleted elsewhere leaves the open printer choices, and each says so in its message. */
  #dropUnlistedPrinters(printers: PrepStationsView["printers"]): void {
    if (this.editor) {
      const printerIds = listedPrinterIds(this.draft.printerIds, printers);
      if (printerIds.length < this.draft.printerIds.length) {
        this.#change("printerIds", printerIds);
        if (!Object.values(this.fieldError).some(Boolean))
          this.#showError(t("prep.printer_deleted"));
      }
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
  /** Whether `run` succeeded. */
  async #act(
    run: () => Promise<unknown>,
    message: (error: unknown) => string = () => t("prep.save_error"),
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.#showError("");
    try {
      await run();
      await this.#load();
      return true;
    } catch (error) {
      this.#showError(message(error));
      return false;
    } finally {
      this.busy = false;
    }
  }
  /** A refused Make default: the outgoing default's saved hours could not resume. */
  #defaultRefusal(error: unknown): string {
    const params = (error as { params?: Record<string, unknown> } | undefined)?.params;
    const name = this.view?.stations.find((station) => station.id === params?.subjectId)?.name;
    if (codeOf(error) !== "hours.invalid" || name === undefined || typeof params?.date !== "string")
      return t("prep.save_error");
    return format(
      params.field === "date" ? "prep.default_hours_clash" : "prep.default_hours_skipped",
      { name, date: formatDate(params.date) },
    );
  }
  /** The grid's open editor closes once its choice is written. */
  #closeCellEditor(): void {
    this.renderRoot.querySelector("venue-routing-grid")?.closeEditor();
  }
  async #makeDefault(stationId: string) {
    if (this.busy || this.pending) return;
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    const run = ++this.#cellRun;
    this.busy = true;
    this.#showError("");
    this.defaultRefusal = null;
    this.cellChoice = { address, target: { kind: "station", stationId } };
    try {
      await this.api.setDefaultStation(stationId);
    } catch (error) {
      if (this.#cellRun !== run || !this.isConnected) return;
      const message = this.#defaultRefusal(error);
      this.cellChoice = null;
      this.#showError(message);
      this.defaultRefusal = { ...refusalOf(error), message };
      this.busy = false;
      return;
    }
    if (this.#cellRun !== run || !this.isConnected) return;
    this.cellChoice = null;
    this.cellRefusal = null;
    this.#closeCellEditor();
    try {
      await this.#load();
    } finally {
      if (this.#cellRun === run) this.busy = false;
    }
  }
  /** Whether the grid still draws this coordinate: a refresh can remove its zone or its row. */
  #addressShown({ row, zoneId }: CellAddress): boolean {
    const model = this.view?.routing;
    if (!model) return false;
    if (zoneId !== null && !model.zones.some((zone) => zone.id === zoneId)) return false;
    return rowInModel(model, row);
  }
  #savedCell(address: CellAddress): RouteTarget | null {
    return this.view?.routing.cells.find((cell) => sameAddress(cell, address))?.target ?? null;
  }
  async #chooseCell({ address, target, periods }: RoutingCellChange) {
    if (this.busy || this.pending) return;
    const run = ++this.#cellRun;
    const isCurrent = () => this.isConnected && this.#cellRun === run;
    this.cellChoice = periods === undefined ? { address, target } : { address, target, periods };
    this.cellRefusal = null;
    await this.#preview(
      periods === undefined
        ? { kind: "cell", address, target }
        : { kind: "cell", address, target, periods },
      () =>
        periods === undefined
          ? this.api.setCell(address, target)
          : this.api.setCell(address, target, periods),
      isCurrent,
    );
  }
  /** A choice that moves nothing is saved at once; otherwise its preview asks first. */
  async #preview(change: RoutingChange, save: () => Promise<unknown>, isCurrent: () => boolean) {
    this.busy = true;
    this.#showError("");
    let moves: RoutingMove[];
    try {
      moves = await this.api.preview(change);
    } catch (error) {
      if (!isCurrent()) return;
      this.#refuseCell(change.address, error);
      this.busy = false;
      return;
    }
    if (!isCurrent()) return;
    this.busy = false;
    const pending = { change, moves, save, isCurrent };
    if (moves.length > 0) this.pending = pending;
    else if (this.#addressShown(change.address)) await this.#saveCell(pending);
    else this.#dropChoice(change.address);
  }
  /** A refresh removed the choice's row or zone before it could be saved. */
  #dropChoice(address: CellAddress): void {
    this.cellChoice = null;
    this.#dropDraft(address);
  }
  /**
   * A refresh removed the row or zone of a choice, or of the open editor's unsaved changes. The All
   * categories row is always drawn, so only its zone can be gone.
   */
  #dropDraft(address: CellAddress): void {
    const { row, zoneId } = address;
    const zoneGone =
      zoneId !== null && !this.view?.routing.zones.some((zone) => zone.id === zoneId);
    this.cellRefusal = this.#droppedRefusal = {
      address,
      message: t(
        zoneGone
          ? "routing.dropped_zone"
          : row.kind === "category"
            ? "routing.dropped_category"
            : row.kind === "product"
              ? "routing.dropped_product"
              : "routing.dropped_no_category",
      ),
    };
  }
  #refuseCell(address: CellAddress, error: unknown): void {
    this.cellChoice = null;
    this.cellRefusal = {
      address,
      message: t(
        codeOf(error) === "route.station_inactive" ? "prep.station_disabled" : "prep.save_error",
      ),
      ...refusalOf(error),
    };
  }
  async #saveCell(pending: NonNullable<PrepStationsScreen["pending"]>) {
    if (this.busy) return;
    this.busy = true;
    try {
      await pending.save();
    } catch (error) {
      if (!pending.isCurrent()) return;
      this.#refuseCell(pending.change.address, error);
      this.pending = undefined;
      this.busy = false;
      return;
    }
    if (!pending.isCurrent()) return;
    this.#closeCellEditor();
    if (this.#cellScopeOwner === pending) this.#cellScope?.commit(targetKey(pending.change.target));
    this.#cellRefreshing = pending;
    this.pending = undefined;
    this.#writtenChoice = this.cellChoice ?? undefined;
    try {
      await this.#load();
    } finally {
      if (this.#cellRefreshing === pending) {
        this.#cellRefreshing = undefined;
        if (this.#cellScopeOwner === pending) this.#releaseCellScope();
      }
      if (pending.isCurrent()) this.busy = false;
    }
  }
  async #confirmRouting() {
    const pending = this.pending;
    if (pending && this.#addressShown(pending.change.address)) await this.#saveCell(pending);
  }
  #cancelRouting() {
    if (this.busy) return;
    this.#releaseCellScope();
    this.pending = undefined;
    this.cellChoice = null;
  }
  #activeStationOrder() {
    return (
      this.stationOrder ??
      [...(this.view?.stations ?? [])]
        .filter((station) => station.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
        .map((station) => station.id)
    );
  }
  #stationTable() {
    return this.renderRoot
      .querySelector("prep-station-table")
      ?.shadowRoot?.querySelector("wt-data-table");
  }
  #moveStation(id: string, to: number) {
    const previous = this.#activeStationOrder();
    const next = reorder(previous, previous.indexOf(id), to);
    if (next.join() === previous.join()) return false;
    this.stationOrder = next;
    this.stationAnnouncement = format("prep.station_reordered", {
      name: this.#stationName(id),
      index: String(to + 1),
      total: String(next.length),
    });
    return true;
  }
  async #saveStationOrder(id: string) {
    if (this.busy || !this.stationOrder) return;
    const ids = [...this.stationOrder];
    await this.#act(() => this.api.reorderStations(ids));
    this.stationOrder = undefined;
    await this.updateComplete;
    const stations = this.renderRoot.querySelector("prep-station-table");
    if (stations) await stations.updateComplete;
    const table = this.#stationTable();
    if (table) await table.updateComplete;
    table?.shadowRoot?.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)?.focus();
  }
  readonly #stationScroll = new DragEdgeScroll();
  #stationPoint = { x: 0, y: 0 };

  #startStationDrag(event: PointerEvent, id: string) {
    if (this.busy || this.#stationDrag || event.button !== 0) return;
    event.preventDefault();
    this.#stationDrag = { id, pointerId: event.pointerId, changed: false };
    this.#stationPoint = { x: event.clientX, y: event.clientY };
    this.#stationScroll.start(event.currentTarget as Element, this.#stationPoint, () => {
      const root = this.#stationTable()?.shadowRoot;
      const row = pointerElementsAt(this.#stationPoint.x, this.#stationPoint.y).find(
        (element) => element.matches("tbody tr") && root?.contains(element),
      );
      this.#trackStationDrag(row ? [row] : []);
    });
    holdPageCursor();
    document.addEventListener("pointermove", this.#moveStationDrag);
    document.addEventListener("pointerup", this.#dropStationDrag);
    document.addEventListener("pointercancel", this.#dropStationDrag);
    document.addEventListener("keydown", this.#stationDragKey, true);
  }
  readonly #moveStationDrag = (event: PointerEvent) => {
    const drag = this.#stationDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#stationPoint = { x: event.clientX, y: event.clientY };
    this.#stationScroll.update(this.#stationPoint);
    this.#trackStationDrag();
  };
  #trackStationDrag(
    rows: Iterable<Element> = this.#stationTable()?.shadowRoot?.querySelectorAll("tbody tr") ?? [],
  ): void {
    const drag = this.#stationDrag;
    if (!drag) return;
    const order = this.#activeStationOrder();
    for (const row of rows) {
      const bounds = row.getBoundingClientRect();
      if (this.#stationPoint.y < bounds.top || this.#stationPoint.y >= bounds.bottom) continue;
      const id = row.querySelector<HTMLElement>("[data-station-id]")?.dataset.stationId;
      if (id && order.includes(id) && this.#moveStation(drag.id, order.indexOf(id)))
        drag.changed = true;
      break;
    }
  }

  readonly #dropStationDrag = (event: PointerEvent) => {
    const drag = this.#stationDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#endStationDrag();
    if (drag.changed) void this.#saveStationOrder(drag.id);
  };
  readonly #stationDragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#stationDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = this.#stationDrag;
    this.#endStationDrag();
    if (drag.changed) void this.#saveStationOrder(drag.id);
  };

  #endStationDrag() {
    this.#stationScroll.stop();
    if (!this.#stationDrag) return;
    this.#stationDrag = undefined;
    releasePageCursor();
    document.removeEventListener("pointermove", this.#moveStationDrag);
    document.removeEventListener("pointerup", this.#dropStationDrag);
    document.removeEventListener("pointercancel", this.#dropStationDrag);
    document.removeEventListener("keydown", this.#stationDragKey, true);
  }
  #stationMenu(station: PrepStation) {
    return html`${
        station.active
          ? html`<button
              type="button"
              part="station-grip"
              data-test=${`drag-${station.id}`}
              aria-label=${format("prep.reorder_station", { name: station.name })}
              ?disabled=${this.busy}
              @pointerdown=${(event: PointerEvent) => this.#startStationDrag(event, station.id)}
              @keydown=${(event: KeyboardEvent) => {
                const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                if (!delta || this.busy) return;
                event.preventDefault();
                const order = this.#activeStationOrder();
                if (this.#moveStation(station.id, order.indexOf(station.id) + delta))
                  void this.#saveStationOrder(station.id);
              }}
            >
              <wt-icon name="grip"></wt-icon>
            </button>`
          : nothing
      }<wt-row-actions
        data-station-id=${station.id}
        data-test=${`station-menu-${station.id}`}
        label=${format("prep.row_actions", { name: station.name })}
      >
        <wt-button
          align="start"
          data-test=${`edit-${station.id}`}
          ?disabled=${this.busy}
          @click=${() => {
            this.stationEditBusy = false;
            this.stationEditRefusal = undefined;
            this.stationEdit = { token: {}, station };
          }}
          >${t("venue.edit")}</wt-button
        >
        ${
          station.active && !station.isDefault
            ? html`<wt-button
                align="start"
                data-test=${`make-default-${station.id}`}
                ?disabled=${this.busy}
                @click=${() =>
                  void this.#act(
                    () => this.api.setDefaultStation(station.id),
                    (error) => this.#defaultRefusal(error),
                  )}
                >${t("prep.make_default")}</wt-button
              >`
            : nothing
        }
        <wt-button
          align="start"
          data-test=${`${station.active ? "disable" : "enable"}-${station.id}`}
          ?disabled=${this.busy}
          @click=${() => this.#openStationAction({ kind: station.active ? "switch_off" : "switch_on", stationId: station.id })}
          >${t(station.active ? "prep.disable" : "prep.enable")}</wt-button
        >
      </wt-row-actions>`;
  }
  #stationOutputs(view: PrepStationsView) {
    return Object.fromEntries(
      view.stations.map((station) => {
        const printers = this.#printersOf(station.id).map(
          (id) => view.printers.find((printer) => printer.id === id)?.name ?? id,
        );
        return [
          station.id,
          {
            printedOn: printers.join(", ") || t("prep.no_printer"),
            shownOn: html`${screenDevices(view.devices, station.id)}
              <a href="/manage/devices">${t("prep.devices")}</a>`,
          },
        ];
      }),
    );
  }
  #printersOf(stationId: string): string[] {
    return this.view!.stationPrinters.filter((row) => row.stationId === stationId).map(
      (row) => row.printerId,
    );
  }
  async #saveStationEdit(
    token: object,
    sender: HTMLElementTagNameMap["prep-station-editor"],
    detail: StationEditorSave,
  ) {
    const edit = this.stationEdit;
    if (
      !edit ||
      !this.isConnected ||
      edit.token !== token ||
      this.stationEditBusy ||
      !this.view?.stations.some((station) => station.id === edit.station.id)
    )
      return;
    const run = ++this.#stationEditRun;
    const current = () =>
      this.isConnected && this.stationEdit?.token === token && this.#stationEditRun === run;
    this.stationEditBusy = true;
    this.stationEditRefusal = undefined;
    try {
      await this.api.updateStation(edit.station.id, detail);
    } catch (error) {
      if (!current()) return;
      this.stationEditRefusal = refusalOf(error);
      this.stationEditBusy = false;
      if (this.stationEditRefusal?.code === "printer.not_found") void this.#load();
      return;
    }
    if (!current()) return;
    this.stationEditBusy = false;
    await this.updateComplete;
    const shown = this.renderRoot.querySelector("prep-station-editor");
    // A render while the screen was away removes the editor, so its return draws a new one that
    // never sent this save and cannot answer saved(); that one closes unless the person has
    // changed it since.
    if (shown === sender ? shown.saved() : shown?.dirty === false) this.stationEdit = undefined;
    await this.#load();
  }
  #stationEditor() {
    const edit = this.stationEdit;
    if (!edit || !this.view) return nothing;
    const station =
      this.view.stations.find((candidate) => candidate.id === edit.station.id) ?? edit.station;
    const { token } = edit;
    // The load reads the printers through a route that needs printer.manage, so a loaded editable
    // screen's person holds it; a refusal of it still lands under Printers.
    const canManagePrinters = true;
    return keyed(
      token,
      html`<prep-station-editor
        .open=${true}
        .busy=${this.stationEditBusy}
        .station=${{
          id: station.id,
          name: station.name,
          active: station.active,
          showsRestOfOrder: station.showsRestOfOrder,
          printerIds: this.#printersOf(station.id),
        }}
        .printers=${this.view.printers}
        .canManagePrinters=${canManagePrinters}
        .refusal=${this.stationEditRefusal}
        @station-save=${(event: CustomEvent<StationEditorSave>) => {
          event.stopPropagation();
          void this.#saveStationEdit(
            token,
            event.currentTarget as HTMLElementTagNameMap["prep-station-editor"],
            event.detail,
          );
        }}
        @station-close=${(event: Event) => {
          event.stopPropagation();
          if (this.stationEdit?.token === token) this.stationEdit = undefined;
        }}
      ></prep-station-editor>`,
    );
  }
  #openStation() {
    this.#stationBaseline = undefined;
    this.stationAttempted = false;
    this.editor = { kind: "station" };
    this.draft = {
      name: "",
      displayOrder: 0,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      printerIds: [],
    };
    this.fieldError = {};
    this.#showError("");
  }
  #change(field: keyof StationInput | "printerIds", value: string | string[]) {
    this.draft = {
      ...this.draft,
      [field]: field === "name" || field === "printerIds" ? value : Number(value),
    };
    this.#stationScope?.changed();
    const refused = field === "printerIds" ? undefined : this.fieldError.printerIds;
    this.fieldError = {
      ...(this.stationAttempted ? this.#stationErrors() : { ...this.fieldError, [field]: "" }),
      ...(refused ? { printerIds: refused } : {}),
    };
    if (!refused) delete this.fieldError.printerIds;
    this.#showError(
      this.stationAttempted && Object.values(this.fieldError).some(Boolean)
        ? t("prep.fix_fields")
        : "",
    );
  }
  #stationErrors(): Record<string, string> {
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
    return errors;
  }
  async #saveStation() {
    if (saveActionState(this.#stationScope).unchanged) return;
    this.stationAttempted = true;
    const d = this.draft;
    const errors = this.#stationErrors();
    this.fieldError = errors;
    if (Object.keys(errors).length) {
      this.#showError(t("prep.fix_fields"));
      return;
    }
    if (this.busy) return;
    const identity = this.#stationIdentity;
    const scope = this.#stationScope;
    this.busy = true;
    this.#showError("");
    try {
      const { printerIds, ...station } = d;
      await this.api.createStation(printerIds.length > 0 ? d : station);
      if (!this.isConnected || identity !== this.#stationIdentity) return;
      this.#stationBaseline = { ...d };
      scope?.commit(d);
      if (!scope?.isDirty()) {
        this.renderRoot
          .querySelector<HTMLElementTagNameMap["wt-modal"]>("[data-test=save-station]")
          ?.closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")
          ?.closeAfter("saved");
        this.editor = undefined;
      }
      await this.#load();
    } catch (e) {
      if (!this.isConnected || identity !== this.#stationIdentity) return;
      const refusal = refusalOf(e);
      const field = stationRefusalField(refusal);
      if (field === "name") this.fieldError = { name: t("prep.name_taken") };
      else if (field === "printers")
        this.fieldError = {
          printerIds: t(
            refusal.code === "authorization.not_permitted"
              ? "prep.printers_not_permitted"
              : "prep.printers_refused",
          ),
        };
      this.#showError(t(field === undefined ? "prep.save_error" : "prep.fix_fields"));
      if (refusal.code === "printer.not_found") void this.#load();
    } finally {
      if (this.isConnected && (identity === this.#stationIdentity || !this.editor))
        this.busy = false;
    }
  }
  #times(id: string): StationTimes | undefined {
    return this.view?.routing.stationTimes.find((row) => row.stationId === id);
  }
  #stationNote(station: PrepStation) {
    if (!station.active) return t("prep.station_switched_off");
    const times = this.#times(station.id);
    if (!times) return nothing;
    if (!this.view?.routing.clockReadable) return t("prep.station_clock_unreadable");
    if (times.status.why !== "closed_by_hand") return nothing;
    return format("prep.station_closed_today", {
      station: times.closedSendsTo
        ? this.#stationName(times.closedSendsTo)
        : t("prep.station_no_replacement"),
    });
  }
  async #openStationAction(action: StationAction) {
    if (this.busy) return;
    const previous = this.#stationActionIdentity;
    const dialog = this.renderRoot.querySelector<StationDisableDialog>("station-disable-dialog");
    if (dialog && !(await dialog.allowReplacement())) return;
    if (!this.isConnected || previous !== this.#stationActionIdentity) return;
    this.#stationActionIdentity = {};
    this.stationAction = action;
    this.stationActionError = "";
  }
  #cancelStationAction() {
    if (!this.busy) this.stationAction = undefined;
  }
  #stationNamingCells(id: string): string[] {
    const model = this.view!.routing;
    return model.cells
      .filter((cell) => cell.target.kind === "station" && cell.target.stationId === id)
      .map(({ row, zoneId }) => {
        const product =
          row.kind === "product"
            ? model.products.find((product) => product.id === row.productId)
            : undefined;
        const name =
          row.kind === "all"
            ? t("routing.all_categories")
            : row.kind === "no_category"
              ? t("routing.no_category")
              : row.kind === "category"
                ? this.#path(row.categoryId)
                : [
                    product?.categoryId ? `${this.#path(product.categoryId)} › ` : "",
                    product?.name ?? row.productId,
                  ].join("");
        const zone =
          zoneId === null
            ? t("routing.every_zone")
            : (model.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId);
        return `${name} · ${zone}`;
      });
  }
  async #saveStationAction() {
    const action = this.stationAction;
    if (!action || action.kind !== "switch_on" || this.busy) return;
    const identity = this.#stationActionIdentity;
    const current = () => this.isConnected && identity === this.#stationActionIdentity;
    this.busy = true;
    this.stationActionError = "";
    try {
      await this.api.activateStation(action.stationId);
      if (!current()) return;
      this.stationAction = undefined;
      await this.#load();
    } catch (error) {
      if (!current()) return;
      this.stationActionError =
        codeOf(error) === "station.not_found"
          ? `${t("prep.save_error")} ${t("prep.station_not_found")}`
          : t("prep.save_error");
    } finally {
      if (current()) this.busy = false;
    }
  }
  #stationCard(s: PrepStation) {
    return html`<wt-card data-test=${`station-${s.id}`}
      ><h2>
        ${s.name} ${s.isDefault ? html`<span class="muted">${t("prep.default")}</span>` : nothing}
      </h2>
    </wt-card>`;
  }
  async #saveSettingsCell(identity: object | undefined) {
    if (saveActionState(this.#settingsScope).unchanged) return;
    const editor = this.settingsEditor;
    if (!editor || !this.#settingsCurrent(identity) || this.settingsBusy) return;
    const scope = this.#settingsScope;
    const submitted = this.#settingsValue(editor);
    this.settingsEditor = { ...editor, attempted: true };
    if (this.#settingsInvalid()) {
      await this.updateComplete;
      const table = this.renderRoot.querySelector<LitElement>(
        "wt-data-table[data-test=settings-table]",
      );
      if (table) await table.updateComplete;
      table?.shadowRoot
        ?.querySelector<HTMLElement>(
          '[data-test="settings-choice"], [data-test="settings-minutes"]',
        )
        ?.focus();
      return;
    }
    this.settingsBusy = true;
    this.settingsEditor = { ...editor, fieldError: "", error: "" };
    try {
      await this.api.updateStation(editor.stationId, {
        [editor.field]: editor.value.trim() === "" ? null : Number(editor.value),
      });
    } catch (error) {
      if (!this.#settingsCurrent(identity)) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: string } })?.params?.field;
      const fieldError = TIMING_FIELDS.includes(editor.field as TimingField)
        ? code === "station.thresholds_invalid" ||
          (code === "management.request_invalid" && field === editor.field)
          ? t("prep.threshold_invalid")
          : ""
        : code === "management.request_invalid" && field === "showsRestOfOrder"
          ? t("prep.save_error")
          : "";
      this.settingsEditor = {
        ...editor,
        fieldError,
        error: fieldError ? "" : t("prep.save_error"),
      };
      this.settingsBusy = false;
      return;
    }
    if (!this.#settingsCurrent(identity)) return;
    scope?.commit(submitted);
    this.settingsEditor = undefined;
    this.#syncSettingsDraft();
    this.settingsBusy = false;
    await this.#load();
  }
  #settingsInvalid() {
    const editor = this.settingsEditor;
    if (!editor?.attempted) return "";
    const station = this.view?.stations.find((s) => s.id === editor.stationId);
    if (!station) return t("prep.save_error");
    const value =
      editor.value.trim() === "" ? station.timingDefaults[editor.field] : Number(editor.value);
    const values = {
      warmAfterMinutes: station.warmAfterMinutes,
      overdueAfterMinutes: station.overdueAfterMinutes,
      forgottenAfterMinutes: station.forgottenAfterMinutes,
      [editor.field]: value,
    };
    return !Number.isInteger(value) ||
      value < 1 ||
      value > 2_147_483_647 ||
      values.warmAfterMinutes >= values.overdueAfterMinutes ||
      values.overdueAfterMinutes >= values.forgottenAfterMinutes
      ? t("prep.threshold_invalid")
      : "";
  }
  #timingCell(station: PrepStation, field: TimingField) {
    const label = `${station.name}: ${t(TIMING_LABELS[field])}`;
    const editor =
      this.settingsEditor?.stationId === station.id && this.settingsEditor.field === field
        ? this.settingsEditor
        : undefined;
    if (!editor)
      return html`<wt-button
        part=${station.timingOverrides[field] === null ? "inherited" : "timing-override"}
        data-test=${`edit-settings-${field}-${station.id}`}
        aria-label=${label}
        ?disabled=${this.settingsBusy}
        @click=${() => {
          this.#openSettings({
            stationId: station.id,
            field,
            value:
              station.timingOverrides[field] === null ? "" : String(station.timingOverrides[field]),
            fieldError: "",
            error: "",
            attempted: false,
          });
        }}
        >${station[field]}</wt-button
      >`;
    const identity = this.#settingsIdentity;
    const invalid = this.#settingsInvalid();
    return html`<div
      part="settings-cell"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape" && !this.settingsBusy) {
          event.preventDefault();
          event.stopPropagation();
          this.#cancelSettings("escape", identity);
        } else
          submitOnEnter(
            event,
            (event.currentTarget as HTMLElement).querySelector("[data-test=save-settings-cell]"),
          );
      }}
    >
      <wt-input
        data-test="settings-minutes"
        name=${field}
        label=${label}
        type="number"
        placeholder=${String(station.timingDefaults[field])}
        hint=${t("prep.inherit_minutes")}
        .value=${editor.value}
        .error=${invalid || editor.fieldError}
        .disabled=${this.settingsBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (!this.#settingsCurrent(identity) || this.settingsBusy) return;
          this.settingsEditor = { ...editor, value: event.detail.value, fieldError: "", error: "" };
          this.#settingsScope?.changed();
        }}
      ></wt-input>
      <wt-form-actions .error=${invalid || editor.fieldError ? t("prep.fix_fields") : editor.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-settings-cell"
          ?disabled=${this.settingsBusy}
          @click=${() => this.#cancelSettings("cancel", identity)}
          >${t("venue.cancel")}</wt-button
        >
        <wt-button
          data-test="save-settings-cell"
          variant=${saveActionState(this.#settingsScope).variant}
          ?disabled=${saveActionState(this.#settingsScope).unchanged || this.settingsBusy || !!invalid}
          @click=${() => void this.#saveSettingsCell(identity)}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }
  #settings() {
    const stations = [...this.view!.stations].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name),
    );
    const columns: DataTableColumn<PrepStation>[] = [
      {
        key: "name",
        label: t("prep.name"),
        cell: (station) =>
          html`<span part=${station.active ? "station-name" : "inherited"}
            >${station.name}${station.active ? "" : ` (${t("prep.health.disabled")})`}</span
          >`,
      },
      ...TIMING_FIELDS.map((field) => ({
        key: field,
        label: t(TIMING_LABELS[field]),
        cell: (station: PrepStation) => this.#timingCell(station, field),
      })),
    ];
    return html`<wt-data-table
      data-test="settings-table"
      label=${t("prep.tab.settings")}
      .columns=${columns}
      .rows=${stations}
      .rowKey=${(station: PrepStation) => station.id}
    ></wt-data-table>`;
  }
  #field(field: keyof StationInput, label: string, type = "number") {
    const identity = this.#stationIdentity;
    return html`<div>
      <wt-input
        data-test=${field === "overdueAfterMinutes" ? "overdue" : field}
        name=${field}
        label=${label}
        type=${type}
        required
        .value=${String(this.draft[field])}
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector("[data-test=save-station]"))}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          if (this.isConnected && identity === this.#stationIdentity)
            this.#change(field, e.detail.value);
        }}
      ></wt-input
      >${this.fieldError[field] ? html`<p class="error" data-field-error=${field} role="alert">${this.fieldError[field]}</p>` : nothing}
    </div>`;
  }
  #newStationPrinters() {
    const identity = this.#stationIdentity;
    const printerIds = this.draft.printerIds;
    const view = this.view!;
    return html`<wt-combobox
      name="printerIds"
      label=${t("prep.printers")}
      multiple
      .values=${printerIds}
      .options=${stationPrinterOptions(view.printers, printerIds)}
      .error=${this.fieldError.printerIds ?? ""}
      .countLabel=${() =>
        printerIds
          .map((id) => view.printers.find((printer) => printer.id === id)?.name ?? id)
          .join(", ")}
      .searchPlaceholder=${t("prep.printers")}
      .noResultsLabel=${t("venue.combobox_no_results")}
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
        event.stopPropagation();
        if (this.isConnected && identity === this.#stationIdentity)
          this.#change("printerIds", [...event.detail.values]);
      }}
    ></wt-combobox>`;
  }
  #dialog() {
    if (!this.editor || this.pending) return nothing;
    const editor = this.editor;
    return keyed(
      this.#stationIdentity,
      html`<wt-modal
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeAddClose}
        size="standard"
        open
        heading=${t("prep.new_station")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editor === editor && (event.currentTarget as HTMLElement).isConnected)
            this.editor = undefined;
        }}
        ><div class="form">
          ${this.#field("name", t("prep.name"), "text")}${this.#field("displayOrder", t("prep.order"))}${this.#field("warmAfterMinutes", t("prep.warm"))}${this.#field("overdueAfterMinutes", t("prep.overdue"))}${this.#field("forgottenAfterMinutes", t("prep.forgotten"))}${this.#newStationPrinters()}
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        </div>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            variant="secondary"
            @click=${(event: Event) => void (event.currentTarget as HTMLElement).closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.requestClose("cancel")}
            >${t("prep.cancel")}</wt-button
          ><wt-button
            data-test="save-station"
            variant=${saveActionState(this.#stationScope).variant}
            ?disabled=${saveActionState(this.#stationScope).unchanged || this.busy || (this.stationAttempted && Object.keys(this.#stationErrors()).length > 0)}
            @click=${() => void this.#saveStation()}
            >${t("prep.save")}</wt-button
          >
        </wt-form-actions></wt-modal
      >`,
    );
  }
  #selection: { model: RoutingModel; rules: RoutingSelectionRules } | undefined;
  /** "Drinks, Terrace: this changes Bar to Kitchen." — what the cell resolves to before and after. */
  #cellSentence(change: RoutingChange): string {
    const model = this.view!.routing;
    if (this.#selection?.model !== model) {
      this.#selection = { model, rules: selectionRulesFromModel(model) };
    }
    const { rules } = this.#selection;
    const { row, zoneId } = change.address;
    const product =
      row.kind === "product" ? model.products.find((p) => p.id === row.productId) : undefined;
    const categoryId = product?.categoryId ?? null;
    const before = selectRoutingCell(rules, row, zoneId, categoryId).target;
    const after =
      change.target ?? selectRoutingCell(rules, row, zoneId, categoryId, { skipOwn: true }).target;
    const name = (target: RouteTarget | null) =>
      target === null ? t("routing.no_station") : this.#targetName(target);
    return format("routing.preview_change", {
      row:
        row.kind === "all"
          ? t("routing.all_categories")
          : row.kind === "no_category"
            ? t("routing.no_category")
            : row.kind === "category"
              ? this.#path(row.categoryId)
              : [
                  categoryId === null ? "" : `${this.#path(categoryId)} › `,
                  product?.name ?? row.productId,
                ].join(""),
      zone:
        zoneId === null
          ? t("routing.every_zone")
          : (model.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId),
      from: name(before),
      to: name(after),
    });
  }
  /** The moved product, its dish for an extra, and the periods during which it moves. */
  #moveName(move: RoutingMove): string {
    const name = move.dish
      ? format("prep.preview_extra", { extra: move.productName, dish: move.dish.productName })
      : move.productName;
    if (move.periodIds === null || move.periodIds === undefined) return name;
    const during = new Set(move.periodIds);
    const periods = this.view!.routing.periods.filter((period) => during.has(period.id));
    const names = periods.map((period) => period.name);
    return format("prep.preview_during", {
      move: name,
      periods: periods
        .map((period) =>
          names.indexOf(period.name) === names.lastIndexOf(period.name)
            ? period.name
            : format("routing.period_in_department", {
                period: period.name,
                department: period.departmentName,
              }),
        )
        .join(", "),
    });
  }
  #previewDialog() {
    const pending = this.pending;
    if (!pending) return nothing;
    const unavailable = !this.#addressShown(pending.change.address);
    return html`<wt-modal
      size="wide"
      open
      .dismissible=${!this.busy}
      data-test="routing-preview"
      heading=${t("prep.preview_title")}
      @wt-close=${() => this.#cancelRouting()}
    >
      <p>${this.#cellSentence(pending.change)}</p>
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
                          <td>${this.#moveName(move)}</td>
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
      ${unavailable ? html`<p class="error" role="alert" data-test="routing-unavailable">${t("routing.target_unavailable")}</p>` : nothing}
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
          ?disabled=${this.busy || unavailable}
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
    const identity = this.#stationActionIdentity;
    const current = () =>
      this.isConnected &&
      this.stationAction !== undefined &&
      identity === this.#stationActionIdentity;
    if (action.kind === "switch_off")
      return keyed(
        identity,
        html`<station-disable-dialog
          .api=${this.api}
          .stationId=${action.stationId}
          .stationName=${station?.name ?? action.stationId}
          .namingCells=${this.#stationNamingCells(action.stationId)}
          @cancel=${(event: Event) => {
            event.stopPropagation();
            if (current()) this.stationAction = undefined;
          }}
          @disabled=${(event: Event) => {
            event.stopPropagation();
            if (!current()) return;
            this.stationAction = undefined;
            void this.#load();
          }}
        ></station-disable-dialog>`,
      );
    return keyed(
      identity,
      html`<wt-modal
        size="compact"
        open
        data-test="station-action-modal"
        heading=${t("prep.enable")}
        .dismissible=${!this.busy}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current() && event.target === event.currentTarget) this.#cancelStationAction();
        }}
      >
        ${this.stationActionError ? html`<p class="error" role="alert">${this.stationActionError}</p>` : nothing}
        ${html`<wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (!current()) return;
              this.#cancelStationAction();
            }}
            >${t("prep.cancel")}</wt-button
          ><wt-button
            data-test="confirm-station-action"
            ?disabled=${this.busy}
            @click=${() => {
              if (this.busy || !current()) return;
              void this.#saveStationAction();
            }}
            >${t("prep.confirm")}</wt-button
          ></wt-form-actions
        >`}
      </wt-modal>`,
    );
  }
  override render() {
    if (!this.isConnected) return nothing;
    const view = this.view;
    const active =
      view?.stations
        .filter((s) => s.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)) ?? [];
    const inactive = view?.stations.filter((station) => !station.active) ?? [];
    return html`<div class="toolbar">
        <h1>${t("prep.title")}</h1>
      </div>
      ${
        view
          ? html`<wt-tabs
              ?data-routes=${this.tab === "routing"}
              label=${t("prep.title")}
              .value=${this.tab}
              .items=${PREP_TABS.map((key) => ({ key, label: t(`prep.tab.${key}`) }))}
              @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
                if (event.target !== event.currentTarget) return;
                const tab = PREP_TABS.find((tab) => tab === event.detail.value);
                if (!tab || tab === this.tab) return;
                (event.currentTarget as HTMLElementTagNameMap["wt-tabs"]).value = this.tab;
                const proceed = () => {
                  this.tab = tab;
                  this.#url.write({ dashboard: "prep-stations", view: tab });
                };
                if (this.pending) this.#leaveCell("navigation", proceed);
                else if (this.tab === "settings" && this.settingsEditor)
                  this.#leaveSettings("navigation", this.#settingsIdentity, proceed);
                else proceed();
              }}
            >
              ${
                this.tab !== "stations"
                  ? nothing
                  : html`<div slot="actions">
                      <wt-button
                        @click=${() => this.#openStation()}
                        data-test="new-station"
                        aria-label=${t("prep.add_station")}
                        >${t("prep.add")}</wt-button
                      >
                    </div>`
              }
              <div slot="stations">
                <div
                  class="reorder-status"
                  data-test="station-order-status"
                  role="status"
                  aria-live="polite"
                >
                  ${this.stationAnnouncement}
                </div>
                <prep-station-table
                  .stations=${view.stations.map((station) => ({ ...station, displayOrder: this.stationOrder?.indexOf(station.id) ?? station.displayOrder }))}
                  .actions=${Object.fromEntries(view.stations.map((station) => [station.id, this.#stationMenu(station)]))}
                  .outputs=${this.#stationOutputs(view)}
                  .statusNotes=${Object.fromEntries(
                    view.stations.map((station) => {
                      const status = this.#stationNote(station);
                      return [station.id, status === nothing ? "" : status];
                    }),
                  )}
                ></prep-station-table>
              </div>
              <div slot="routing">
                <venue-routing-grid
                  .model=${view.routing}
                  .pending=${this.cellChoice}
                  .refusal=${this.cellRefusal}
                  .defaultRefusal=${this.defaultRefusal}
                  @routing-cell-change=${(event: CustomEvent<RoutingCellChange>) =>
                    void this.#chooseCell(event.detail)}
                  @routing-make-default=${(event: CustomEvent<{ stationId: string }>) =>
                    void this.#makeDefault(event.detail.stationId)}
                  @routing-draft-lost=${(event: CustomEvent<{ address: CellAddress }>) =>
                    this.#dropDraft(event.detail.address)}
                ></venue-routing-grid>
                <div class="cards">${active.map((s) => this.#stationCard(s))}</div>
                ${
                  inactive.length
                    ? html`<section>
                        <h2>${t("prep.disabled")}</h2>
                        ${inactive.map(
                          (station) =>
                            html`<wt-card data-test=${`inactive-${station.id}`}
                              ><h3>${station.name}</h3>
                              <p>
                                ${this.#times(station.id)?.closedSendsTo ? format("prep.off_goes_to", { station: this.#stationName(this.#times(station.id)!.closedSendsTo!) }) : t("prep.off_asks")}
                              </p>
                              <p>
                                ${this.#times(station.id)?.closedSendsTo ? t("prep.disabled_hint") : t("prep.disabled_no_replacement")}
                              </p>
                            </wt-card>`,
                        )}
                      </section>`
                    : nothing
                }
              </div>
              <div slot="settings">${this.#settings()}</div>
            </wt-tabs>`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.#dialog()}${this.#previewDialog()}${this.#stationActionDialog()}${this.#stationEditor()}`;
  }
}
