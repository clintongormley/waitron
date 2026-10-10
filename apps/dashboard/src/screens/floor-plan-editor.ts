import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  UndoHistory,
  UrlStateController,
  baseStyles,
  draftScopeFor,
  navigationGuardFor,
  saveActionState,
  type DraftScope,
  type FloorPlanCanvasCopy,
  type PlanCanvasTable,
  type TableMove,
  type TableRotate,
  type TableSelect,
  type WtFloorPlanCanvas,
  type WtSheet,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-floor-plan-canvas.js";
import "@waitron/ui/src/components/wt-sheet.js";
import "./floor-plan-add-join.js";
import "./floor-plan-add-tables.js";
import "./floor-plan-table-panel.js";
import "./floor-plan-tables-panel.js";
import { bookedReason } from "./floor-plan-booked.js";
import { dashboardPath } from "../navigation.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorPlan, FloorPlanSave } from "../api/client.js";
import {
  checkDraft,
  draftFromPlan,
  moveTable,
  rekeyDraft,
  restoreTable,
  rotateTable,
  sameDraft,
  saveFromDraft,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

export interface FloorPlanChange {
  draft: FloorPlanDraft;
  mergeKey?: string;
}

export interface FloorPlanSelect {
  key: string | null;
}

export interface FloorPlanAddJoinAsk {
  tableKey: string;
}

/** A panel field whose typed text the draft cannot hold. */
export type FloorPlanTypedField = "seats" | "width" | "height";

/** A panel refusing typed text (`text`), or saying the field it refused holds a value again. */
export type FloorPlanInvalid =
  | { key: string; field: FloorPlanTypedField; text: string; message: () => string }
  | { key: string; field: FloorPlanTypedField; text: null };

const HOME = "/manage";

/** Below this width of the page itself, the side panel becomes a bottom sheet. */
const NARROW_PX = 600;

/** The editor's one message, remembering whether a read or an action set it (CLAUDE.md §3). */
interface EditorMessage {
  text: () => string;
  from: "read" | "action";
  /** The generic sentence standing for a field's own; it goes when that field's mark goes. */
  fix?: true;
}

/** A table field a side panel shows, so a refusal naming it can sit beside it. */
export type FloorPlanField =
  "label" | "seats" | "fixed" | "width" | "height" | "shape" | "rotation";

export interface FloorPlanFieldError {
  key: string;
  field: FloorPlanField;
  message: string;
}

interface FieldMark {
  key: string;
  field: FloorPlanField;
  text: () => string;
  /** The editor's own check, or a panel's refusal of typed text, keeps Save disabled; a request's
   *  refusal never does. */
  from: "check" | "typed" | "refusal";
  /** The refused text, which the panel shows in place of the draft's value. */
  typed?: string;
}

const SERVER_FIELDS: Record<string, FloorPlanField> = {
  label: "label",
  seats: "seats",
  fixed: "fixed",
  "placement.width": "width",
  "placement.height": "height",
  "placement.shape": "shape",
  "placement.rotation": "rotation",
};

function fieldValue(table: DraftTable, field: FloorPlanField): unknown {
  if (field === "label" || field === "seats" || field === "fixed") return table[field];
  return table.placement?.[field] ?? null;
}

/** The marked table keeps its mark while it fails at all, even when `checkDraft` blames another. */
function tableProblem(
  draft: FloorPlanDraft,
  key: string,
): "label_missing" | "label_repeated" | null {
  const table = draft.tables.find((t) => t.key === key);
  if (table === undefined) return null;
  const label = table.label.trim();
  if (label === "") return "label_missing";
  return draft.tables.some((t) => t.key !== key && t.label.trim() === label)
    ? "label_repeated"
    : null;
}

const actionMessage = (text: () => string): EditorMessage => ({ text, from: "action" });

/** A table a save could not delete, put back; the mark lasts while the draft holds this object. */
interface RefusedTable {
  table: DraftTable;
  reason: () => string;
}

/** The server stores labels trimmed; tables sent with a padded label take the trimmed one. */
function trimLabels(draft: FloorPlanDraft, sent: FloorPlanDraft = draft): FloorPlanDraft {
  const padded = new Map(
    sent.tables.flatMap((t) => (t.label === t.label.trim() ? [] : [[t.key, t.label] as const])),
  );
  if (padded.size === 0) return draft;
  return {
    ...draft,
    tables: draft.tables.map((t) =>
      padded.get(t.key) === t.label ? { ...t, label: t.label.trim() } : t,
    ),
  };
}

/** `back` when it is a dashboard path on this origin, else the dashboard's home. */
function closeHref(back: string | null): string {
  if (back === null) return HOME;
  try {
    const url = new URL(back, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith(`${HOME}/`)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // An unparsable `back` falls through to home.
  }
  return HOME;
}

@customElement("dashboard-floor-plan-editor")
export class FloorPlanEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2) var(--wt-space-4);
      }
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      wt-form-actions {
        flex: 1 1 auto;
        width: auto;
      }
      /* On a phone Reload takes a row of its own, so the form's four buttons keep theirs. */
      header.narrow wt-button[data-action="load-newer"] {
        flex-basis: 100%;
      }
      .note {
        margin: var(--wt-space-2) 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .load-error {
        margin: var(--wt-space-4) 0;
        color: var(--wt-color-danger);
      }
      wt-floor-plan-canvas {
        height: 70vh;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(192px, 288px);
        gap: var(--wt-space-4);
        align-items: start;
      }
      .layout.narrow {
        display: block;
      }
      .width-probe {
        height: 0;
      }
      wt-sheet {
        position: sticky;
        bottom: 0;
      }
      /* The same box as a wt-button variant="secondary". */
      a.close {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-decoration: none;
      }
      a.close:hover {
        border-color: var(--wt-color-primary-text);
      }
      a.close:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private plan: FloorPlan | null = null;
  @state() private zoneName: string | null = null;
  @state() private draft: FloorPlanDraft | null = null;
  @state() private selected: string | null = null;
  @state() private loadError: string | null = null;
  @state() private back: string | null = null;
  @state() private revision = 0;
  @state() private message: EditorMessage | null = null;
  @state() private outOfDate = false;
  @state() private saving = false;
  @state() private mark: FieldMark | null = null;
  @state() private loadingNewer = false;
  @state() private narrow = false;
  @state() private sheetOpen = false;
  @state() private refused: RefusedTable | null = null;
  /** How far the phone sheet reaches up over the canvas, in px. */
  @state() private sheetOverlap = 0;

  /** The field a refusal or the editor's own check points at, for the side panels. */
  get fieldError(): FloorPlanFieldError | null {
    const mark = this.mark;
    return mark === null ? null : { key: mark.key, field: mark.field, message: mark.text() };
  }

  /** The body of the last save sent, so a refusal naming `tables.<i>` finds the key it meant. */
  protected sent: FloorPlanSave | null = null;

  /** Other tables of the venue, for the panels' name checks. */
  protected venueTables: DashboardTable[] = [];

  #zoneId: string | null = null;
  #newKeys = 0;
  /** Monotonic, so a key never returns: not after a save turns `new:<n>` into an id, nor on undo. */
  readonly #nextKey = (): string => `new:${++this.#newKeys}`;
  #joinKeys = 0;
  readonly #nextJoinKey = (): string => `join:${++this.#joinKeys}`;
  #request = 0;
  #saveRequest = 0;
  /** The refused field's value when the refusal arrived. */
  #markedValue: unknown;
  #history: UndoHistory<FloorPlanDraft> | null = null;
  #opened: FloorPlanDraft | null = null;
  #scope?: DraftScope<FloorPlanDraft>;
  readonly #scopeId = {};

  readonly #url = new UrlStateController(this, () => this.#route(), dashboardPath);

  /** Watches a zero-height probe, not the host: the host's height changes when `narrow` flips. */
  readonly #resize = new ResizeObserver(([entry]) => {
    this.narrow = entry!.contentRect.width < NARROW_PX;
  });

  /** The sheet grows and shrinks with its panels after it is drawn, so its height is watched. */
  readonly #sheetResize = new ResizeObserver(() => void this.#reveal());
  #watchedSheet: WtSheet | null = null;
  /** Set by a new selection or the sheet opening, cleared by the user's press, wheel or page
   *  scroll, so a later change in the sheet's height never moves a canvas the user has panned. */
  #revealing = false;
  readonly #userScrolls = (): void => {
    this.#revealing = false;
  };

  constructor() {
    super();
    new LocaleChangeController(this);
    this.addEventListener("floor-plan-change", (event) => {
      const { draft, mergeKey } = (event as CustomEvent<FloorPlanChange>).detail;
      this.#change(draft, mergeKey);
    });
    this.addEventListener("floor-plan-add-tables", () => {
      this.renderRoot.querySelector("floor-plan-add-tables")?.show();
    });
    this.addEventListener("floor-plan-add-join", (event) => {
      const { tableKey } = (event as CustomEvent<FloorPlanAddJoinAsk>).detail;
      this.renderRoot.querySelector("floor-plan-add-join")?.show(tableKey);
    });
    this.addEventListener("floor-plan-invalid", (event) => {
      this.#typed((event as CustomEvent<FloorPlanInvalid>).detail);
    });
    this.addEventListener("floor-plan-select", (event) => {
      this.selected = (event as CustomEvent<FloorPlanSelect>).detail.key;
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
    window.addEventListener("pointerdown", this.#userScrolls, { capture: true, passive: true });
    window.addEventListener("wheel", this.#userScrolls, { capture: true, passive: true });
    window.addEventListener("scroll", this.#userScrolls, { passive: true });
    void this.updateComplete.then(() => {
      if (this.isConnected) this.#resize.observe(this.renderRoot.querySelector(".width-probe")!);
    });
  }

  override disconnectedCallback(): void {
    this.#saveRequest++;
    this.saving = false;
    this.loadingNewer = false;
    this.#resize.disconnect();
    this.#sheetResize.disconnect();
    this.#watchedSheet = null;
    window.removeEventListener("pointerdown", this.#userScrolls, { capture: true });
    window.removeEventListener("wheel", this.#userScrolls, { capture: true });
    window.removeEventListener("scroll", this.#userScrolls);
    this.#disposeScope();
    super.disconnectedCallback();
  }

  override willUpdate(): void {
    if (!this.isConnected || this.draft === null || this.#scope) return;
    this.#scope = draftScopeFor<FloorPlanDraft>(this, {
      id: this.#scopeId,
      parent: this,
      current: () => this.draft!,
      snapshot: (value) => value,
      equal: sameDraft,
      restore: (value) => {
        this.draft = value;
        this.#history?.reset(value);
        this.selected = null;
        this.refused = null;
        this.#clearMark();
      },
    }).scope;
    this.#scope.commit(this.#opened!);
    this.#scope.changed();
  }

  override updated(changed: Map<string, unknown>): void {
    const sheet = this.renderRoot.querySelector("wt-sheet");
    if (sheet !== this.#watchedSheet) {
      this.#sheetResize.disconnect();
      this.#watchedSheet = sheet;
      if (sheet !== null) this.#sheetResize.observe(sheet, { box: "border-box" });
    }
    if (changed.has("selected") || (changed.has("sheetOpen") && this.sheetOpen)) {
      this.#revealing = true;
      void this.#reveal();
    }
  }

  /** On a phone, keeps the selected table in the part of the canvas the sheet leaves showing. */
  async #reveal(): Promise<void> {
    const canvas = this.renderRoot.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas");
    const sheet = this.#watchedSheet;
    if (canvas === null || sheet === null) return;
    await Promise.all([canvas.updateComplete, sheet.updateComplete]);
    this.sheetOverlap = Math.max(
      0,
      canvas.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top,
    );
    await this.updateComplete;
    await canvas.updateComplete;
    const key = this.selected;
    if (this.#revealing && key !== null) canvas.reveal(key);
  }

  #disposeScope(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
  }

  #route(): void {
    this.back = new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get("back");
    const zoneId = this.#url.read("zone");
    if (zoneId === this.#zoneId) return;
    this.#zoneId = zoneId;
    const request = ++this.#request;
    this.#saveRequest++;
    this.saving = false;
    this.loadingNewer = false;
    this.#disposeScope();
    this.plan = null;
    this.zoneName = null;
    this.draft = null;
    this.#opened = null;
    this.#history = null;
    this.selected = null;
    this.loadError = null;
    this.message = null;
    this.outOfDate = false;
    this.mark = null;
    this.refused = null;
    this.sent = null;
    if (zoneId !== null) void this.#load(zoneId, request);
  }

  async #load(zoneId: string, request: number): Promise<void> {
    try {
      const [plan, zones, tables] = await Promise.all([
        this.api.getFloorPlan(zoneId),
        this.api.listZones(),
        this.api.listTables({ includeDisabled: true }),
      ]);
      if (request !== this.#request) return;
      const draft = draftFromPlan(plan);
      this.plan = plan;
      this.revision = plan.revision;
      this.zoneName = zones.find((zone) => zone.id === zoneId)?.name ?? null;
      this.venueTables = tables;
      this.#opened = draft;
      this.#history = new UndoHistory(draft);
      this.draft = draft;
    } catch (error) {
      if (request !== this.#request) return;
      this.loadError = codeOf(error);
    }
  }

  #change(next: FloorPlanDraft, mergeKey?: string): void {
    if (this.#history === null || next === this.draft) return;
    this.#history.push(next, mergeKey);
    this.draft = next;
    this.#clearReadMessage();
    this.#followMark(next);
    this.#followRefused(next);
    this.#scope?.changed();
    this.requestUpdate();
  }

  #step(next: FloorPlanDraft | undefined): void {
    if (next === undefined) return;
    this.draft = next;
    if (this.mark?.from === "typed") this.#clearMark();
    this.#clearReadMessage();
    this.#followMark(next);
    this.#followRefused(next);
    if (this.selected !== null && !next.tables.some((table) => table.key === this.selected)) {
      this.selected = null;
    }
    this.#scope?.changed();
    this.requestUpdate();
  }

  /** Typed text stays marked until its field holds a value again, or the draft's value changes. */
  #typed(detail: FloorPlanInvalid): void {
    const mark = this.mark;
    if (detail.text === null) {
      if (mark?.from === "typed" && mark.key === detail.key && mark.field === detail.field) {
        this.#clearMark();
      }
      return;
    }
    const table = this.draft?.tables.find((t) => t.key === detail.key);
    if (table === undefined) return;
    this.#markedValue = fieldValue(table, detail.field);
    this.#setMark({
      key: detail.key,
      field: detail.field,
      text: detail.message,
      from: "typed",
      typed: detail.text,
    });
  }

  /** A table a check or a refusal points at; on a phone the sheet opens so its fields show. */
  #selectFlagged(key: string): void {
    this.selected = key;
    if (this.narrow) this.sheetOpen = true;
  }

  #clearReadMessage(): void {
    if (this.message?.from === "read") this.message = null;
  }

  #showReadFailure(error: unknown): void {
    if (this.message?.from === "action") return;
    const code = codeOf(error);
    this.message = { text: () => codeMessage(code), from: "read" };
  }

  #setMark(mark: FieldMark): void {
    this.mark = mark;
    this.message = { ...actionMessage(() => t("form.fix_fields")), fix: true };
  }

  #clearMark(): void {
    this.mark = null;
    if (this.message?.fix) this.message = null;
  }

  #markCheck(draft: FloorPlanDraft): boolean {
    const problem = checkDraft(draft);
    if (problem === null) return false;
    this.#markProblem(problem);
    return true;
  }

  #markProblem(problem: NonNullable<ReturnType<typeof checkDraft>>): void {
    this.#setMark({
      key: problem.key,
      field: "label",
      text: () =>
        problem.problem === "label_missing"
          ? t("floor_plan_editor.name_missing")
          : codeMessage("table.label_taken"),
      from: "check",
    });
  }

  #followRefused(next: FloorPlanDraft): void {
    const refused = this.refused;
    if (refused !== null && !next.tables.includes(refused.table)) this.refused = null;
  }

  /** Puts a table the save could not delete back as last saved, with its joins, as one undo step,
   *  marked and selected. */
  #restoreRefused(table: DraftTable, params: Record<string, unknown>): void {
    this.#change(restoreTable(this.draft!, table, this.#opened!.joins));
    const restored = this.draft!.tables.find((t) => t.key === table.key)!;
    this.refused = { table: restored, reason: () => bookedReason(params) };
    this.#selectFlagged(restored.key);
  }

  /** A check's mark follows the draft until it passes; a refusal's goes when its field changes. */
  #followMark(next: FloorPlanDraft): void {
    const mark = this.mark;
    if (mark === null) return;
    if (mark.from === "check") {
      const own = tableProblem(next, mark.key);
      if (own !== null) this.#markProblem({ key: mark.key, problem: own });
      else if (this.#markCheck(next)) this.#selectFlagged(this.mark!.key);
      else this.#clearMark();
      return;
    }
    const table = next.tables.find((t) => t.key === mark.key);
    if (table === undefined || fieldValue(table, mark.field) !== this.#markedValue) {
      this.#clearMark();
    }
  }

  #placeRefusal(code: string, params: Record<string, unknown>, body: FloorPlanSave): void {
    const own = () => codeMessage(code);
    const draft = this.draft!;
    let key: string | undefined;
    let serverField: string | undefined;
    if (code === "table.label_taken" && typeof params.label === "string") {
      const label = params.label;
      key = draft.tables.find((t) => t.label.trim() === label)?.key;
      serverField = "label";
    } else if (code === "floor_plan.invalid" && typeof params.field === "string") {
      const named = /^tables\.(\d+)\.(.+)$/.exec(params.field);
      const sentKey = named === null ? undefined : body.tables[Number(named[1])]?.key;
      key = draft.tables.find((t) => t.key === sentKey)?.key;
      serverField = named?.[2];
    } else if (code === "table.booked" && typeof params.tableId === "string") {
      const tableId = params.tableId;
      const table = this.#opened!.tables.find((t) => t.liveTableId === tableId);
      if (table !== undefined) {
        this.#restoreRefused(table, params);
        return;
      }
    }
    this.message = actionMessage(own);
    if (key === undefined) return;
    this.#selectFlagged(key);
    const field = serverField === undefined ? undefined : SERVER_FIELDS[serverField];
    if (field === undefined) return;
    const table = draft.tables.find((t) => t.key === key)!;
    this.#markedValue = fieldValue(table, field);
    this.#setMark({ key, field, text: own, from: "refusal" });
  }

  readonly #save = async (): Promise<void> => {
    if (this.saving || this.loadingNewer || saveActionState(this.#scope).unchanged) return;
    if (this.mark?.from === "typed") return;
    if (this.#markCheck(this.draft!)) {
      this.#selectFlagged(this.mark!.key);
      return;
    }
    // A scope exists only once a zone's plan is loaded, so both are set here.
    const zoneId = this.#zoneId!;
    const draft = this.draft!;
    const sentDraft = trimLabels(draft);
    const body = saveFromDraft(this.revision, sentDraft);
    const request = this.#request;
    const saveRequest = ++this.#saveRequest;
    this.sent = body;
    this.saving = true;
    this.message = null;
    this.mark = null;
    this.refused = null;
    let answer: { revision: number; ids: Record<string, string> };
    try {
      answer = await this.api.saveFloorPlan(zoneId, body);
    } catch (error) {
      if (saveRequest !== this.#saveRequest) return;
      this.saving = false;
      if (request !== this.#request) return;
      const code = codeOf(error);
      if (code === "floor_plan.out_of_date") this.outOfDate = true;
      const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
      this.#placeRefusal(code, params, body);
      return;
    }
    if (saveRequest !== this.#saveRequest) return;
    this.saving = false;
    if (request !== this.#request) return;
    const { ids } = answer;
    const saved = rekeyDraft(sentDraft, ids);
    const current = rekeyDraft(trimLabels(this.draft!, draft), ids);
    this.renderRoot.querySelector("floor-plan-add-join")?.rekey(ids);
    this.revision = answer.revision;
    this.outOfDate = false;
    this.#opened = saved;
    this.#scope?.commit(saved);
    this.#history?.reset(current);
    this.draft = current;
    if (this.selected !== null && Object.hasOwn(ids, this.selected))
      this.selected = ids[this.selected]!;
    this.#scope?.changed();
    void this.#reread(zoneId, ++this.#request, false);
  };

  readonly #loadNewer = (): void => {
    this.loadingNewer = true;
    void this.#reread(this.#zoneId!, ++this.#request, true);
  };

  /** A refresh replaces only an unchanged draft; Reload replaces it whatever it holds. */
  async #reread(zoneId: string, request: number, replace: boolean): Promise<void> {
    let plan: FloorPlan;
    try {
      plan = await this.api.getFloorPlan(zoneId);
    } catch (error) {
      if (this.isConnected && request === this.#request) {
        this.loadingNewer = false;
        this.#showReadFailure(error);
      }
      return;
    }
    if (!this.isConnected || request !== this.#request) return;
    this.loadingNewer = false;
    this.#clearReadMessage();
    if (replace) {
      this.outOfDate = false;
      this.message = null;
      this.mark = null;
      this.refused = null;
    } else if (!saveActionState(this.#scope).unchanged) {
      return;
    }
    const draft = draftFromPlan(plan);
    this.plan = plan;
    this.revision = plan.revision;
    this.#opened = draft;
    this.#scope?.commit(draft);
    this.#history?.reset(draft);
    this.draft = draft;
    if (this.selected !== null && !draft.tables.some((t) => t.key === this.selected)) {
      this.selected = null;
    }
    this.#scope?.changed();
  }

  readonly #onMove = (event: CustomEvent<TableMove>): void => {
    if (this.draft === null) return;
    const { key, x, y } = event.detail;
    this.#change(moveTable(this.draft, key, x, y));
  };

  readonly #onRotate = (event: CustomEvent<TableRotate>): void => {
    if (this.draft === null) return;
    this.#change(rotateTable(this.draft, event.detail.key, event.detail.rotation));
  };

  readonly #onSelect = (event: CustomEvent<TableSelect>): void => {
    this.selected = event.detail.key;
  };

  #tablesFor: FloorPlanDraft | null = null;
  #tablesRefused: RefusedTable | null = null;
  #tablesLocale: string | null = null;
  #tables: PlanCanvasTable[] = [];

  #canvasTables(draft: FloorPlanDraft): PlanCanvasTable[] {
    const refused = this.refused;
    const locale = currentLocale();
    if (
      draft !== this.#tablesFor ||
      refused !== this.#tablesRefused ||
      locale !== this.#tablesLocale
    ) {
      this.#tablesFor = draft;
      this.#tablesRefused = refused;
      this.#tablesLocale = locale;
      this.#tables = draft.tables.flatMap((table) =>
        table.placement === null
          ? []
          : [
              {
                key: table.key,
                label: table.label,
                fixed: table.fixed,
                placement: table.placement,
                ...(refused?.table === table ? { refused: refused.reason() } : {}),
              },
            ],
      );
    }
    return this.#tables;
  }

  #takenFor: FloorPlanDraft | null = null;
  #takenTables: DashboardTable[] | null = null;
  #taken: ReadonlySet<string> = new Set();

  /** Decision 8: another zone's tables, and this zone's switched-off ones no draft table follows. */
  #takenElsewhere(draft: FloorPlanDraft): ReadonlySet<string> {
    if (draft !== this.#takenFor || this.venueTables !== this.#takenTables) {
      this.#takenFor = draft;
      this.#takenTables = this.venueTables;
      const followed = new Set(draft.tables.map((t) => t.liveTableId));
      this.#taken = new Set(
        this.venueTables
          .filter((t) => (t.zoneId === this.#zoneId ? !t.active && !followed.has(t.id) : true))
          .map((t) => t.label),
      );
    }
    return this.#taken;
  }

  #panelFor: RefusedTable | null = null;
  #panelLocale: string | null = null;
  #panelRefused: { key: string; reason: string } | null = null;

  /** The same object while the mark and the language stay, so the panel does not redraw for it. */
  #refusedForPanel(): { key: string; reason: string } | null {
    const refused = this.refused;
    const locale = currentLocale();
    if (refused !== this.#panelFor || locale !== this.#panelLocale) {
      this.#panelFor = refused;
      this.#panelLocale = locale;
      this.#panelRefused =
        refused === null ? null : { key: refused.table.key, reason: refused.reason() };
    }
    return this.#panelRefused;
  }

  #errorFor: FieldMark | null = null;
  #errorKey: string | null = null;
  #errorLocale: string | null = null;
  #panelErrorValue: { field: string; message: string; text?: string } | null = null;

  /** The mark for the selected table only; the same object while it, the key and the language stay. */
  #panelError(key: string): { field: string; message: string; text?: string } | null {
    const mark = this.mark;
    const locale = currentLocale();
    if (mark !== this.#errorFor || key !== this.#errorKey || locale !== this.#errorLocale) {
      this.#errorFor = mark;
      this.#errorKey = key;
      this.#errorLocale = locale;
      this.#panelErrorValue =
        mark === null || mark.key !== key
          ? null
          : {
              field: mark.field,
              message: mark.text(),
              ...(mark.typed === undefined ? {} : { text: mark.typed }),
            };
    }
    return this.#panelErrorValue;
  }

  #copyLocale: string | null = null;
  #copy!: FloorPlanCanvasCopy;

  #canvasCopy(): FloorPlanCanvasCopy {
    const locale = currentLocale();
    if (locale !== this.#copyLocale) {
      this.#copyLocale = locale;
      this.#copy = {
        label: t("floor_plan_editor.title"),
        fixed: t("floor_plan_editor.fixed"),
        rotate: t("floor_plan_editor.rotate"),
      };
    }
    return this.#copy;
  }

  #body(draft: FloorPlanDraft) {
    const canvas = html`<wt-floor-plan-canvas
      .tables=${this.#canvasTables(draft)}
      .selected=${this.selected}
      .copy=${this.#canvasCopy()}
      .bottomInset=${this.narrow ? this.sheetOverlap : 0}
      @wt-table-move=${this.#onMove}
      @wt-table-rotate=${this.#onRotate}
      @wt-table-select=${this.#onSelect}
    ></wt-floor-plan-canvas>`;
    const panel = html`<floor-plan-tables-panel
      .draft=${draft}
      .selected=${this.selected}
      .refused=${this.#refusedForPanel()}
      .inSheet=${this.narrow}
    ></floor-plan-tables-panel>`;
    const tablePanel =
      this.selected !== null && draft.tables.some((table) => table.key === this.selected)
        ? html`<floor-plan-table-panel
            .draft=${draft}
            .tableKey=${this.selected}
            .fieldError=${this.#panelError(this.selected)}
          ></floor-plan-table-panel>`
        : nothing;
    const panels = html`${tablePanel}${panel}`;
    return html`<div class="layout ${this.narrow ? "narrow" : ""}">
        ${canvas}${this.narrow ? this.#sheet(draft, panels) : html`<div class="side">${panels}</div>`}
      </div>
      <floor-plan-add-tables
        .draft=${draft}
        .zoneName=${this.zoneName ?? ""}
        .takenElsewhere=${this.#takenElsewhere(draft)}
        .nextKey=${this.#nextKey}
        .draftParent=${this.#scopeId}
      ></floor-plan-add-tables>
      <floor-plan-add-join
        .draft=${draft}
        .nextJoinKey=${this.#nextJoinKey}
        .draftParent=${this.#scopeId}
      ></floor-plan-add-join>`;
  }

  #sheet(draft: FloorPlanDraft, panel: unknown) {
    const label = draft.tables.find((table) => table.key === this.selected)?.label.trim();
    return html`<wt-sheet
      .heading=${label || t("floor_plan_editor.tables")}
      .expanded=${this.sheetOpen}
      @wt-sheet-toggle=${(event: CustomEvent<{ expanded: boolean }>) => {
        this.sheetOpen = event.detail.expanded;
      }}
      >${panel}</wt-sheet
    >`;
  }

  override render() {
    const save = saveActionState(this.#scope);
    const history = this.#history;
    return html`
      <div class="width-probe"></div>
      <header class=${this.narrow ? "narrow" : ""}>
        <h1>${this.zoneName ?? t("floor_plan_editor.title")}</h1>
        <wt-form-actions .error=${this.message === null ? "" : this.message.text()}>
          <a slot="cancel" class="close" data-action="close" href=${closeHref(this.back)}
            >${t("action.close")}</a
          >
          ${
            this.outOfDate && !this.saving
              ? html`<wt-button
                  slot="secondary"
                  data-action="load-newer"
                  variant="secondary"
                  @click=${this.#loadNewer}
                  >${t("floor_plan_editor.load_newer")}</wt-button
                >`
              : nothing
          }
          <wt-button
            slot="secondary"
            data-action="undo"
            variant="secondary"
            ?disabled=${!history?.canUndo}
            @click=${() => this.#step(history?.undo())}
            >${t("floor_plan_editor.undo")}</wt-button
          >
          <wt-button
            slot="secondary"
            data-action="redo"
            variant="secondary"
            ?disabled=${!history?.canRedo}
            @click=${() => this.#step(history?.redo())}
            >${t("floor_plan_editor.redo")}</wt-button
          >
          <wt-button
            data-action="save"
            variant=${save.variant}
            ?disabled=${
              save.unchanged ||
              this.loadingNewer ||
              (this.mark !== null && this.mark.from !== "refusal")
            }
            @click=${this.#save}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </header>
      ${
        this.plan === null
          ? nothing
          : html`<p class="note" data-note>
              ${t(this.revision === 0 ? "floor_plan_editor.first_note" : "floor_plan_editor.note")}
            </p>`
      }
      ${
        this.loadError !== null
          ? html`<p class="load-error" role="alert" data-load-error>
              ${codeMessage(this.loadError)}
            </p>`
          : this.draft === null
            ? nothing
            : this.#body(this.draft)
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plan-editor": FloorPlanEditor;
  }
}
