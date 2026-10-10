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
  WatcherInput,
} from "./routing-client.js";
import { type WatcherView } from "./watchers-seen.js";
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
  stationPrinterOptions,
  stationRefusalField,
  type StationEditorSave,
  type StationRefusal,
} from "./station-editor.js";

type StationAction =
  | { kind: "fallback" | "switch_off"; stationId: string; choice: string; confirming: boolean }
  | { kind: "switch_on"; stationId: string };

type Editor = { kind: "station" };
type NewStation = StationInput & { printerIds: string[] };
const PREP_TABS = ["stations", "routing", "watchers", "settings"] as const;
type PrepTab = (typeof PREP_TABS)[number];
const TIMING_FIELDS = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;
type TimingField = (typeof TIMING_FIELDS)[number];
const TIMING_LABELS = {
  warmAfterMinutes: "prep.warm",
  overdueAfterMinutes: "prep.overdue",
  forgottenAfterMinutes: "prep.forgotten",
} as const;
type WatcherCell = "follows" | "zones" | "pass";
const EVERY_MEMBER = "__every__";

type SettingsDraft = {
  stationId: string;
  field: "fallback" | TimingField;
  value: string;
  fieldError: string;
  error: string;
  confirming: boolean;
  attempted: boolean;
};
const sameAddress = (a: CellAddress, b: CellAddress) => cellKey(a) === cellKey(b);

function watcherInputErrors(input: WatcherInput) {
  return {
    name: input.name.trim() ? "" : t("venue.field_required"),
    stationIds: input.everyStation || input.stationIds.length ? "" : t("watchers.need_station"),
    zoneIds: input.everyZone || input.zoneIds.length ? "" : t("watchers.need_zone"),
  };
}

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
      /* The tabs keep half the row whatever the font's width (A424). */
      wt-tabs::part(tab-actions) {
        max-width: 50%;
      }
      wt-data-table::part(watcher-cell) {
        display: grid;
        gap: var(--wt-space-2);
        max-width: calc(var(--wt-tap-min) * 5);
        white-space: normal;
      }
      wt-data-table::part(inherited) {
        --wt-color-text: var(--wt-color-text-muted);
      }
      wt-data-table::part(disabled-station),
      wt-data-table::part(disabled-watcher-cell) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(disabled-watcher) {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
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
  @property({ type: Boolean }) readOnly = false;
  @state() private view?: PrepStationsView;
  @state() private settingsEditor?: SettingsDraft;
  @state() private settingsBusy = false;
  @state() private watcherPrinterEditor?: {
    watcherId: string;
    ids: string[];
    fieldError: string;
    error: string;
    conflictPrinterId?: string;
  };
  @state() private watcherPrinterBusy = false;
  @state() private watcherCellEditor?: {
    watcherId: string;
    field: WatcherCell;
    values: string[];
    attempted: boolean;
    fieldError: string;
    error: string;
  };
  @state() private watcherCellBusy = false;
  @state() private editor?: Editor;
  @state() private watcherRename?: {
    id: string;
    name: string;
    attempted: boolean;
    fieldError: string;
    error: string;
  };
  @state() private watcherRemoval?: WatcherView;
  @state() private watcherRemoveError = "";
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
  @state() private stationFieldError = "";
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
      this.tab =
        (this.readOnly ? (["stations"] as const) : PREP_TABS).find((tab) => tab === requested) ??
        "stations";
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
  #watcherRenameScope?: DraftScope<{ name: string }>;
  #watcherRenameIdentity?: object;
  #watcherCellScope?: DraftScope<string[]>;
  #watcherCellIdentity?: object;
  #watcherPrinterScope?: DraftScope<string[]>;
  #watcherPrinterIdentity?: object;
  #stationActionScope?: DraftScope<string>;
  #stationActionIdentity?: object;
  #stationActionBeforeClose?: (reason: LeaveReason) => Promise<boolean>;
  #settingsScope?: DraftScope<string>;
  #settingsIdentity?: object;
  #leave?: LeaveCoordinator;

  #settingsCurrent(identity: object | undefined): boolean {
    return this.isConnected && identity === this.#settingsIdentity;
  }
  #settingsValue(editor: SettingsDraft): string {
    if (editor.field === "fallback") return editor.value;
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
          if (this.settingsEditor)
            this.settingsEditor = { ...this.settingsEditor, value, confirming: false };
        },
      }).scope;
    }
  }
  #leaveSettings(reason: LeaveReason, identity: object | undefined, proceed: () => void): void {
    if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
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
    const action = this.stationAction;
    if (
      !action ||
      (action.kind !== "fallback" && action.kind !== "switch_off") ||
      (!this.#stationActionScope &&
        this.view?.stations.find((station) => station.id === action.stationId)?.isDefault)
    ) {
      this.#stationActionScope?.dispose();
      this.#stationActionScope = undefined;
    } else if (!this.#stationActionScope) {
      this.#stationActionIdentity ??= {};
      this.#leave ??= leaveCoordinatorFor(this);
      this.#stationActionScope = this.#leave?.register({
        id: this.#stationActionIdentity,
        current: () => {
          const current = this.stationAction;
          return current?.kind === "fallback" || current?.kind === "switch_off"
            ? current.choice
            : "";
        },
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (choice) => {
          const current = this.stationAction;
          if (current?.kind === "fallback" || current?.kind === "switch_off")
            this.stationAction = { ...current, choice, confirming: false };
        },
      });
    }
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
    if (!this.watcherRename) {
      this.#watcherRenameScope?.dispose();
      this.#watcherRenameScope = undefined;
      this.#watcherRenameIdentity = undefined;
    } else if (!this.#watcherRenameIdentity) {
      const id = (this.#watcherRenameIdentity = {});
      this.#leave ??= leaveCoordinatorFor(this);
      this.#watcherRenameScope = draftScopeFor(this, {
        id,
        current: () => ({ name: this.watcherRename!.name }),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.name.trim() === b.name.trim(),
        restore: (value) => {
          if (this.watcherRename) this.watcherRename = { ...this.watcherRename, name: value.name };
        },
      }).scope;
    }
  }

  #syncWatcherInlineDrafts(): void {
    for (const printers of [false, true]) {
      const editor = printers ? this.watcherPrinterEditor : this.watcherCellEditor;
      const scope = printers ? this.#watcherPrinterScope : this.#watcherCellScope;
      const identity = printers ? this.#watcherPrinterIdentity : this.#watcherCellIdentity;
      if (!editor) {
        scope?.dispose();
        if (printers) {
          this.#watcherPrinterScope = undefined;
          this.#watcherPrinterIdentity = undefined;
        } else {
          this.#watcherCellScope = undefined;
          this.#watcherCellIdentity = undefined;
        }
      } else if (!identity) {
        const id = {};
        this.#leave ??= leaveCoordinatorFor(this);
        const registered = draftScopeFor(this, {
          id,
          current: () =>
            printers ? this.watcherPrinterEditor!.ids : this.watcherCellEditor!.values,
          snapshot: (ids) => [...ids],
          equal: (a, b) => a.length === b.length && a.every((value) => b.includes(value)),
          restore: (values) => {
            if (printers && this.watcherPrinterEditor)
              this.watcherPrinterEditor = { ...this.watcherPrinterEditor, ids: [...values] };
            else if (!printers && this.watcherCellEditor)
              this.watcherCellEditor = { ...this.watcherCellEditor, values: [...values] };
          },
        }).scope;
        if (printers) {
          this.#watcherPrinterIdentity = id;
          this.#watcherPrinterScope = registered;
        } else {
          this.#watcherCellIdentity = id;
          this.#watcherCellScope = registered;
        }
      }
    }
  }
  #watcherInlineCurrent(printers: boolean, identity: object | undefined): boolean {
    return (
      this.isConnected &&
      identity === (printers ? this.#watcherPrinterIdentity : this.#watcherCellIdentity)
    );
  }
  #leaveWatcherInline(
    printers: boolean,
    reason: LeaveReason,
    identity: object | undefined,
    proceed: () => void,
  ): void {
    if (
      !this.#watcherInlineCurrent(printers, identity) ||
      (printers ? this.watcherPrinterBusy : this.watcherCellBusy)
    )
      return;
    const scope = printers ? this.#watcherPrinterScope : this.#watcherCellScope;
    if (!scope || !this.#leave) {
      proceed();
      return;
    }
    void this.#leave!.request({
      scopes: [scope.id],
      reason,
      proceed: () => {
        if (this.#watcherInlineCurrent(printers, identity)) proceed();
      },
    });
  }
  #openWatcherCell(watcher: WatcherView, field: WatcherCell): void {
    this.#leaveWatcherInline(false, "navigation", this.#watcherCellIdentity, () => {
      this.#watcherCellScope?.dispose();
      this.#watcherCellScope = undefined;
      this.#watcherCellIdentity = undefined;
      this.watcherCellEditor = {
        watcherId: watcher.id,
        field,
        attempted: false,
        fieldError: "",
        error: "",
        values:
          field === "pass"
            ? [watcher.runsPass ? "yes" : "no"]
            : field === "follows"
              ? watcher.everyStation
                ? [EVERY_MEMBER]
                : [...watcher.stationIds]
              : watcher.everyZone
                ? [EVERY_MEMBER]
                : [...watcher.zoneIds],
      };
    });
  }
  #openWatcherPrinters(watcher: WatcherView): void {
    this.#leaveWatcherInline(true, "navigation", this.#watcherPrinterIdentity, () => {
      this.#watcherPrinterScope?.dispose();
      this.#watcherPrinterScope = undefined;
      this.#watcherPrinterIdentity = undefined;
      this.watcherPrinterEditor = {
        watcherId: watcher.id,
        ids: [...watcher.printerIds],
        fieldError: "",
        error: "",
      };
    });
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
    this.#syncWatcherInlineDrafts();
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
    if (changed.has("readOnly") && this.readOnly) {
      this.tab = "stations";
      if (this.#url.read("dashboard") === "prep-stations")
        this.#url.write({ dashboard: "prep-stations", view: "stations" }, true);
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
    this.#stationEditRun++;
    if (
      this.#stationIdentity ||
      this.pending !== undefined ||
      this.cellChoice !== null ||
      this.stationAction !== undefined ||
      this.#watcherRenameIdentity
    )
      this.busy = false;
    this.stationAction = undefined;
    this.#stationActionScope?.dispose();
    this.#stationActionScope = undefined;
    this.#stationActionIdentity = undefined;
    this.watcherCellEditor = undefined;
    this.watcherPrinterEditor = undefined;
    this.watcherCellBusy = false;
    this.watcherPrinterBusy = false;
    this.settingsEditor = undefined;
    this.settingsBusy = false;
    this.#settingsScope?.dispose();
    this.#settingsScope = undefined;
    this.#settingsIdentity = undefined;
    this.#watcherCellScope?.dispose();
    this.#watcherPrinterScope?.dispose();
    this.#watcherCellScope = undefined;
    this.#watcherPrinterScope = undefined;
    this.#watcherCellIdentity = undefined;
    this.#watcherPrinterIdentity = undefined;
    this.watcherRename = undefined;
    this.#watcherRenameScope?.dispose();
    this.#watcherRenameScope = undefined;
    this.#watcherRenameIdentity = undefined;
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
          const editor = this.watcherPrinterEditor;
          if (
            editor?.conflictPrinterId &&
            !value.stationPrinters.some((row) => editor.ids.includes(row.printerId))
          ) {
            this.watcherPrinterEditor = { ...editor, fieldError: "", conflictPrinterId: undefined };
          }
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
          @click=${() => (station.active ? this.#openFallback(station.id, "switch_off") : this.#openStationAction({ kind: "switch_on", stationId: station.id }))}
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
  async #saveStationEdit(token: object, detail: StationEditorSave) {
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
      return;
    }
    if (!current()) return;
    this.stationEditBusy = false;
    await this.updateComplete;
    if (this.renderRoot.querySelector("prep-station-editor")?.saved()) this.stationEdit = undefined;
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
        .watchers=${this.view.watchers}
        .canManagePrinters=${canManagePrinters}
        .refusal=${this.stationEditRefusal}
        @station-save=${(event: CustomEvent<StationEditorSave>) => {
          event.stopPropagation();
          void this.#saveStationEdit(token, event.detail);
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
    } finally {
      if (this.isConnected && (identity === this.#stationIdentity || !this.editor))
        this.busy = false;
    }
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
    if (row.nextTransition) {
      const next = row.nextTransition;
      const day =
        next.daysAhead === 0
          ? ""
          : next.daysAhead === 1
            ? ` ${t("prep.tomorrow")}`
            : ` ${format("prep.on_weekday", { day: t(`venue.day.${next.weekday}` as "venue.day.0") })}`;
      return format(row.status.open ? "prep.open_until" : "prep.scheduled_opens", {
        time: next.timeOfDay,
        day,
      });
    }
    if (row.status.open) return t("prep.open_now");
    return format("prep.closed_hours", { destination });
  }
  #todayCell(station: PrepStation) {
    const times = this.#times(station.id);
    if (!times) return nothing;
    if (!station.active) return t("prep.health.disabled");
    if (!this.view?.routing.clockReadable) return t("prep.clock_unreadable");
    if (station.isDefault || times.status.why === "no_hours") return t("prep.always_open");
    return this.#stationStatus(station);
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
          label: row.active ? row.name : `${row.name} ${t("prep.disabled_option")}`,
        })),
    ];
  }
  #openStationAction(action: StationAction) {
    if (this.busy) return;
    const previous = this.#stationActionIdentity;
    const proceed = () => {
      if (!this.isConnected || previous !== this.#stationActionIdentity) return;
      this.#stationActionScope?.dispose();
      this.#stationActionScope = undefined;
      const identity = (this.#stationActionIdentity = {});
      this.#stationActionBeforeClose = (reason) => this.#beforeStationActionClose(reason, identity);
      this.stationAction = action;
      this.stationActionError = "";
      this.stationFieldError = "";
    };
    if (!this.#stationActionScope) proceed();
    else
      void this.#leave!.request({
        scopes: [this.#stationActionScope.id],
        reason: "navigation",
        proceed,
      });
  }
  #cancelStationAction() {
    if (!this.busy) this.stationAction = undefined;
  }
  async #beforeStationActionClose(reason: LeaveReason, identity: object | undefined) {
    if (this.busy || identity !== this.#stationActionIdentity) return false;
    const scope = this.#stationActionScope;
    if (!scope) return true;
    const outcome = await this.#leave!.request({ scopes: [scope.id], reason, proceed() {} });
    return identity === this.#stationActionIdentity && outcome === "proceeded";
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
  async #saveStationAction() {
    const action = this.stationAction;
    if (!action || this.busy) return;
    const identity = this.#stationActionIdentity;
    const scope = this.#stationActionScope;
    const current = () => this.isConnected && identity === this.#stationActionIdentity;
    this.busy = true;
    this.stationActionError = "";
    this.stationFieldError = "";
    let fallbackSaved = false;
    try {
      if (action.kind === "fallback" || action.kind === "switch_off") {
        const choice = action.choice || null;
        if (choice !== this.#times(action.stationId)?.fallbackStationId) {
          await this.api.setStationFallback(action.stationId, choice);
          fallbackSaved = true;
        }
        if (!current()) return;
        scope?.commit(action.choice);
        if (action.kind === "switch_off") await this.api.deactivateStation(action.stationId);
      }
      if (action.kind === "switch_on") await this.api.activateStation(action.stationId);
      if (!current()) return;
      if (!scope?.isDirty()) this.stationAction = undefined;
      await this.#load();
    } catch (e) {
      if (!current()) return;
      if (fallbackSaved) await this.#load();
      if (!current()) return;
      const code = codeOf(e);
      if (code === "station.fallback_loop" || code === "route.station_inactive")
        this.stationFieldError = t(
          code === "station.fallback_loop" ? "prep.fallback_loop" : "prep.station_disabled",
        );
      else
        this.stationActionError =
          code === "station.not_found"
            ? `${t("prep.save_error")} ${t("prep.station_not_found")}`
            : t(code === "time_zone.unreadable" ? "prep.time_zone_unreadable" : "prep.save_error");
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
  async #saveWatcherPrinters(identity: object | undefined) {
    if (saveActionState(this.#watcherPrinterScope).unchanged) return;
    const editor = this.watcherPrinterEditor;
    if (!editor || this.watcherPrinterBusy || !this.#watcherInlineCurrent(true, identity)) return;
    const scope = this.#watcherPrinterScope;
    const submitted = [...editor.ids];
    this.watcherPrinterBusy = true;
    this.watcherPrinterEditor = { ...editor, fieldError: "", error: "" };
    this.#showError("");
    try {
      await this.api.setWatcherPrinters(editor.watcherId, submitted);
      scope?.commit(submitted);
    } catch (error) {
      if (!this.#watcherInlineCurrent(true, identity)) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: string } })?.params?.field;
      const fieldRefusal =
        code === "printer.not_found" ||
        code === "printer.makes_and_watches" ||
        (code === "management.request_invalid" && field === "printerIds");
      this.watcherPrinterEditor = {
        ...this.watcherPrinterEditor!,
        fieldError: fieldRefusal ? t("watchers.printer_refused") : "",
        conflictPrinterId:
          code === "printer.makes_and_watches"
            ? (error as { params?: { id?: string } }).params?.id
            : undefined,
        error: fieldRefusal
          ? ""
          : t(code === "watcher.not_found" ? "watchers.not_found" : "prep.save_error"),
      };
      this.watcherPrinterBusy = false;
      return;
    }
    if (!this.#watcherInlineCurrent(true, identity)) return;
    if (!scope?.isDirty()) this.watcherPrinterEditor = undefined;
    this.watcherPrinterBusy = false;
    await this.#load();
  }
  #watcherPrinterCell(watcher: WatcherView) {
    const view = this.view!;
    const names =
      watcher.printerIds
        .map((id) => view.printers.find((printer) => printer.id === id)?.name ?? id)
        .join(", ") || t("prep.none");
    if (!watcher.active)
      return html`<span part="disabled-watcher-cell" data-test=${`watcher-printers-${watcher.id}`}
        >${names}</span
      >`;
    const editor =
      this.watcherPrinterEditor?.watcherId === watcher.id ? this.watcherPrinterEditor : undefined;
    if (!editor)
      return html`<wt-button
        variant="secondary"
        data-test=${`edit-watcher-printers-${watcher.id}`}
        aria-label=${`${watcher.name}: ${t("watchers.printers")}`}
        ?disabled=${this.watcherPrinterBusy}
        @click=${() => this.#openWatcherPrinters(watcher)}
        >${names}</wt-button
      >`;
    const identity = this.#watcherPrinterIdentity;
    const options = view.printers.map((printer) => {
      const stations = view.stationPrinters
        .filter((mapping) => mapping.printerId === printer.id)
        .map((mapping) => this.#stationName(mapping.stationId));
      const owner = view.watchers.find(
        (row) =>
          row.id !== watcher.id &&
          (row.printerIds.includes(printer.id) || row.id === printer.watcherId),
      );
      return {
        value: printer.id,
        label: printer.name,
        disabled:
          (printer.active === false || stations.length > 0) && !editor.ids.includes(printer.id),
        description:
          printer.active === false
            ? t("prep.health.disabled")
            : stations.length
              ? format("watchers.station_printer", { name: stations.join(", ") })
              : owner
                ? format("prep.tickets.watcher_printer", { name: owner.name })
                : undefined,
      };
    });
    return html`<div part="watcher-cell">
      <wt-combobox
        multiple
        name="printerIds"
        data-test=${`watcher-printers-${watcher.id}`}
        label=${`${watcher.name}: ${t("watchers.printers")}`}
        .options=${options}
        .values=${editor.ids}
        .disabled=${this.watcherPrinterBusy}
        .error=${editor.fieldError}
        .searchPlaceholder=${t("watchers.printers")}
        .noResultsLabel=${t("venue.combobox_no_results")}
        .countLabel=${(count: number) => format("prep.tickets.printer_count", { count: String(count) })}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          if (!this.#watcherInlineCurrent(true, identity)) return;
          this.watcherPrinterEditor = {
            ...editor,
            ids: event.detail.values,
            conflictPrinterId: undefined,
            fieldError: "",
            error: "",
          };
          this.#watcherPrinterScope?.changed();
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !this.watcherPrinterBusy) {
            event.preventDefault();
            event.stopPropagation();
            this.#leaveWatcherInline(true, "escape", identity, () => {
              this.watcherPrinterEditor = undefined;
            });
          }
        }}
      ></wt-combobox>
      <wt-form-actions
        data-test=${`watcher-printer-actions-${watcher.id}`}
        .error=${[editor.fieldError ? t("watchers.fix_fields") : "", editor.error].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test=${`cancel-watcher-printers-${watcher.id}`}
          ?disabled=${this.watcherPrinterBusy}
          @click=${() => {
            this.#leaveWatcherInline(true, "cancel", identity, () => {
              this.watcherPrinterEditor = undefined;
            });
          }}
          >${t("venue.cancel")}</wt-button
        >
        <wt-button
          data-test=${`save-watcher-printers-${watcher.id}`}
          variant=${saveActionState(this.#watcherPrinterScope).variant}
          ?disabled=${saveActionState(this.#watcherPrinterScope).unchanged || this.watcherPrinterBusy}
          @click=${() => void this.#saveWatcherPrinters(identity)}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }
  #watcherInput(watcher: WatcherView, applyDraft = true): WatcherInput {
    const input = {
      name: watcher.name,
      everyStation: watcher.everyStation,
      stationIds: [...watcher.stationIds],
      everyZone: watcher.everyZone,
      zoneIds: [...watcher.zoneIds],
      runsPass: watcher.runsPass,
      displayOrder: watcher.displayOrder,
    };
    const editor = this.watcherCellEditor;
    if (!applyDraft || !editor || editor.watcherId !== watcher.id) return input;
    if (editor.field === "pass") return { ...input, runsPass: editor.values[0] === "yes" };
    const every = editor.values.includes(EVERY_MEMBER);
    const ids = every ? [] : editor.values;
    return editor.field === "follows"
      ? { ...input, everyStation: every, stationIds: ids }
      : { ...input, everyZone: every, zoneIds: ids };
  }
  #watcherCellError(watcher: WatcherView) {
    const editor = this.watcherCellEditor;
    if (!editor?.attempted) return "";
    const errors = watcherInputErrors(this.#watcherInput(watcher));
    return editor.field === "follows"
      ? errors.stationIds
      : editor.field === "zones"
        ? errors.zoneIds
        : "";
  }
  async #saveWatcherCell(identity: object | undefined) {
    if (saveActionState(this.#watcherCellScope).unchanged) return;
    const editor = this.watcherCellEditor;
    if (!editor || this.watcherCellBusy || !this.#watcherInlineCurrent(false, identity)) return;
    const scope = this.#watcherCellScope;
    const submitted = [...editor.values];
    const watcher = this.view!.watchers.find((row) => row.id === editor.watcherId);
    if (!watcher) return;
    this.watcherCellEditor = { ...editor, attempted: true, fieldError: "", error: "" };
    if (this.#watcherCellError(watcher)) {
      await this.updateComplete;
      this.shadowRoot!.querySelector('[data-test="watchers-table"]')
        ?.shadowRoot?.querySelector<HTMLElement>('[data-test="watcher-cell-input"]')
        ?.focus();
      return;
    }
    const input = this.#watcherInput(watcher);
    this.watcherCellBusy = true;
    this.#showError("");
    try {
      await this.api.updateWatcher(watcher.id, input);
      scope?.commit(submitted);
    } catch (error) {
      if (!this.#watcherInlineCurrent(false, identity)) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: string } })?.params?.field;
      const fieldError =
        editor.field === "follows" &&
        (code === "station.not_found" ||
          (code === "management.request_invalid" && field === "stationIds"))
          ? t("watchers.need_station")
          : editor.field === "zones" &&
              (code === "zone.not_found" ||
                (code === "management.request_invalid" && field === "zoneIds"))
            ? t("watchers.need_zone")
            : "";
      this.watcherCellEditor = {
        ...this.watcherCellEditor!,
        attempted: true,
        fieldError,
        error: fieldError
          ? ""
          : t(code === "watcher.not_found" ? "watchers.not_found" : "prep.save_error"),
      };
      this.watcherCellBusy = false;
      return;
    }
    if (!this.#watcherInlineCurrent(false, identity)) return;
    if (!scope?.isDirty()) this.watcherCellEditor = undefined;
    this.watcherCellBusy = false;
    await this.#load();
  }
  #watcherChoiceCell(watcher: WatcherView, field: WatcherCell) {
    const view = this.view!;
    const label = t(
      field === "follows"
        ? "watchers.follows_column"
        : field === "zones"
          ? "watchers.zones_column"
          : "watchers.runs_pass",
    );
    const follows = watcher.everyStation
      ? t("watchers.every_station")
      : view.stations
          .filter((row) => row.active && watcher.stationIds.includes(row.id))
          .map((row) => row.name)
          .join(", ");
    const zones = watcher.everyZone
      ? t("watchers.every_zone")
      : view.zones
          .filter((row) => row.active !== false && watcher.zoneIds.includes(row.id))
          .map((row) => row.name)
          .join(", ");
    const text =
      field === "follows"
        ? follows
        : field === "zones"
          ? zones
          : t(watcher.runsPass ? "venue.yes" : "venue.no");
    if (!watcher.active)
      return html`<span part="disabled-watcher-cell" data-test=${`watcher-${field}-${watcher.id}`}
        >${text}</span
      >`;
    const editor =
      this.watcherCellEditor?.watcherId === watcher.id && this.watcherCellEditor.field === field
        ? this.watcherCellEditor
        : undefined;
    if (!editor)
      return html`<wt-button
        variant="secondary"
        data-test=${`edit-watcher-${field}-${watcher.id}`}
        aria-label=${`${watcher.name}: ${label}`}
        ?disabled=${this.watcherCellBusy}
        @click=${() => this.#openWatcherCell(watcher, field)}
        >${text || t("prep.none")}</wt-button
      >`;
    const identity = this.#watcherCellIdentity;
    const options =
      field === "pass"
        ? [
            { value: "yes", label: t("venue.yes") },
            { value: "no", label: t("venue.no") },
          ]
        : [
            {
              value: EVERY_MEMBER,
              label: t(
                field === "follows"
                  ? "watchers.choose_every_station"
                  : "watchers.choose_every_zone",
              ),
            },
            ...(field === "follows" ? view.stations : view.zones)
              .filter((row) => row.active !== false)
              .map((row) => ({ value: row.id, label: row.name })),
          ];
    const invalid = this.#watcherCellError(watcher);
    const fieldError = invalid || editor.fieldError;
    return html`<div part="watcher-cell">
      <wt-combobox
        data-test="watcher-cell-input"
        name=${field === "follows" ? "stationIds" : field === "zones" ? "zoneIds" : "runsPass"}
        label=${`${watcher.name}: ${label}`}
        .required=${field !== "pass"}
        .multiple=${field !== "pass"}
        .options=${options}
        .values=${editor.values}
        .value=${editor.values[0] ?? ""}
        .error=${fieldError}
        .disabled=${this.watcherCellBusy}
        .countLabel=${(count: number) => format("watchers.selection_count", { count: String(count) })}
        .searchPlaceholder=${label}
        .noResultsLabel=${t("venue.combobox_no_results")}
        @wt-change=${(event: CustomEvent<{ values: string[]; value: string }>) => {
          event.stopPropagation();
          if (!this.#watcherInlineCurrent(false, identity)) return;
          let values = field === "pass" ? [event.detail.value] : event.detail.values;
          if (values.includes(EVERY_MEMBER) && values.length > 1)
            values = editor.values.includes(EVERY_MEMBER)
              ? values.filter((id) => id !== EVERY_MEMBER)
              : [EVERY_MEMBER];
          this.watcherCellEditor = {
            ...this.watcherCellEditor!,
            values,
            fieldError: "",
            error: "",
          };
          this.#watcherCellScope?.changed();
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !this.watcherCellBusy) {
            event.preventDefault();
            event.stopPropagation();
            this.#leaveWatcherInline(false, "escape", identity, () => {
              this.watcherCellEditor = undefined;
            });
          }
        }}
      ></wt-combobox
      ><wt-form-actions
        .error=${[fieldError ? t("watchers.fix_fields") : "", editor.error].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-watcher-cell"
          ?disabled=${this.watcherCellBusy}
          @click=${() => {
            this.#leaveWatcherInline(false, "cancel", identity, () => {
              this.watcherCellEditor = undefined;
            });
          }}
          >${t("venue.cancel")}</wt-button
        >
        <wt-button
          data-test="save-watcher-cell"
          variant=${saveActionState(this.#watcherCellScope).variant}
          ?disabled=${saveActionState(this.#watcherCellScope).unchanged || this.watcherCellBusy || !!invalid}
          @click=${() => void this.#saveWatcherCell(identity)}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }
  async #saveSettingsCell(identity: object | undefined) {
    if (saveActionState(this.#settingsScope).unchanged) return;
    const editor = this.settingsEditor;
    if (!editor || !this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
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
      if (editor.field === "fallback") {
        const choice = editor.value || null;
        if (choice !== this.#times(editor.stationId)?.fallbackStationId)
          await this.api.setStationFallback(editor.stationId, choice);
      } else
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
        : code === "station.fallback_loop"
          ? t("prep.fallback_loop")
          : code === "route.station_inactive"
            ? t("prep.station_disabled")
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
    if (editor.field === "fallback") return "";
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
  #fallbackCell(station: PrepStation) {
    const label = t("prep.when_closed");
    if (station.isDefault)
      return html`<span data-test=${`settings-fallback-${station.id}`}
        >${t("prep.never_closes")}</span
      >`;
    const value = this.#times(station.id)?.fallbackStationId ?? "";
    const text = value ? this.#stationName(value) : t("prep.no_replacement_choice");
    const editor =
      this.settingsEditor?.stationId === station.id && this.settingsEditor.field === "fallback"
        ? this.settingsEditor
        : undefined;
    if (!editor)
      return html`<wt-button
        variant="secondary"
        data-test=${`edit-settings-fallback-${station.id}`}
        aria-label=${`${station.name}: ${label}`}
        ?disabled=${this.settingsBusy}
        @click=${() => {
          this.#openSettings({
            stationId: station.id,
            field: "fallback",
            value,
            fieldError: "",
            error: "",
            confirming: false,
            attempted: false,
          });
        }}
        >${text}</wt-button
      >`;
    const identity = this.#settingsIdentity;
    const invalid = this.#settingsInvalid();
    return html`<div
      part="watcher-cell"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape" && !this.settingsBusy) {
          event.preventDefault();
          event.stopPropagation();
          this.#cancelSettings("escape", identity);
        }
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLElement &&
          event.target.tagName !== "WT-COMBOBOX"
        )
          submitOnEnter(
            event,
            (event.currentTarget as HTMLElement).querySelector("[data-test=save-settings-cell]"),
          );
      }}
    >
      <wt-combobox
        data-test="settings-choice"
        name="fallbackStationId"
        label=${`${station.name}: ${label}`}
        .options=${this.#fallbackOptions(station.id)}
        .value=${editor.value}
        .error=${invalid || editor.fieldError}
        .disabled=${this.settingsBusy}
        .placeholder=${t("prep.no_replacement_choice")}
        .searchPlaceholder=${t("prep.search_stations")}
        .noResultsLabel=${t("venue.combobox_no_results")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
          this.settingsEditor = {
            ...editor,
            value: event.detail.value,
            fieldError: "",
            error: "",
            confirming: false,
          };
          this.#settingsScope?.changed();
        }}
      ></wt-combobox>

      ${editor.confirming ? html`<p data-test="settings-fallback-confirmation">${this.#fallbackConfirmation({ kind: "fallback", stationId: station.id, choice: editor.value, confirming: true })}</p>` : nothing}
      <wt-form-actions
        .error=${invalid || editor.fieldError ? t("watchers.fix_fields") : editor.error}
      >
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
          @click=${() => {
            if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
            if (saveActionState(this.#settingsScope).unchanged) return;
            if (!editor.confirming) this.settingsEditor = { ...editor, confirming: true };
            else void this.#saveSettingsCell(identity);
          }}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
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
            confirming: false,
            attempted: false,
          });
        }}
        >${station[field]}</wt-button
      >`;
    const identity = this.#settingsIdentity;
    const invalid = this.#settingsInvalid();
    return html`<div
      part="watcher-cell"
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
          if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
          this.settingsEditor = { ...editor, value: event.detail.value, fieldError: "", error: "" };
          this.#settingsScope?.changed();
        }}
      ></wt-input>
      <wt-form-actions
        .error=${invalid || editor.fieldError ? t("watchers.fix_fields") : editor.error}
      >
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
      {
        key: "fallback",
        label: t("prep.when_closed"),
        cell: (station) => this.#fallbackCell(station),
      },
    ];
    return html`<wt-data-table
      data-test="settings-table"
      label=${t("prep.tab.settings")}
      .columns=${columns}
      .rows=${stations}
      .rowKey=${(station: PrepStation) => station.id}
    ></wt-data-table>`;
  }
  #watchers() {
    const view = this.view!;
    const inOrder = (watchers: readonly WatcherView[]) =>
      [...watchers].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    const ordered = [...inOrder(view.watchers), ...inOrder(view.disabledWatchers)];
    const columns: DataTableColumn<WatcherView>[] = [
      {
        key: "name",
        label: t("prep.name"),
        cell: (watcher) =>
          watcher.active
            ? html`<span data-test=${`watcher-${watcher.id}`}>${watcher.name}</span>`
            : html`<span part="disabled-watcher" data-test=${`watcher-${watcher.id}`}
                ><span data-test=${`watcher-name-${watcher.id}`}>${watcher.name}</span
                ><span data-test=${`watcher-status-${watcher.id}`}
                  >${t("watchers.status_disabled")}</span
                ></span
              >`,
      },
      {
        key: "follows",
        label: t("watchers.follows_column"),
        cell: (watcher) => this.#watcherChoiceCell(watcher, "follows"),
      },
      {
        key: "zones",
        label: t("watchers.zones_column"),
        cell: (watcher) => this.#watcherChoiceCell(watcher, "zones"),
      },
      {
        key: "pass",
        label: t("watchers.runs_pass"),
        cell: (watcher) => this.#watcherChoiceCell(watcher, "pass"),
      },
      {
        key: "printers",
        label: t("watchers.printers"),
        cell: (watcher) => this.#watcherPrinterCell(watcher),
      },
      {
        key: "actions",
        label: t("prep.actions"),
        pinned: "end",
        cell: (watcher) =>
          html`<wt-row-actions
            data-test=${`watcher-actions-${watcher.id}`}
            .label=${`${watcher.name}: ${t("prep.actions")}`}
          >
            ${
              watcher.active
                ? html`<wt-button
                    variant="secondary"
                    data-test=${`rename-watcher-${watcher.id}`}
                    @click=${() => {
                      this.#watcherRenameScope?.dispose();
                      this.#watcherRenameScope = undefined;
                      this.#watcherRenameIdentity = undefined;
                      this.watcherRename = {
                        id: watcher.id,
                        name: watcher.name,
                        attempted: false,
                        fieldError: "",
                        error: "",
                      };
                    }}
                    >${t("venue.rename")}</wt-button
                  >`
                : html`<wt-button
                    variant="secondary"
                    data-test=${`enable-watcher-${watcher.id}`}
                    ?disabled=${this.busy}
                    @click=${() => void this.#enableWatcher(watcher)}
                    >${t("prep.enable")}</wt-button
                  >`
            }
            ${
              watcher.active || !watcher.inUse
                ? html`<wt-button
                    variant="danger"
                    data-test=${`remove-watcher-${watcher.id}`}
                    @click=${() => {
                      this.watcherRemoval = watcher;
                      this.watcherRemoveError = "";
                    }}
                    >${t(watcher.inUse ? "prep.disable" : "prep.delete")}</wt-button
                  >`
                : nothing
            }
          </wt-row-actions>`,
      },
    ];
    return html`<section data-test="watchers-group">
      <wt-data-table
        data-test="watchers-table"
        aria-label=${t("watchers.title")}
        .rows=${ordered}
        .columns=${columns}
        rowKey="id"
        .emptyLabel=${t("venue.combobox_no_results")}
      ></wt-data-table>
    </section>`;
  }
  /** Comes back with its name, follows and order; the printers it lost when disabled stay lost. */
  async #enableWatcher(watcher: WatcherView) {
    const enabled = await this.#act(
      () => this.api.enableWatcher(watcher.id),
      (error) => {
        const code = codeOf(error);
        return code === "watcher.name_taken"
          ? format("watchers.enable_name_taken", { name: watcher.name })
          : t(code === "watcher.not_found" ? "watchers.not_found" : "prep.save_error");
      },
    );
    if (!enabled) return;
    await this.updateComplete;
    const table = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('[data-test="watchers-table"]');
    await table?.updateComplete;
    table?.shadowRoot
      ?.querySelector<HTMLElement>(`[data-test="watcher-actions-${watcher.id}"]`)
      ?.focus();
  }
  readonly #beforeWatcherRenameClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || !this.isConnected || !this.watcherRename) return false;
    const identity = this.#watcherRenameIdentity;
    const scope = this.#watcherRenameScope;
    if (!scope || !this.#leave) return true;
    const outcome = await this.#leave!.request({ scopes: [scope.id], reason, proceed() {} });
    return this.isConnected && identity === this.#watcherRenameIdentity && outcome === "proceeded";
  };
  async #saveWatcherName(identity: object | undefined) {
    if (saveActionState(this.#watcherRenameScope).unchanged) return;
    const draft = this.watcherRename;
    if (!draft || this.busy || !this.isConnected || identity !== this.#watcherRenameIdentity)
      return;
    const scope = this.#watcherRenameScope;
    const watcher = this.view!.watchers.find((row) => row.id === draft.id);
    if (!watcher) return;
    const name = draft.name.trim();
    const input = { ...this.#watcherInput(watcher, false), name };
    const invalid = watcherInputErrors(input).name;
    this.watcherRename = { ...draft, attempted: true, fieldError: invalid, error: "" };
    if (invalid) {
      await this.updateComplete;
      this.shadowRoot!.querySelector<HTMLElement>('[data-test="watcher-rename-name"]')?.focus();
      return;
    }
    this.busy = true;
    this.#showError("");
    try {
      await this.api.updateWatcher(watcher.id, input);
    } catch (error) {
      if (!this.isConnected || identity !== this.#watcherRenameIdentity) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: string } })?.params?.field;
      const fieldError =
        code === "watcher.name_taken"
          ? t("watchers.name_taken")
          : code === "management.request_invalid" && field === "name"
            ? t("venue.field_required")
            : "";
      this.watcherRename = {
        ...this.watcherRename!,
        attempted: true,
        fieldError,
        error: fieldError
          ? ""
          : t(code === "watcher.not_found" ? "watchers.not_found" : "prep.save_error"),
      };
      this.busy = false;
      return;
    }
    if (!this.isConnected || identity !== this.#watcherRenameIdentity) return;
    scope?.commit({ name });
    this.busy = false;
    if (!scope?.isDirty()) {
      this.renderRoot
        .querySelector<HTMLElementTagNameMap["wt-modal"]>("[data-test=watcher-rename-modal]")
        ?.closeAfter("saved");
      this.watcherRename = undefined;
    }
    await this.#load();
  }
  #watcherRenameDialog() {
    const draft = this.watcherRename;
    if (!draft) return nothing;
    const invalid = draft.attempted && !draft.name.trim();
    const identity = this.#watcherRenameIdentity;
    return keyed(
      identity,
      html`<wt-modal
        open
        size="compact"
        data-test="watcher-rename-modal"
        heading=${t("venue.rename")}
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeWatcherRenameClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (this.isConnected && identity === this.#watcherRenameIdentity)
            this.watcherRename = undefined;
        }}
      >
        <wt-input
          name="name"
          required
          data-test="watcher-rename-name"
          label=${t("prep.name")}
          .value=${draft.name}
          .error=${draft.fieldError}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (!this.isConnected || identity !== this.#watcherRenameIdentity) return;
            const name = event.detail.value;
            this.watcherRename = {
              ...draft,
              name,
              fieldError: draft.attempted && !name.trim() ? t("venue.field_required") : "",
              error: "",
            };
            this.#watcherRenameScope?.changed();
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (this.isConnected && identity === this.#watcherRenameIdentity)
              submitOnEnter(
                event,
                this.renderRoot.querySelector('[data-test="save-watcher-name"]'),
              );
          }}
        ></wt-input>
        <wt-form-actions
          .error=${[draft.fieldError ? t("watchers.fix_fields") : "", draft.error].filter(Boolean).join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${(event: Event) => void (event.currentTarget as HTMLElement).closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.requestClose("cancel")}
            >${t("venue.cancel")}</wt-button
          >
          <wt-button
            data-test="save-watcher-name"
            variant=${saveActionState(this.#watcherRenameScope).variant}
            ?disabled=${saveActionState(this.#watcherRenameScope).unchanged || this.busy || invalid}
            @click=${() => void this.#saveWatcherName(identity)}
            >${t("venue.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
  /** A Disable only ever disables; a Delete disables instead a watcher something has come to name. */
  async #removeWatcher() {
    if (this.busy || !this.watcherRemoval) return;
    this.busy = true;
    this.#showError("");
    try {
      await this.api.removeWatcher(this.watcherRemoval.id, {
        disable: this.watcherRemoval.inUse,
      });
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
    return html`${
      this.watcherRemoval
        ? html`<wt-modal
            size="compact"
            open
            data-test="remove-watcher-modal"
            heading=${this.watcherRemoval.inUse ? t("prep.disable") : t("watchers.delete_heading")}
            .dismissible=${!this.busy}
            @wt-close=${() => {
              this.watcherRemoval = undefined;
            }}
          >
            <p>
              ${format(this.watcherRemoval.inUse ? "watchers.disable_confirm" : "watchers.delete_confirm", { name: this.watcherRemoval.name })}
            </p>
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
                >${t(this.watcherRemoval.inUse ? "prep.disable" : "prep.delete")}</wt-button
              ></wt-form-actions
            >
          </wt-modal>`
        : nothing
    }`;
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
      .options=${stationPrinterOptions(view.printers, view.watchers, printerIds)}
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
    const isFallback = action.kind === "fallback" || action.kind === "switch_off";
    const heading =
      action.kind === "switch_off"
        ? t("prep.disable")
        : action.kind === "fallback"
          ? t("prep.when_closed")
          : t("prep.enable");
    return keyed(
      identity,
      html`<wt-modal
        size="compact"
        open
        data-test="station-action-modal"
        heading=${heading}
        .dismissible=${!this.busy}
        .beforeClose=${this.#stationActionScope ? this.#stationActionBeforeClose : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current() && event.target === event.currentTarget) this.#cancelStationAction();
        }}
      >
        ${
          isFallback
            ? html`
                ${action.kind === "switch_off" ? html`<p>${format("prep.disable_confirm", { station: station?.name ?? action.stationId })}</p>` : nothing}
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
                            if (this.busy || !current()) return;
                            this.stationAction = {
                              ...action,
                              choice: event.detail.value,
                              confirming: false,
                            };
                            this.stationFieldError = "";
                            this.#stationActionScope?.changed();
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
            @click=${(event: Event) => {
              if (!current()) return;
              if (this.#stationActionScope)
                void (event.currentTarget as HTMLElement)
                  .closest("wt-modal")!
                  .requestClose("cancel");
              else this.#cancelStationAction();
            }}
            >${t("prep.cancel")}</wt-button
          ><wt-button
            data-test="confirm-station-action"
            ?disabled=${this.busy}
            @click=${() => {
              if (this.busy || !current()) return;
              if (isFallback && !action.confirming && !station?.isDefault)
                this.stationAction = { ...action, confirming: true };
              else void this.#saveStationAction();
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
              label=${t("prep.title")}
              .value=${this.tab}
              .items=${(this.readOnly ? (["stations"] as const) : PREP_TABS).map((key) => ({ key, label: t(`prep.tab.${key}`) }))}
              @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
                if (event.target !== event.currentTarget) return;
                const tab = PREP_TABS.find((tab) => tab === event.detail.value);
                if (!tab || tab === this.tab || (this.readOnly && tab !== "stations")) return;
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
                this.readOnly || this.tab !== "stations"
                  ? nothing
                  : html`<div slot="actions">
                      <wt-button @click=${() => this.#openStation()} data-test="new-station"
                        >${t("prep.add_station")}</wt-button
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
                  .actions=${this.readOnly ? {} : Object.fromEntries(view.stations.map((station) => [station.id, this.#stationMenu(station)]))}
                  .outputs=${this.readOnly ? undefined : this.#stationOutputs(view)}
                  .today=${Object.fromEntries(
                    view.stations.map((station) => {
                      const status = this.#todayCell(station);
                      return [station.id, status === nothing ? "" : status];
                    }),
                  )}
                ></prep-station-table>
              </div>
              ${
                this.readOnly
                  ? nothing
                  : html`<div slot="routing">
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
                      <div slot="watchers">${this.#watchers()}</div>
                      <div slot="settings">${this.#settings()}</div>`
              }
            </wt-tabs>`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.readOnly ? nothing : html`${this.#dialog()}${this.#previewDialog()}${this.#stationActionDialog()}${this.#watcherDialogs()}${this.#watcherRenameDialog()}${this.#stationEditor()}`}`;
  }
}
