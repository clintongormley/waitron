import { QueryController, codeOf, currentLocale } from "@waitron/dashboard-kit";
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
  UrlStateController,
} from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import {
  cellKey,
  selectRoutingCell,
  targetKey,
  type CellAddress,
  type RouteTarget,
  type RoutingModel,
  type RoutingSelectionRules,
} from "../routing.js";
import type { RoutingChange, RoutingMove, StationTimes } from "../routing-types.js";
import { format } from "./hours-view.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
} from "./routing-client.js";
import "./routing-grid.js";
import {
  cellPeriodLines,
  routingLookups,
  rowInModel,
  type CellPeriodLines,
} from "./routing-grid-model.js";
import type {
  RoutingCellChange,
  RoutingDefaultRefusal,
  RoutingPending,
  RoutingRefusal,
} from "./routing-grid.js";
import { t } from "./strings.js";
import "./station-table.js";
import "./station-editor.js";
import "@waitron/ui/src/components/wt-colour-chooser.js";
import { stationColourChoices } from "./station-colour-choices.js";
import {
  refusalOf,
  listedPrinterIds,
  stationPrinterOptions,
  stationRefusalField,
  type StationEditorSave,
  type StationRefusal,
} from "./station-editor.js";
import "@waitron/ui/src/components/wt-delete-dialog.js";
import { firstUnusedStationColour, isStationColour, type DeleteImpact } from "@waitron/shared";
import { stationDeleteCopy, stationDeleteError } from "./station-delete-copy.js";

type StationAction = {
  stationId: string;
  impact: DeleteImpact | null;
  loading: boolean;
  readError: string;
  actionError: string;
  busy: boolean;
};

type Editor = { kind: "station" };
type NewStation = StationInput & { printerIds: string[] };
const PREP_TABS = ["stations", "routing"] as const;
type PrepTab = (typeof PREP_TABS)[number];
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
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-tabs::part(tablist) {
        flex-wrap: wrap;
      }
      wt-tabs::part(tab-actions) {
        max-width: 50%;
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
      .form {
        display: grid;
        gap: var(--wt-space-4);
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
  @state() private editor?: Editor;
  @state() private draft: NewStation = {
    name: "",
    colour: "red",
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
  @state() private tab: PrepTab = "stations";
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
      this.#url.write({ dashboard: "prep-stations", view: this.tab, station: null }, true);
    },
    {
      basePath: "/manage",
      primary: "dashboard",
      children: { "prep-stations": { view: "view", station: "station" }, "*": { view: "view" } },
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
  readonly #impactQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      const action = this.stationAction;
      if (!action) return;
      if (codeOf(error) === "station.not_found" && !action.busy) {
        this.#stationGone(action.stationId);
        return;
      }
      this.stationAction = { ...action, loading: false, readError: t("prep.delete_load_error") };
    },
  );
  #leave?: LeaveCoordinator;

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
    this.#closeStationAction();
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
            this.stationEdit &&
            !value.stations.some(
              (station) => station.active && station.id === this.stationEdit!.station.id,
            )
          ) {
            this.stationEdit = undefined;
            this.stationEditBusy = false;
            this.#stationEditRun++;
          }
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
  async #act(run: () => Promise<unknown>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.#showError("");
    try {
      await run();
      await this.#load();
      return true;
    } catch {
      this.#showError(t("prep.save_error"));
      return false;
    } finally {
      this.busy = false;
    }
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
      const message = t("prep.save_error");
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
  /** A product's own choice, or one that moves nothing, is saved at once; otherwise its preview asks first. */
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
    if (moves.length > 0 && change.address.row.kind !== "product") this.pending = pending;
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
  #stationMenu(station: PrepStation) {
    return html`<wt-row-actions
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
              @click=${() => void this.#act(() => this.api.setDefaultStation(station.id))}
              >${t("prep.make_default")}</wt-button
            >`
          : nothing
      }
      <wt-button
        align="start"
        data-test=${`delete-${station.id}`}
        ?disabled=${this.busy}
        @click=${() => void this.#openStationAction(station.id)}
        >${t("prep.delete")}</wt-button
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
              <a part="devices-link" href="/manage/devices">${t("prep.devices")}</a>`,
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
      if (codeOf(error) === "station.not_found") {
        this.#stationGone(edit.station.id);
        this.stationEditBusy = false;
        this.#showError(t("prep.station_not_found"));
        void this.#load();
        return;
      }
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
          colour: station.colour,
          active: station.active,
          showsRestOfOrder: station.showsRestOfOrder,
          printMovedSlips: station.printMovedSlips,
          printerIds: this.#printersOf(station.id),
          timingOverrides: station.timingOverrides,
          timingDefaults: station.timingDefaults,
        }}
        .printers=${this.view.printers}
        .stations=${this.#colourUsers()}
        .canManagePrinters=${canManagePrinters}
        .venuePrintsMovedSlips=${this.view.routing.printMovedSlips}
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
  #colourUsers() {
    return (this.view?.stations ?? [])
      .filter((station) => station.active)
      .map(({ id, name, colour }) => ({ id, name, colour }));
  }
  #openStation() {
    this.#stationBaseline = undefined;
    this.stationAttempted = false;
    this.editor = { kind: "station" };
    const used = this.#colourUsers().map(({ colour }) => colour);
    this.draft = {
      name: "",
      colour: firstUnusedStationColour(used),
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
      [field]:
        field === "name" || field === "colour" || field === "printerIds" ? value : Number(value),
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
      else if (field === "colour") this.fieldError = { colour: t("prep.colour_invalid") };
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
  #closeStationAction() {
    this.#impactQueries.release("delete-impact");
    this.stationAction = undefined;
    this.#stationActionIdentity = undefined;
  }
  #stationGone(id: string) {
    if (this.stationEdit?.station.id === id) this.stationEdit = undefined;
    if (this.view)
      this.view = {
        ...this.view,
        stations: this.view.stations.filter((station) => station.id !== id),
      };
    if (this.stationAction?.stationId === id) this.#closeStationAction();
  }
  async #openStationAction(id: string) {
    if (this.busy || this.stationAction?.busy) return;
    const previous = this.#stationActionIdentity;
    if (this.stationEdit?.station.id === id) {
      const opening = this.stationEdit.token;
      const modal = this.renderRoot
        .querySelector("prep-station-editor")
        ?.shadowRoot?.querySelector("wt-modal");
      if (modal && !(await modal.requestClose("navigation"))) return;
      if (this.stationEdit && this.stationEdit.token !== opening) return;
      this.stationEdit = undefined;
    }
    if (!this.isConnected || previous !== this.#stationActionIdentity) return;
    this.#closeStationAction();
    this.#stationActionIdentity = {};
    this.stationAction = {
      stationId: id,
      impact: null,
      loading: true,
      readError: "",
      actionError: "",
      busy: false,
    };
    this.#readStationImpact(this.#stationActionIdentity);
  }
  #readStationImpact(identity: object | undefined) {
    const action = this.stationAction;
    if (!action || action.busy || identity !== this.#stationActionIdentity) return;
    this.stationAction = { ...action, loading: true, readError: "" };
    void this.#impactQueries
      .watch(
        "delete-impact",
        {
          key: `venue-service:station-delete-impact:${action.stationId}`,
          dependencies: QUERY_DEPENDENCIES["station-delete-impact"].map((type) => ({ type })),
          read: () => this.api.getStationDeleteImpact(action.stationId),
        },
        (impact) => {
          if (!this.isConnected || identity !== this.#stationActionIdentity || !this.stationAction)
            return;
          if (impact.target.id !== action.stationId) throw new Error("Unexpected station");
          this.stationAction = { ...this.stationAction, impact, loading: false, readError: "" };
        },
      )
      .catch(() => undefined);
  }
  async #deleteStation(id: string, identity: object | undefined) {
    const action = this.stationAction;
    if (
      !this.isConnected ||
      identity !== this.#stationActionIdentity ||
      !action ||
      action.stationId !== id ||
      action.busy ||
      action.loading ||
      action.readError ||
      !action.impact ||
      action.impact.target.id !== id ||
      action.impact.refusals.length
    )
      return;
    this.stationAction = { ...action, busy: true, actionError: "" };
    try {
      await this.api.deleteStation(id);
    } catch (error) {
      if (!this.isConnected || identity !== this.#stationActionIdentity || !this.stationAction)
        return;
      if (codeOf(error) === "station.not_found") {
        this.#stationGone(id);
        this.#showError(t("prep.station_not_found"));
        void this.#load();
      } else {
        this.stationAction = {
          ...this.stationAction,
          busy: false,
          actionError: stationDeleteError(error),
        };
        if (
          ["station.is_default", "station.screen_in_use", "station.work_in_progress"].includes(
            codeOf(error),
          )
        )
          this.#readStationImpact(identity);
      }
      return;
    }
    if (!this.isConnected || identity !== this.#stationActionIdentity) return;
    this.#stationGone(id);
    await this.#load();
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
  #newStationColour() {
    const identity = this.#stationIdentity;
    return html`<wt-colour-chooser
      name="colour"
      label=${t("prep.colour")}
      required
      .value=${this.draft.colour}
      .choices=${stationColourChoices(this.#colourUsers())}
      .usedByLabel=${(colour: string, names: string) => format("prep.colour_used_by", { colour, stations: names })}
      .error=${this.fieldError.colour ?? ""}
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (
          this.isConnected &&
          identity === this.#stationIdentity &&
          isStationColour(event.detail.value)
        )
          this.#change("colour", event.detail.value);
      }}
    ></wt-colour-chooser>`;
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
          ${this.#field("name", t("prep.name"), "text")}${this.#newStationColour()}${this.#field("warmAfterMinutes", t("prep.warm"))}${this.#field("overdueAfterMinutes", t("prep.overdue"))}${this.#field("forgottenAfterMinutes", t("prep.forgotten"))}${this.#newStationPrinters()}
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
  #sentenceLookups:
    | {
        model: RoutingModel;
        locale: string;
        rules: RoutingSelectionRules;
        lines: ReturnType<typeof cellPeriodLines>;
      }
    | undefined;
  /** "Drinks, Terrace: this changes Bar to Kitchen (Lunch: Bar)." — the cell before and after. */
  #cellSentence(change: RoutingChange): string {
    const model = this.view!.routing;
    const locale = currentLocale();
    if (this.#sentenceLookups?.model !== model || this.#sentenceLookups.locale !== locale) {
      const lookups = routingLookups(model);
      this.#sentenceLookups = {
        model,
        locale,
        rules: lookups.rules,
        lines: cellPeriodLines(model, (target) => this.#targetName(target), lookups),
      };
    }
    const { rules, lines } = this.#sentenceLookups;
    const { row, zoneId } = change.address;
    const product =
      row.kind === "product" ? model.products.find((p) => p.id === row.productId) : undefined;
    const categoryId = product?.categoryId ?? null;
    const before = selectRoutingCell(rules, row, zoneId, categoryId).target;
    const after =
      change.target ?? selectRoutingCell(rules, row, zoneId, categoryId, { skipOwn: true }).target;
    const stored = model.cells.find((cell) => sameAddress(cell, change.address))?.periods ?? [];
    const value = (target: RouteTarget | null, { lines }: CellPeriodLines) => {
      const station = target === null ? t("routing.no_station") : this.#targetName(target);
      return lines.length === 0
        ? station
        : format("routing.preview_value_lines", {
            station,
            lines: lines.map((line) => line.text).join("; "),
          });
    };
    return format("routing.preview_change", {
      row: this.#rowName(row),
      zone:
        zoneId === null
          ? t("routing.every_zone")
          : (model.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId),
      from: value(before, lines(row, zoneId)),
      to: value(
        after,
        lines(row, zoneId, { target: change.target, periods: change.periods ?? stored }),
      ),
    });
  }
  #rowName(row: RoutingChange["address"]["row"]): string {
    const model = this.view!.routing;
    return row.kind === "all"
      ? t("routing.all_categories")
      : row.kind === "no_category"
        ? t("routing.no_category")
        : row.kind === "category"
          ? (model.categories.find((c) => c.id === row.categoryId)?.name ?? row.categoryId)
          : (model.products.find((p) => p.id === row.productId)?.name ?? row.productId);
  }
  /** In the model's order; the department is added only where two periods share a name. */
  #periodNames(periodIds: readonly string[]): string {
    const during = new Set(periodIds);
    const periods = this.view!.routing.periods.filter((period) => during.has(period.id));
    const names = periods.map((period) => period.name);
    return periods
      .map((period) =>
        names.indexOf(period.name) === names.lastIndexOf(period.name)
          ? period.name
          : format("routing.period_in_department", {
              period: period.name,
              department: period.departmentName,
            }),
      )
      .join(", ");
  }
  #moveFrom(move: RoutingMove): string {
    return move.from ? this.#targetName(move.from) : t("prep.no_station");
  }
  #moveTo(move: RoutingMove): string {
    return move.to
      ? this.#targetName(move.to)
      : t(move.toNoReplacement ? "prep.no_replacement" : "prep.no_station");
  }
  /** The moved product, its dish for an extra, and the periods during which it moves. */
  #moveName(move: RoutingMove): string {
    const name = move.dish
      ? format("prep.preview_extra", { extra: move.productName, dish: move.dish.productName })
      : move.variantOf
        ? format("prep.preview_variant", {
            product: move.variantOf.productName,
            variant: move.productName,
          })
        : move.productName;
    if (move.periodIds === null || move.periodIds === undefined) return name;
    return format("prep.preview_during", {
      move: name,
      periods: this.#periodNames(move.periodIds),
    });
  }
  /**
   * One sentence per zone, periods, from and to, counting products: a variant counts as its
   * product, and an extra once whatever dishes carry it.
   */
  #moveSummary(moves: readonly RoutingMove[], row: RoutingChange["address"]["row"]): string[] {
    const zoneOrder = new Map(this.view!.routing.zones.map((zone, index) => [zone.id, index]));
    const groups = new Map<
      string,
      { move: RoutingMove; periods: string | null; products: Set<string> }
    >();
    for (const move of moves) {
      const periods = move.periodIds ? this.#periodNames(move.periodIds) : null;
      const key = JSON.stringify([
        move.zoneId,
        move.periodIds ? [...move.periodIds].sort() : null,
        move.from,
        move.to,
        move.to === null && move.toNoReplacement,
      ]);
      const group = groups.get(key) ?? { move, periods, products: new Set<string>() };
      group.products.add(move.variantOf?.productId ?? move.productId);
      groups.set(key, group);
    }
    const zoneRank = ({ move }: { move: RoutingMove }) =>
      move.zoneId === null ? -1 : (zoneOrder.get(move.zoneId) ?? zoneOrder.size);
    return [...groups.values()]
      .sort(
        (a, b) =>
          zoneRank(a) - zoneRank(b) ||
          Number(a.periods !== null) - Number(b.periods !== null) ||
          this.#moveFrom(a.move).localeCompare(this.#moveFrom(b.move)) ||
          this.#moveTo(a.move).localeCompare(this.#moveTo(b.move)),
      )
      .map(({ move, periods, products }) =>
        format(
          products.size === 1
            ? periods === null
              ? "prep.preview_group_one"
              : "prep.preview_group_one_during"
            : periods === null
              ? "prep.preview_group_many"
              : "prep.preview_group_many_during",
          {
            row: this.#rowName(row),
            zone: move.zoneName ?? t("routing.every_zone"),
            from: this.#moveFrom(move),
            to: this.#moveTo(move),
            count: String(products.size),
            periods: periods ?? "",
          },
        ),
      );
  }
  #previewDialog() {
    const pending = this.pending;
    if (!pending) return nothing;
    const unavailable = !this.#addressShown(pending.change.address);
    return html`<wt-modal
      size="wide"
      height="medium"
      open
      .dismissible=${!this.busy}
      data-test="routing-preview"
      heading=${t("prep.preview_title")}
      @wt-close=${() => this.#cancelRouting()}
    >
      <p>${this.#cellSentence(pending.change)}</p>
      ${
        pending.moves.length
          ? html`${this.#moveSummary(pending.moves, pending.change.address.row).map(
                (sentence) => html`<p data-test="preview-group">${sentence}</p>`,
              )}
              <wt-disclosure heading=${t("prep.preview_show_products")}>
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
                      ${[...pending.moves]
                        .sort((a, b) =>
                          (a.variantOf?.productName ?? a.productName).localeCompare(
                            b.variantOf?.productName ?? b.productName,
                          ),
                        )
                        .map(
                          (move) =>
                            html`<tr>
                              <td>${this.#moveName(move)}</td>
                              <td>${move.zoneName ?? t("routing.every_zone")}</td>
                              <td>${this.#moveFrom(move)}</td>
                              <td>${this.#moveTo(move)}</td>
                            </tr>`,
                        )}
                    </tbody>
                  </table>
                </div>
              </wt-disclosure>`
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
    const identity = this.#stationActionIdentity;
    return keyed(
      identity,
      html`<wt-delete-dialog
        data-test="delete-station-dialog"
        .open=${true}
        .impact=${action.impact}
        .loading=${action.loading}
        .submitting=${action.busy}
        .readError=${action.readError}
        .actionError=${action.actionError}
        .copy=${stationDeleteCopy()}
        @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          void this.#deleteStation(event.detail.id, identity);
        }}
        @wt-delete-retry=${(event: Event) => {
          event.stopPropagation();
          this.#readStationImpact(identity);
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (identity === this.#stationActionIdentity && !this.stationAction?.busy)
            this.#closeStationAction();
        }}
      ></wt-delete-dialog>`,
    );
  }
  override render() {
    if (!this.isConnected) return nothing;
    const source = this.view;
    const view = source && {
      ...source,
      stations: source.stations.filter((station) => station.active),
    };
    return html`<div class="toolbar">
        <h1>${t("prep.title")}</h1>
      </div>
      ${
        view
          ? html`<wt-tabs
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
                  this.#url.write({ dashboard: "prep-stations", view: tab, station: null });
                };
                if (this.pending) this.#leaveCell("navigation", proceed);
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
                <prep-station-table
                  .stations=${view.stations}
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
              </div>
            </wt-tabs>`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.#dialog()}${this.#previewDialog()}${this.#stationActionDialog()}${this.#stationEditor()}`;
  }
}
