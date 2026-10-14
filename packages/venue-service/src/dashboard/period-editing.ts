import { html, nothing, type ReactiveController, type ReactiveControllerHost } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { MenuPeriodInput, OpeningHoursModel } from "../menu-timetable-types.js";
import type { PaintedIn } from "../period-delete.js";
import type { OpeningHoursApi, PaintedInRow } from "./opening-hours-client.js";
import type { PaintPot } from "./paint-row.js";
import type { PeriodDialog } from "./period-dialog.js";
import { refusalOf } from "./refusal.js";
import { t } from "./strings.js";
import "./period-dialog.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
type SaveDetail = { periodId: string | null; input: MenuPeriodInput; departmentId?: string };

/** The Periods page, which a painter's bar links to. */
export function periodsLink() {
  return html`<a slot="link" data-test="periods-link" href="/manage/periods"
    >${t("nav.periods")}</a
  >`;
}

/**
 * One period dialog at a time, saved on its own: a painter's ✎ and "+ New period", or the Periods
 * page's Add and Edit. A period just created is chosen, through `chose`, before the model lists it.
 */
export class PeriodEditing implements ReactiveController {
  private editor?: {
    period?: Period;
    /** Null while the dialog asks for the department. */
    departmentId: string | null;
    clockRevision: number;
    paintedIn?: PaintedIn;
  };
  private busy = false;
  /** A period just created, chosen in its own department until the model lists it. */
  private created?: { id: string; departmentId: string };

  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement & { renderRoot: ParentNode },
    private readonly options: {
      api: () => OpeningHoursApi;
      model: () => OpeningHoursModel;
      chose: (periodId: string) => void;
      /** `open(null)` asks for the department in the dialog. */
      chooseDepartment?: boolean;
      /** The host's own Painted-in watch; without it, opening a period reads Painted in once. */
      paintedIn?: () => readonly PaintedInRow[] | undefined;
      paintedInLinks?: boolean;
      readOnly?: () => boolean;
      /** Offers Delete… in the dialog; called once the dialog has closed itself to hand over. */
      onDelete?: (department: Department, period: Period) => void;
    },
  ) {
    host.addController(this);
  }

  hostUpdate() {
    const editor = this.editor;
    if (editor) {
      const department = this.options
        .model()
        .departments.find(({ id, active }) => active && id === editor.departmentId);
      if (
        (editor.departmentId !== null && !department) ||
        (editor.period && !department?.periods.some(({ id }) => id === editor.period!.id))
      ) {
        this.editor = undefined;
        this.busy = false;
      }
    }
    const created = this.created;
    if (
      created &&
      this.options
        .model()
        .departments.some(
          ({ id, periods }) =>
            id === created.departmentId && periods.some((period) => period.id === created.id),
        )
    )
      this.created = undefined;
  }

  /** Whether a period dialog is open, or its write is still pending. */
  get editing(): boolean {
    return this.editor !== undefined || this.busy;
  }

  /** Whether `periodId` can be painted in `department`: one of its periods, or one just created. */
  paints(department: Department, periodId: string): boolean {
    return (
      (this.created?.departmentId === department.id && this.created.id === periodId) ||
      department.periods.some(({ id }) => id === periodId)
    );
  }

  /** The department's periods as paint chips, each with its ✎. */
  pots(department: Department): PaintPot[] {
    return department.periods.map((period) => ({
      ...period,
      edit: () => this.open(department, period),
    }));
  }

  open(department: Department | null, period?: Period) {
    if (this.editor || this.busy || !this.host.isConnected || this.options.readOnly?.()) return;
    if (!department && !this.options.chooseDepartment) return;
    const editor = {
      period,
      departmentId: department?.id ?? null,
      clockRevision: this.options.model().clockRevision,
    };
    this.editor = editor;
    this.host.requestUpdate();
    if (period && !this.options.paintedIn) void this.readPaintedIn(editor, period.id);
  }

  private async readPaintedIn(editor: NonNullable<PeriodEditing["editor"]>, periodId: string) {
    let row;
    try {
      const rows = await this.options.api().readPaintedIn();
      row = rows.find((candidate) => candidate.periodId === periodId);
    } catch {
      return;
    }
    if (this.editor !== editor || !row) return;
    editor.paintedIn = { seasons: row.seasons, specialDays: row.specialDays };
    this.host.requestUpdate();
  }

  private async save(event: CustomEvent<SaveDetail>) {
    event.stopPropagation();
    const editor = this.editor;
    const component = event.currentTarget as PeriodDialog;
    if (
      !editor ||
      this.busy ||
      this.options.readOnly?.() ||
      !this.host.isConnected ||
      component !== this.host.renderRoot.querySelector("period-dialog")
    )
      return;
    const { periodId, input } = event.detail;
    const departmentId = event.detail.departmentId ?? editor.departmentId;
    if (periodId === null && !departmentId) return;
    const api = this.options.api();
    this.setBusy(true);
    component.refusal = undefined;
    let created: string | undefined;
    try {
      if (periodId === null)
        created = (await api.createPeriod(departmentId!, input, editor.clockRevision)).id;
      else await api.updatePeriod(periodId, input, editor.clockRevision);
    } catch (error) {
      if (this.editor === editor && this.host.isConnected) component.refusal = refusalOf(error);
      return;
    } finally {
      if (this.editor === editor) this.setBusy(false);
    }
    if (created !== undefined) {
      this.created = { id: created, departmentId: departmentId! };
      this.options.chose(created);
    }
    if (this.editor === editor && component.commitSubmitted(input)) this.close();
    api.rereadWatches();
  }
  private setBusy(busy: boolean) {
    this.busy = busy;
    this.host.requestUpdate();
  }
  private close() {
    this.editor = undefined;
    this.host.requestUpdate();
  }

  private paintedIn(editor: NonNullable<PeriodEditing["editor"]>): PaintedIn | undefined {
    if (!this.options.paintedIn) return editor.paintedIn;
    const row = this.options.paintedIn()?.find(({ periodId }) => periodId === editor.period?.id);
    return row && { seasons: row.seasons, specialDays: row.specialDays };
  }

  render(): unknown {
    const editor = this.editor;
    if (!editor) return nothing;
    const model = this.options.model();
    const colours = (department: Department) => department.periods.map(({ colour }) => colour);
    const department = model.departments.find(({ id }) => id === editor.departmentId);
    if (editor.departmentId !== null && !department) return nothing;
    return keyed(
      editor,
      html`<period-dialog
        .open=${true}
        .period=${editor.period}
        .paintedIn=${this.paintedIn(editor)}
        .paintedInLinks=${this.options.paintedInLinks ?? false}
        .seasons=${model.seasons}
        .departmentId=${department?.id ?? ""}
        .departmentName=${department?.name ?? ""}
        .usedColours=${department ? colours(department) : []}
        .departments=${
          department
            ? undefined
            : model.departments
                .filter(({ active }) => active)
                .map((entry) => ({ id: entry.id, name: entry.name, usedColours: colours(entry) }))
        }
        .menus=${model.menus}
        .busy=${this.busy}
        .deletable=${this.options.onDelete !== undefined}
        .submitLabel=${
          editor.period || this.options.chooseDepartment ? "" : t("painter.add_and_paint")
        }
        @period-save=${(event: CustomEvent<SaveDetail>) => void this.save(event)}
        @period-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editor === editor && !this.busy) this.close();
        }}
        @period-delete=${(event: CustomEvent<{ periodId: string }>) => {
          event.stopPropagation();
          const period = editor.period;
          if (
            (this.editor !== undefined && this.editor !== editor) ||
            this.busy ||
            !department ||
            event.currentTarget !== this.host.renderRoot.querySelector("period-dialog") ||
            !period ||
            period.id !== event.detail.periodId
          )
            return;
          if (this.editor === editor) this.close();
          this.options.onDelete?.(department, period);
        }}
      ></period-dialog>`,
    );
  }
}
