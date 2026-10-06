import { QueryController, codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  submitOnEnter,
  ReorderController,
  reorder,
  UrlStateController,
  type ReorderModel,
  type DataTableColumn,
} from "@waitron/ui";
import { holdPageCursor, releasePageCursor } from "@waitron/ui/src/reorder-table.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
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
import type {
  RouteTarget,
  ExceptionInput,
  RouteException,
  RoutingDecision,
  RouteExplanation,
} from "../routing.js";
import type { RoutingChange, RoutingMove, StationTimes } from "../routing-types.js";
import { exceptionSentence } from "./exception-sentence.js";
import { formatDate } from "./hours-view.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import type {
  PrepStation,
  PrepStationsApi,
  PrepStationsView,
  StationInput,
  StationHealthSnapshot,
  WatcherInput,
} from "./routing-client.js";
import { watchersOfStation, watchersSeeing, type WatcherView } from "./watchers-seen.js";
import { t } from "./strings.js";
import "./station-health-table.js";
import { watcherInputErrors, type WatcherForm } from "./watcher-form.js";

type StationAction =
  | { kind: "today"; stationId: string; state: "open" | "closed" | null }
  | { kind: "fallback" | "switch_off"; stationId: string; choice: string; confirming: boolean }
  | { kind: "switch_on"; stationId: string };
const format = (key: Parameters<typeof t>[0], values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    t(key) as string,
  );

type ExceptionDraft = { input: ExceptionInput; target: string };

type Editor =
  | { kind: "station" }
  | { kind: "claim"; stationId: string | null }
  | { kind: "exception"; id?: string }
  | { kind: "exception_delete"; id: string };
const PREP_TABS = ["stations", "routing", "tickets", "watchers", "settings"] as const;
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

const NO_PREPARATION = "no_preparation";
const targetFor = (id: string): RouteTarget =>
  id === NO_PREPARATION ? { kind: "no_preparation" } : { kind: "station", stationId: id };

type SettingsDraft = {
  stationId: string;
  field: "rest" | "fallback" | TimingField;
  value: string;
  fieldError: string;
  error: string;
  confirming: boolean;
  attempted: boolean;
};

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
      wt-data-table::part(watcher-cell),
      wt-data-table::part(printer-cell) {
        display: grid;
        gap: var(--wt-space-2);
        max-width: calc(var(--wt-tap-min) * 5);
        white-space: normal;
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
  @property({ type: Boolean }) readOnly = false;
  @state() private view?: PrepStationsView;
  @state() private settingsEditor?: SettingsDraft;
  @state() private settingsBusy = false;
  @state() private printerEditor?: { stationId: string; ids: string[]; error: string };
  @state() private printerBusy = false;
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
  @state() private watcherEditor?: { id?: string };
  @state() private watcherRename?: {
    id: string;
    name: string;
    attempted: boolean;
    fieldError: string;
    error: string;
  };
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
  @state() private testDate = "";
  /** The server refused the chosen time because the clocks skip it on the chosen date. */
  @state() private testTimeSkipped = false;
  @state() private explanation?: RouteExplanation;
  @state() private testError = "";
  @state() private stationAction?: StationAction;
  @state() private stationActionError = "";
  @state() private stationFieldError = "";
  @state() private tab: PrepTab = "stations";
  @state() private stationOrder?: string[];
  @state() private stationAnnouncement = "";
  #stationDrag?: { id: string; pointerId: number; changed: boolean };
  @state() private rename?: {
    id: string;
    name: string;
    error: string;
    invalid: boolean;
    fieldError: boolean;
  };
  @state() private health?: StationHealthSnapshot;
  #healthTimer?: ReturnType<typeof setInterval>;
  #routingTimer?: ReturnType<typeof setInterval>;
  #testRequest = 0;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "prep-stations") return;
      this.testProduct = this.readOnly ? "" : (this.#url.read("test") ?? "");
      const requested = this.#url.read("view");
      this.tab =
        (this.readOnly ? (["stations"] as const) : PREP_TABS).find((tab) => tab === requested) ??
        (requested === null && this.testProduct ? "routing" : "stations");
      if (this.tab !== requested)
        this.#url.write(
          { dashboard: "prep-stations", view: this.tab, ...(this.readOnly ? { test: null } : {}) },
          true,
        );
      void this.#explain();
    },
    {
      basePath: "/manage",
      primary: "dashboard",
      children: { "*": { view: "view", test: "test" } },
    },
  );
  @state() private pending?: {
    change: RoutingChange;
    moves: RoutingMove[];
    save: () => Promise<unknown>;
    closeEditor: boolean;
    field?: string;
    isCurrent: () => boolean;
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
    () => {
      if (this.#readErrorShown) this.#showError("");
    },
  );
  #exceptionScope?: DraftScope<ExceptionDraft>;
  #exceptionIdentity?: object;
  #exceptionRun = 0;
  #stationScope?: DraftScope<StationInput>;
  #renameScope?: DraftScope<{ name: string }>;
  #stationIdentity?: object;
  #renameIdentity?: object;
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
    if (editor.field === "rest" || editor.field === "fallback") return editor.value;
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
      this.#settingsScope = this.#leave?.register({
        id,
        current: () => this.#settingsValue(this.settingsEditor!),
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          if (this.settingsEditor)
            this.settingsEditor = { ...this.settingsEditor, value, confirming: false };
        },
      });
    }
  }
  #leaveSettings(reason: LeaveReason, identity: object | undefined, proceed: () => void): void {
    if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
    if (!this.#settingsScope) proceed();
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
    if (this.editor?.kind !== "exception") {
      this.#exceptionScope?.dispose();
      this.#exceptionScope = undefined;
      this.#exceptionIdentity = undefined;
    } else if (this.#exceptionIdentity !== this.editor) {
      this.#exceptionScope?.dispose();
      const id = (this.#exceptionIdentity = this.editor);
      this.#leave ??= leaveCoordinatorFor(this);
      this.#exceptionScope = this.#leave?.register({
        id,
        current: () => ({ input: this.exceptionDraft, target: this.exceptionTarget }),
        snapshot: (value) => structuredClone(value),
        equal: (a, b) =>
          a.target === b.target &&
          a.input.zoneId === b.input.zoneId &&
          a.input.categoryId === b.input.categoryId &&
          a.input.productId === b.input.productId &&
          (a.target === "" ||
            (a.input.target.kind === b.input.target.kind &&
              (a.input.target.kind !== "station" ||
                (b.input.target.kind === "station" &&
                  a.input.target.stationId === b.input.target.stationId)))),
        restore: (value) => {
          this.exceptionDraft = structuredClone(value.input);
          this.exceptionTarget = value.target;
        },
      });
    }
    if (this.editor?.kind !== "station") {
      this.#stationScope?.dispose();
      this.#stationScope = undefined;
      this.#stationIdentity = undefined;
    } else if (!this.#stationIdentity) {
      const id = (this.#stationIdentity = {});
      this.#leave ??= leaveCoordinatorFor(this);
      this.#stationScope = this.#leave?.register({
        id,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          Object.keys(a).every((key) =>
            Object.is(a[key as keyof StationInput], b[key as keyof StationInput]),
          ),
        restore: (value) => {
          this.draft = { ...value };
        },
      });
    }
    if (!this.rename) {
      this.#renameScope?.dispose();
      this.#renameScope = undefined;
      this.#renameIdentity = undefined;
    } else if (!this.#renameIdentity) {
      const id = (this.#renameIdentity = {});
      this.#leave ??= leaveCoordinatorFor(this);
      this.#renameScope = this.#leave?.register({
        id,
        current: () => ({ name: this.rename!.name }),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.name.trim() === b.name.trim(),
        restore: (value) => {
          if (this.rename) this.rename = { ...this.rename, name: value.name };
        },
      });
    }
    if (!this.watcherRename) {
      this.#watcherRenameScope?.dispose();
      this.#watcherRenameScope = undefined;
      this.#watcherRenameIdentity = undefined;
    } else if (!this.#watcherRenameIdentity) {
      const id = (this.#watcherRenameIdentity = {});
      this.#leave ??= leaveCoordinatorFor(this);
      this.#watcherRenameScope = this.#leave?.register({
        id,
        current: () => ({ name: this.watcherRename!.name }),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.name.trim() === b.name.trim(),
        restore: (value) => {
          if (this.watcherRename) this.watcherRename = { ...this.watcherRename, name: value.name };
        },
      });
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
        const registered = this.#leave?.register({
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
        });
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
    if (!scope) {
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

  async #beforeStationClose(
    reason: LeaveReason,
    rename: boolean,
    identity: object | undefined,
  ): Promise<boolean> {
    if (this.busy) return false;
    const scope = rename ? this.#renameScope : this.#stationScope;
    if (!scope) return true;
    const outcome = await this.#leave!.request({ scopes: [scope.id], reason, proceed() {} });
    return (
      identity === (rename ? this.#renameIdentity : this.#stationIdentity) &&
      outcome === "proceeded"
    );
  }

  readonly #beforeExceptionClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const identity = this.#exceptionIdentity;
    const scope = this.#exceptionScope;
    if (!scope) return true;
    const outcome = await this.#leave!.request({ scopes: [scope.id], reason, proceed() {} });
    return identity === this.#exceptionIdentity && outcome === "proceeded";
  };

  readonly #beforeAddClose = (reason: LeaveReason) =>
    this.#beforeStationClose(reason, false, this.#stationIdentity);
  readonly #beforeRenameClose = (reason: LeaveReason) =>
    this.#beforeStationClose(reason, true, this.#renameIdentity);

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
    this.#syncStationDrafts();
    this.#syncWatcherInlineDrafts();
    this.#syncSettingsDraft();
    if (changed.has("readOnly") && this.readOnly) {
      this.tab = "stations";
      this.testProduct = "";
      if (this.#url.read("dashboard") === "prep-stations")
        this.#url.write({ dashboard: "prep-stations", view: "stations", test: null }, true);
    }
  }
  override connectedCallback() {
    super.connectedCallback();
    void this.#load();
    void this.#loadHealth();
    if (!this.api.liveData) {
      this.#healthTimer = setInterval(() => void this.#loadHealth(), 15_000);
      this.#routingTimer = setInterval(() => void this.#load(), 60_000);
    }
  }
  override disconnectedCallback() {
    this.#exceptionRun++;
    if (this.pending?.change.kind === "exception") this.pending = undefined;
    if (
      this.#stationIdentity ||
      this.#renameIdentity ||
      this.#exceptionIdentity ||
      this.stationAction !== undefined ||
      this.watcherEditor ||
      this.#watcherRenameIdentity
    )
      this.busy = false;
    this.stationAction = undefined;
    this.#stationActionScope?.dispose();
    this.#stationActionScope = undefined;
    this.#stationActionIdentity = undefined;
    this.watcherEditor = undefined;
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
    this.#renameScope?.dispose();
    this.#exceptionScope?.dispose();
    this.#exceptionScope = undefined;
    this.#exceptionIdentity = undefined;
    this.#stationScope = undefined;
    this.#renameScope = undefined;
    this.#stationIdentity = undefined;
    this.#renameIdentity = undefined;
    this.#leave = undefined;
    if (this.#healthTimer) clearInterval(this.#healthTimer);
    if (this.#routingTimer) clearInterval(this.#routingTimer);
    super.disconnectedCallback();
    this.#endStationDrag();
  }
  async #loadHealth() {
    try {
      await this.#queries.watch(
        "health",
        {
          key: "venue-service:station-health",
          dependencies: QUERY_DEPENDENCIES.health.map((type) => ({ type })),
          refreshMs: 15_000,
          read: () => this.api.readStationHealth(),
        },
        (value) => {
          this.health = value;
        },
      );
    } catch {
      this.#showReadError(t("prep.load_error"));
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
          const editor = this.watcherPrinterEditor;
          if (
            editor?.conflictPrinterId &&
            !value.stationPrinters.some((row) => editor.ids.includes(row.printerId))
          ) {
            this.watcherPrinterEditor = { ...editor, fieldError: "", conflictPrinterId: undefined };
          }
          this.exceptionOrder = [...value.routing.exceptions]
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((e) => e.id);
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
  async #preview(
    change: RoutingChange,
    save: () => Promise<unknown>,
    closeEditor = false,
    field?: string,
    isCurrent: () => boolean = () => true,
  ) {
    if (this.busy || this.pending) return;
    this.busy = true;
    this.#showError("");
    this.claimError = "";
    try {
      const moves = await this.api.preview(change);
      if (!isCurrent()) return;
      this.pending = { change, moves, save, closeEditor, field, isCurrent };
    } catch (e) {
      if (!isCurrent()) return;
      const rejectedField = (e as { params?: { field?: unknown } } | undefined)?.params?.field;
      if (rejectedField === "condition") this.exceptionFieldError = t("prep.exception_condition");
      else if (codeOf(e) === "route.station_inactive" && field) {
        this.claimField = field;
        this.claimError = t("prep.station_disabled");
      } else if (codeOf(e) === "route.station_inactive")
        this.#showError(t("prep.station_disabled"));
      else this.#showError(t("prep.save_error"));
      this.#restoreOrder();
    } finally {
      if (isCurrent()) this.busy = false;
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
      if (!pending.isCurrent()) return;
      this.pending = undefined;
      if (pending.closeEditor) this.editor = undefined;
      await this.#load();
    } catch (e) {
      if (!pending.isCurrent()) return;
      const rejectedField = (e as { params?: { field?: unknown } } | undefined)?.params?.field;
      if (rejectedField === "condition") this.exceptionFieldError = t("prep.exception_condition");
      else if (codeOf(e) === "route.station_inactive" && pending.field) {
        this.claimField = pending.field;
        this.claimError = t("prep.station_disabled");
      } else if (codeOf(e) === "route.station_inactive") {
        this.#showError(t("prep.station_disabled"));
      } else this.#showError(t("prep.save_error"));
      this.pending = undefined;
      this.#restoreOrder();
    } finally {
      if (pending.isCurrent()) this.busy = false;
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
  #activeStationOrder() {
    return (
      this.stationOrder ??
      [...(this.view?.stations ?? [])]
        .filter((station) => station.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
        .map((station) => station.id)
    );
  }
  #healthTable() {
    return this.renderRoot
      .querySelector("prep-station-health-table")
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
    const health = this.renderRoot.querySelector("prep-station-health-table");
    if (health) await health.updateComplete;
    const table = this.#healthTable();
    if (table) await table.updateComplete;
    table?.shadowRoot?.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)?.focus();
  }
  #startStationDrag(event: PointerEvent, id: string) {
    if (this.busy || this.#stationDrag || event.button !== 0) return;
    event.preventDefault();
    this.#stationDrag = { id, pointerId: event.pointerId, changed: false };
    holdPageCursor();
    document.addEventListener("pointermove", this.#moveStationDrag);
    document.addEventListener("pointerup", this.#dropStationDrag);
    document.addEventListener("pointercancel", this.#dropStationDrag);
  }
  readonly #moveStationDrag = (event: PointerEvent) => {
    const drag = this.#stationDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const order = this.#activeStationOrder();
    for (const row of this.#healthTable()?.shadowRoot?.querySelectorAll("tbody tr") ?? []) {
      const bounds = row.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY >= bounds.bottom) continue;
      const id = row.querySelector<HTMLElement>("[data-station-id]")?.dataset.stationId;
      if (id && order.includes(id) && this.#moveStation(drag.id, order.indexOf(id)))
        drag.changed = true;
      break;
    }
  };
  readonly #dropStationDrag = (event: PointerEvent) => {
    const drag = this.#stationDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#endStationDrag();
    if (drag.changed) void this.#saveStationOrder(drag.id);
  };
  #endStationDrag() {
    if (!this.#stationDrag) return;
    this.#stationDrag = undefined;
    releasePageCursor();
    document.removeEventListener("pointermove", this.#moveStationDrag);
    document.removeEventListener("pointerup", this.#dropStationDrag);
    document.removeEventListener("pointercancel", this.#dropStationDrag);
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
          data-test=${`rename-${station.id}`}
          ?disabled=${this.busy}
          @click=${() => {
            this.rename = {
              id: station.id,
              name: station.name,
              error: "",
              invalid: false,
              fieldError: false,
            };
          }}
          >${t("venue.rename")}</wt-button
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
  async #saveStationName() {
    const draft = this.rename;
    if (!draft || this.busy || !this.view?.stations.some((station) => station.id === draft.id))
      return;
    if (!draft.name.trim()) {
      this.rename = { ...draft, error: t("prep.name_required"), invalid: true, fieldError: true };
      return;
    }
    const identity = this.#renameIdentity;
    const scope = this.#renameScope;
    this.busy = true;
    this.rename = { ...draft, error: "", invalid: false, fieldError: false };
    try {
      await this.api.updateStation(draft.id, { name: draft.name.trim() });
    } catch (error) {
      if (!this.isConnected || identity !== this.#renameIdentity) return;
      this.rename = {
        ...this.rename!,
        error: t(codeOf(error) === "station.name_taken" ? "prep.name_taken" : "prep.save_error"),
        invalid: false,
        fieldError: codeOf(error) === "station.name_taken",
      };
      this.busy = false;
      return;
    }
    if (!this.isConnected || identity !== this.#renameIdentity) return;
    scope?.commit({ name: draft.name });
    if (!scope?.isDirty()) {
      this.renderRoot
        .querySelector<HTMLElementTagNameMap["wt-modal"]>("[data-test=station-rename]")
        ?.closeAfter("saved");
      this.rename = undefined;
    }
    await this.#load();
    this.busy = false;
  }
  #renameDialog() {
    const draft = this.rename;
    if (!draft) return nothing;
    const identity = this.#renameIdentity;
    return keyed(
      identity,
      html`<wt-modal
        open
        size="compact"
        data-test="station-rename"
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeRenameClose}
        heading=${t("venue.rename")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (identity === this.#renameIdentity) this.rename = undefined;
        }}
      >
        <wt-input
          name="stationName"
          label=${t("prep.name")}
          required
          .value=${draft.name}
          .error=${draft.fieldError ? draft.error : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (!this.isConnected || identity !== this.#renameIdentity) return;
            this.rename = {
              ...draft,
              name: event.detail.value,
              error: "",
              invalid: false,
              fieldError: false,
            };
            this.#renameScope?.changed();
          }}
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-station-name"]'))}
        ></wt-input>
        ${draft.error ? html`<p class="error" role="alert">${draft.invalid ? t("prep.fix_fields") : draft.error}</p>` : nothing}
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            variant="secondary"
            @click=${(event: Event) => void (event.currentTarget as HTMLElement).closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.requestClose("cancel")}
            >${t("prep.cancel")}</wt-button
          >
          <wt-button
            data-test="save-station-name"
            ?disabled=${this.busy || draft.invalid}
            @click=${() => void this.#saveStationName()}
            >${t("prep.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
  #openStation() {
    this.editor = { kind: "station" };
    this.draft = {
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
    this.#stationScope?.changed();
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
    if (this.busy) return;
    const identity = this.#stationIdentity;
    const scope = this.#stationScope;
    this.busy = true;
    this.#showError("");
    try {
      await this.api.createStation(d);
      if (!this.isConnected || identity !== this.#stationIdentity) return;
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
      if (codeOf(e) === "station.name_taken") this.fieldError = { name: t("prep.name_taken") };
      else this.#showError(t("prep.save_error"));
    } finally {
      if (this.isConnected && (identity === this.#stationIdentity || !this.editor))
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
  async #explain() {
    const request = ++this.#testRequest;
    this.explanation = undefined;
    this.testError = "";
    this.testTimeSkipped = false;
    if (
      !this.testProduct ||
      (this.testWhen !== "now" && !this.testTime) ||
      (this.testWhen === "date" && !this.testDate)
    )
      return;
    const moment =
      this.testWhen === "now"
        ? undefined
        : this.testWhen === "date"
          ? {
              civilDate: this.testDate,
              weekday: new Date(`${this.testDate}T00:00:00Z`).getUTCDay(),
              timeOfDay: this.testTime,
            }
          : { weekday: this.testWeekday, timeOfDay: this.testTime };
    try {
      const explanation = this.testExtras.length
        ? await this.api.explain(this.testProduct, this.testZone || null, moment, this.testExtras)
        : moment
          ? await this.api.explain(this.testProduct, this.testZone || null, moment)
          : await this.api.explain(this.testProduct, this.testZone || null);
      if (request === this.#testRequest) this.explanation = explanation;
    } catch (error) {
      if (request !== this.#testRequest) return;
      const field = (error as { params?: { field?: string } } | undefined)?.params?.field;
      if (codeOf(error) === "management.request_invalid" && field === "time")
        this.testTimeSkipped = true;
      else this.testError = t("prep.test_error");
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
  #fallbackReason(step: RouteExplanation["fallbacks"][number]): string {
    return format(step.why === "switched_off" ? "prep.test_disabled" : `prep.test_${step.why}`, {
      station: this.#testStationName(step.stationId),
    });
  }
  #testFallback(step: RouteExplanation["fallbacks"][number], index: number): string {
    const explanation = this.explanation!;
    const reason = this.#fallbackReason(step);
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
          reason: this.#fallbackReason(step),
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
            { value: "date", label: t("prep.test_on_date") },
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
              `
            : nothing
        }
        ${
          this.testWhen === "date"
            ? html`
                <div>
                  <wt-input
                    name="date"
                    data-test="test-date"
                    type="date"
                    label=${t("prep.test_date")}
                    required
                    .value=${live(this.testDate)}
                    aria-invalid=${!this.testDate}
                    .invalid=${!this.testDate}
                    aria-describedby="test-date-error"
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      this.testDate = event.detail.value;
                      void this.#explain();
                    }}
                  ></wt-input>
                  <span id="test-date-error" class="error"
                    >${!this.testDate ? t("prep.test_date_required") : nothing}</span
                  >
                </div>
              `
            : nothing
        }
        ${
          this.testWhen !== "now"
            ? html`
                <div>
                  <wt-input
                    name="time"
                    data-test="test-time"
                    type="time"
                    label=${t("prep.test_time")}
                    required
                    .value=${live(this.testTime)}
                    aria-invalid=${!this.testTime || this.testTimeSkipped}
                    .invalid=${!this.testTime || this.testTimeSkipped}
                    aria-describedby="test-time-error"
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      this.testTime = event.detail.value;
                      void this.#explain();
                    }}
                  ></wt-input>
                  <span id="test-time-error" class="error"
                    >${
                      !this.testTime
                        ? t("prep.test_time_required")
                        : this.testTimeSkipped
                          ? t("prep.test_time_skipped")
                          : nothing
                    }</span
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
    this.#exceptionRun++;
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
    const scope = this.#exceptionScope;
    const run = this.#exceptionRun;
    const isCurrent = () => this.isConnected && this.#exceptionRun === run;
    const input = structuredClone(this.exceptionDraft);
    const target = this.exceptionTarget;
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
      async () => {
        if (id) await this.api.updateException(id, input);
        else await this.api.createException(input);
        if (!isCurrent()) return;
        scope?.commit({ input, target });
        if (!scope?.isDirty()) this.editor = undefined;
      },
      false,
      undefined,
      isCurrent,
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
              label: `${this.#stationName(selected)} (${t("prep.disabled_station_label")})`,
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
                          ${e.neverMatches ? html`<span class="chip">${t("prep.never_used")}</span>` : nothing}${e.stationOff ? html`<span class="chip">${t("prep.exception_station_disabled")}</span>` : nothing}
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
    if (this.readOnly) return this.#stationStatus(station);
    const state = times.today ? null : times.status.open ? "closed" : "open";
    const action = state === null ? "schedule" : state === "closed" ? "close-today" : "open-today";
    return html`<div part="today">
      <span>${this.#stationStatus(station)}</span>
      <wt-button
        variant="secondary"
        data-test=${`${action}-${station.id}`}
        ?disabled=${this.busy}
        @click=${() => this.#openStationAction({ kind: "today", stationId: station.id, state })}
        >${t(state === null ? "prep.back_to_schedule" : state === "closed" ? "prep.close_today" : "prep.open_today")}</wt-button
      >
    </div>`;
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
      if (action.kind === "today") await this.api.setStationToday(action.stationId, action.state);
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
        >
      </div>
    </wt-card>`;
  }
  async #saveStationPrinters() {
    const editor = this.printerEditor;
    if (!editor || this.printerBusy) return;
    this.printerBusy = true;
    this.printerEditor = { ...editor, error: "" };
    this.#showError("");
    try {
      await this.api.setStationPrinters(editor.stationId, editor.ids);
    } catch (error) {
      const code = codeOf(error);
      if (
        code === "printer.not_found" ||
        code === "printer.makes_and_watches" ||
        code === "management.request_invalid"
      ) {
        this.printerEditor = { ...editor, error: t("prep.tickets.printer_refused") };
      } else {
        this.#showError(
          code === "station.not_found" ? t("prep.station_disabled") : t("prep.save_error"),
        );
      }
      this.printerBusy = false;
      return;
    }
    this.printerEditor = undefined;
    this.printerBusy = false;
    await this.#load();
  }
  #printerCell(station: PrepStation) {
    const view = this.view!;
    const selected = view.stationPrinters
      .filter((row) => row.stationId === station.id)
      .map((row) => row.printerId);
    const names =
      selected.map((id) => view.printers.find((row) => row.id === id)?.name ?? id).join(", ") ||
      t("prep.none");
    if (!station.active) return html`<span part="disabled-station">${names}</span>`;
    const editor = this.printerEditor?.stationId === station.id ? this.printerEditor : undefined;
    if (!editor)
      return html`<button
        type="button"
        part="edit-printers"
        data-test=${`edit-printers-${station.id}`}
        aria-label=${`${station.name}: ${t("prep.tickets.printed_on")}`}
        ?disabled=${this.printerBusy}
        @click=${() => {
          this.printerEditor = { stationId: station.id, ids: selected, error: "" };
        }}
      >
        ${names}
      </button>`;
    const options = view.printers.map((printer) => {
      const watcher = view.watchers.find(
        (row) => row.printerIds.includes(printer.id) || row.id === printer.watcherId,
      );
      const disabled =
        (printer.active === false || !!watcher || !!printer.watcherId) &&
        !editor.ids.includes(printer.id);
      return {
        value: printer.id,
        label: printer.name,
        disabled,
        description:
          printer.active === false
            ? t("prep.health.disabled")
            : watcher || printer.watcherId
              ? format("prep.tickets.watcher_printer", {
                  name: watcher?.name ?? printer.watcherId!,
                })
              : undefined,
      };
    });
    return html`<div part="printer-cell">
      <wt-combobox
        multiple
        hide-label
        name="printerIds"
        data-test=${`station-printers-${station.id}`}
        label=${`${station.name}: ${t("prep.tickets.printed_on")}`}
        .options=${options}
        .values=${editor.ids}
        .disabled=${this.printerBusy}
        .error=${editor.error}
        data-field-error=${editor.error ? "printerIds" : nothing}
        .searchPlaceholder=${t("prep.printers")}
        .noResultsLabel=${t("venue.combobox_no_results")}
        .countLabel=${(count: number) => format("prep.tickets.printer_count", { count: String(count) })}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          this.printerEditor = { ...editor, ids: event.detail.values, error: "" };
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && !this.printerBusy) {
            event.stopPropagation();
            this.printerEditor = undefined;
          }
        }}
      ></wt-combobox>
      <div part="cell-actions">
        <wt-button
          variant="secondary"
          data-test=${`cancel-printers-${station.id}`}
          ?disabled=${this.printerBusy}
          @click=${() => {
            this.printerEditor = undefined;
          }}
          >${t("venue.cancel")}</wt-button
        >
        <wt-button
          data-test=${`save-printers-${station.id}`}
          ?disabled=${this.printerBusy}
          @click=${() => void this.#saveStationPrinters()}
          >${t("venue.save")}</wt-button
        >
      </div>
    </div>`;
  }
  #tickets() {
    const view = this.view!;
    const rows = [...view.stations].sort(
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
          html`<span part=${station.active ? "station-name" : "disabled-station"}
            >${station.name}${station.active ? "" : ` (${t("prep.health.disabled")})`}</span
          >`,
      },
      {
        key: "printers",
        label: t("prep.tickets.printed_on"),
        cell: (station) => this.#printerCell(station),
      },
      {
        key: "screens",
        label: t("prep.tickets.screens"),
        cell: (station) =>
          html`<span data-test=${`screens-${station.id}`}>
            ${
              view.devices
                .filter(
                  (device) =>
                    device.stationId === station.id &&
                    device.kind === "kds_station" &&
                    device.active,
                )
                .map((device) => device.label)
                .join(", ") || t("prep.none")
            }
            <a href="/manage/devices">${t("prep.devices")}</a></span
          >`,
      },
      {
        key: "watchers",
        label: t("prep.tickets.watchers"),
        cell: (station) =>
          html`<span data-test=${`watchers-${station.id}`}>
            ${
              watchersOfStation(view.watchers, station.id)
                .map((watcher) => watcher.name)
                .join(", ") || t("prep.none")
            }
            <a href="/manage/prep-stations/view/watchers">${t("watchers.title")}</a></span
          >`,
      },
    ];
    return html`<wt-data-table
      data-test="tickets-table"
      .emptyMessage=${t("venue.combobox_no_results")}
      aria-label=${t("prep.tab.tickets")}
      .rows=${rows}
      .columns=${columns}
      rowKey="id"
    ></wt-data-table>`;
  }
  async #saveWatcherPrinters(identity: object | undefined) {
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
          ?disabled=${this.watcherPrinterBusy}
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
          ?disabled=${this.watcherCellBusy || !!invalid}
          @click=${() => void this.#saveWatcherCell(identity)}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }
  async #saveSettingsCell(identity: object | undefined) {
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
      if (editor.field === "rest")
        await this.api.updateStation(editor.stationId, {
          showsRestOfOrder: editor.value === "yes",
        });
      else if (editor.field === "fallback") {
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
        : editor.field === "rest"
          ? code === "management.request_invalid" && field === "showsRestOfOrder"
            ? t("prep.save_error")
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
    if (editor.field === "rest")
      return ["yes", "no"].includes(editor.value) ? "" : t("prep.choose_yes_no");
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
  #settingsCell(station: PrepStation, field: "rest" | "fallback") {
    const label = t(field === "rest" ? "prep.shows_rest_of_order" : "prep.when_closed");
    if (field === "fallback" && station.isDefault)
      return html`<span data-test=${`settings-fallback-${station.id}`}
        >${t("prep.never_closes")}</span
      >`;
    const value =
      field === "rest"
        ? station.showsRestOfOrder
          ? "yes"
          : "no"
        : (this.#times(station.id)?.fallbackStationId ?? "");
    const text =
      field === "rest"
        ? t(station.showsRestOfOrder ? "venue.yes" : "venue.no")
        : value
          ? this.#stationName(value)
          : t("prep.no_replacement_choice");
    const editor =
      this.settingsEditor?.stationId === station.id && this.settingsEditor.field === field
        ? this.settingsEditor
        : undefined;
    if (!editor)
      return html`<wt-button
        variant="secondary"
        data-test=${`edit-settings-${field}-${station.id}`}
        aria-label=${`${station.name}: ${label}`}
        ?disabled=${this.settingsBusy}
        @click=${() => {
          this.#openSettings({
            stationId: station.id,
            field,
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
        name=${field === "rest" ? "showsRestOfOrder" : "fallbackStationId"}
        label=${`${station.name}: ${label}`}
        .options=${
          field === "rest"
            ? [
                { value: "yes", label: t("venue.yes") },
                { value: "no", label: t("venue.no") },
              ]
            : this.#fallbackOptions(station.id)
        }
        .value=${editor.value}
        .error=${invalid || editor.fieldError}
        .disabled=${this.settingsBusy}
        .required=${field === "rest"}
        .placeholder=${field === "fallback" ? t("prep.no_replacement_choice") : ""}
        .searchPlaceholder=${field === "fallback" ? t("prep.search_stations") : label}
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
          ?disabled=${this.settingsBusy || !!invalid}
          @click=${() => {
            if (!this.#settingsCurrent(identity) || this.settingsBusy || this.readOnly) return;
            if (field === "fallback" && !editor.confirming)
              this.settingsEditor = { ...editor, confirming: true };
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
          ?disabled=${this.settingsBusy || !!invalid}
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
        key: "rest",
        label: t("prep.shows_rest_of_order"),
        cell: (station) => this.#settingsCell(station, "rest"),
      },
      {
        key: "fallback",
        label: t("prep.when_closed"),
        cell: (station) => this.#settingsCell(station, "fallback"),
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
        key: "screens",
        label: t("watchers.screens"),
        cell: (watcher) =>
          html`<span
            part=${watcher.active ? "watcher-cell" : "watcher-cell disabled-watcher-cell"}
            data-test=${`watcher-screens-${watcher.id}`}
          >
            ${
              view.devices
                .filter((device) => device.watcherId === watcher.id)
                .map(
                  (device) =>
                    `${device.label}${device.active ? "" : ` (${t("prep.health.disabled")})`}`,
                )
                .join(", ") || t("prep.none")
            }
            <a href="/manage/devices">${t("prep.devices")}</a></span
          >`,
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
    if (!scope) return true;
    const outcome = await this.#leave!.request({ scopes: [scope.id], reason, proceed() {} });
    return this.isConnected && identity === this.#watcherRenameIdentity && outcome === "proceeded";
  };
  async #saveWatcherName(identity: object | undefined) {
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
            ?disabled=${this.busy || invalid}
            @click=${() => void this.#saveWatcherName(identity)}
            >${t("venue.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
  readonly #beforeWatcherClose = async (reason: LeaveReason): Promise<boolean> => {
    const editor = this.watcherEditor;
    const form = this.shadowRoot!.querySelector<WatcherForm>("watcher-form");
    if (!editor || !form) return false;
    const allowed = await form.requestLeave(reason);
    return allowed && this.watcherEditor === editor && form.isConnected;
  };

  async #saveWatcher(input: WatcherInput, form: WatcherForm, editor: { id?: string }) {
    if (this.busy || !this.isConnected || !form.isConnected || this.watcherEditor !== editor)
      return;
    this.busy = true;
    this.#showError("");
    try {
      if (editor.id) await this.api.updateWatcher(editor.id, input);
      else await this.api.createWatcher(input);
    } catch (error) {
      if (this.isConnected && this.watcherEditor === editor && form.isConnected) {
        this.watcherRefusal = error as { code: string; params?: { field?: string } };
        this.busy = false;
      }
      return;
    }
    if (!this.isConnected || this.watcherEditor !== editor || !form.isConnected) return;
    const clean = form.commitSubmitted(input);
    this.busy = false;
    if (clean) {
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
        "[data-test=watcher-modal]",
      )!.closeAfter("saved");
      this.watcherEditor = undefined;
    }
    await this.#load();
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
    const editor = this.watcherEditor;
    const watcher = this.view?.watchers.find((row) => row.id === editor?.id);
    return html`${
      editor
        ? keyed(
            editor,
            html`<wt-modal
              size="standard"
              open
              data-test="watcher-modal"
              heading=${watcher?.name ?? t("watchers.new")}
              .dismissible=${!this.busy}
              .beforeClose=${this.#beforeWatcherClose}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                if (
                  this.isConnected &&
                  this.watcherEditor === editor &&
                  (event.currentTarget as HTMLElement).isConnected
                )
                  this.watcherEditor = undefined;
              }}
            >
              <watcher-form
                .watcher=${watcher}
                .stations=${this.view?.stations ?? []}
                .zones=${this.view?.zones ?? []}
                .refusal=${this.watcherRefusal}
                .busy=${this.busy}
                @watcher-save=${(event: CustomEvent<{ input: WatcherInput }>) => void this.#saveWatcher(event.detail.input, event.currentTarget as WatcherForm, editor)}
                @watcher-cancel=${(event: Event) => {
                  if (
                    this.isConnected &&
                    this.watcherEditor === editor &&
                    (event.currentTarget as HTMLElement).isConnected
                  )
                    void (event.currentTarget as HTMLElement)
                      .closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!
                      .requestClose("cancel");
                }}
              ></watcher-form>
            </wt-modal>`,
          )
        : nothing
    }
    ${
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
  #dialog() {
    if (!this.editor || this.pending) return nothing;
    const editor = this.editor;
    return keyed(
      editor.kind === "station" ? this.#stationIdentity : editor,
      html`<wt-modal
        .dismissible=${(editor.kind !== "station" && editor.kind !== "exception") || !this.busy}
        .beforeClose=${editor.kind === "station" ? this.#beforeAddClose : editor.kind === "exception" ? this.#beforeExceptionClose : undefined}
        size=${editor.kind === "claim" || editor.kind === "exception_delete" ? "compact" : "standard"}
        open
        heading=${editor.kind === "claim" ? t("prep.claim_folder") : editor.kind === "exception_delete" ? t("prep.confirm_delete_exception") : editor.kind === "exception" ? (editor.id ? t("prep.edit_exception") : t("prep.add_exception")) : t("prep.new_station")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editor === editor && (event.currentTarget as HTMLElement).isConnected)
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
                          e.stopPropagation();
                          if (
                            !this.isConnected ||
                            this.editor !== editor ||
                            !(e.currentTarget as HTMLElement).isConnected
                          )
                            return;
                          const value = e.detail.value;
                          this.exceptionDraft = {
                            ...this.exceptionDraft,
                            categoryId: value.startsWith("category:") ? value.slice(9) : null,
                            productId: value.startsWith("product:") ? value.slice(8) : null,
                          };
                          this.exceptionFieldError = "";
                          this.#exceptionScope?.changed();
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
                        e.stopPropagation();
                        if (
                          !this.isConnected ||
                          this.editor !== editor ||
                          !(e.currentTarget as HTMLElement).isConnected
                        )
                          return;
                        this.exceptionDraft = {
                          ...this.exceptionDraft,
                          zoneId: e.detail.value || null,
                        };
                        this.exceptionFieldError = "";
                        this.#exceptionScope?.changed();
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
                        e.stopPropagation();
                        if (
                          !this.isConnected ||
                          this.editor !== editor ||
                          !(e.currentTarget as HTMLElement).isConnected
                        )
                          return;
                        this.exceptionTarget = e.detail.value;
                        this.exceptionDraft = {
                          ...this.exceptionDraft,
                          target: targetFor(e.detail.value),
                        };
                        this.#exceptionScope?.changed();
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
            @click=${(event: Event) => void (event.currentTarget as HTMLElement).closest<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.requestClose("cancel")}
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
      >`,
    );
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
    const identity = this.#stationActionIdentity;
    const current = () =>
      this.isConnected &&
      this.stationAction !== undefined &&
      identity === this.#stationActionIdentity;
    const end = this.#todayEnd();
    const isFallback = action.kind === "fallback" || action.kind === "switch_off";
    const heading =
      action.kind === "switch_off"
        ? t("prep.disable")
        : action.kind === "fallback"
          ? t("prep.when_closed")
          : action.kind === "switch_on"
            ? t("prep.enable")
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
        ${todaySentence ? html`<p>${todaySentence}</p>` : nothing}
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
    const view = this.view;
    const active =
      view?.stations
        .filter((s) => s.active)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)) ?? [];
    const off = view?.routing.claims.filter((c) => c.stationOff) ?? [];
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
                if (!tab || (this.readOnly && tab !== "stations")) return;
                const proceed = () => {
                  this.tab = tab;
                  this.#url.write({ dashboard: "prep-stations", view: tab });
                };
                if (this.settingsEditor)
                  this.#leaveSettings("navigation", this.#settingsIdentity, proceed);
                else proceed();
              }}
            >
              ${
                this.readOnly
                  ? nothing
                  : html`<div slot="actions">
                      <wt-button @click=${() => this.#openStation()} data-test="new-station"
                        >${t("prep.new_station")}</wt-button
                      >
                      <wt-button
                        data-test="new-watcher"
                        @click=${() => {
                          this.watcherEditor = {};
                          this.watcherRefusal = undefined;
                        }}
                        >${t("watchers.new")}</wt-button
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
                <prep-station-health-table
                  .snapshot=${this.health}
                  .stations=${view.stations.map((station) => ({ ...station, displayOrder: this.stationOrder?.indexOf(station.id) ?? station.displayOrder }))}
                  .actions=${this.readOnly ? {} : Object.fromEntries(view.stations.map((station) => [station.id, this.#stationMenu(station)]))}
                  .today=${Object.fromEntries(
                    view.stations.map((station) => {
                      const status = this.#todayCell(station);
                      return [station.id, status === nothing ? "" : status];
                    }),
                  )}
                ></prep-station-health-table>
              </div>
              ${
                this.readOnly
                  ? nothing
                  : html`<div slot="routing">
                        ${this.#tester()}${this.#exceptions()}
                        <div class="cards">
                          ${active.map((s) => this.#stationCard(s))}<wt-card
                            data-test="no-preparation"
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
                        ${off.length ? html`<p>${t("prep.disabled")}: ${off.map((c) => html`${this.#path(c.categoryId)} — ${this.#targetName(c.target)}. ${this.#times(c.target.kind === "station" ? c.target.stationId : "")?.closedSendsTo ? t("prep.disabled_hint") : t("prep.disabled_no_replacement")}`)}</p>` : nothing}
                      </div>
                      <div slot="tickets">${this.#tickets()}</div>
                      <div slot="watchers">${this.#watchers()}</div>
                      <div slot="settings">${this.#settings()}</div>`
              }
            </wt-tabs>`
          : nothing
      }${this.error && !this.editor ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.readOnly ? nothing : html`${this.#dialog()}${this.#previewDialog()}${this.#stationActionDialog()}${this.#watcherDialogs()}${this.#watcherRenameDialog()}${this.#renameDialog()}`}`;
  }
}
