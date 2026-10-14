import { html, nothing, type ReactiveController, type ReactiveControllerHost } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { MenuPeriodInput, OpeningHoursModel } from "../menu-timetable-types.js";
import type { PaintedIn } from "../period-delete.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { PaintPot } from "./paint-row.js";
import type { PeriodDialog } from "./period-dialog.js";
import { refusalOf } from "./refusal.js";
import { t } from "./strings.js";
import "./period-dialog.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];

/** The Periods page, which a painter's bar links to. */
export function periodsLink() {
  return html`<a slot="link" data-test="periods-link" href="/manage/periods"
    >${t("nav.periods")}</a
  >`;
}

/**
 * A painter's ✎ on each period chip and "+ New period": one period dialog at a time, saved on its
 * own. A period just created is chosen, through `chose`, before the model lists it.
 */
export class PeriodEditing implements ReactiveController {
  private editor?: {
    period?: Period;
    departmentId: string;
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
    },
  ) {
    host.addController(this);
  }

  hostUpdate() {
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

  open(department: Department, period?: Period) {
    if (this.editor || this.busy) return;
    const editor = {
      period,
      departmentId: department.id,
      clockRevision: this.options.model().clockRevision,
    };
    this.editor = editor;
    this.host.requestUpdate();
    if (period) void this.readPaintedIn(editor, period.id);
  }

  private async readPaintedIn(editor: NonNullable<PeriodEditing["editor"]>, periodId: string) {
    let rows;
    try {
      rows = await this.options.api().readPaintedIn();
    } catch {
      return;
    }
    const row = rows.find((candidate) => candidate.periodId === periodId);
    if (this.editor !== editor || !row) return;
    editor.paintedIn = { seasons: row.seasons, specialDays: row.specialDays };
    this.host.requestUpdate();
  }

  private async save(event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>) {
    event.stopPropagation();
    const editor = this.editor;
    const component = event.currentTarget as PeriodDialog;
    if (
      !editor ||
      this.busy ||
      !this.host.isConnected ||
      component !== this.host.renderRoot.querySelector("period-dialog")
    )
      return;
    const { periodId, input } = event.detail;
    const api = this.options.api();
    this.setBusy(true);
    component.refusal = undefined;
    let created: string | undefined;
    try {
      if (periodId === null)
        created = (await api.createPeriod(editor.departmentId, input, editor.clockRevision)).id;
      else await api.updatePeriod(periodId, input, editor.clockRevision);
    } catch (error) {
      if (this.editor === editor && this.host.isConnected) component.refusal = refusalOf(error);
      return;
    } finally {
      if (this.editor === editor) this.setBusy(false);
    }
    if (created !== undefined) {
      this.created = { id: created, departmentId: editor.departmentId };
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

  render(): unknown {
    const editor = this.editor;
    const department = this.options
      .model()
      .departments.find(({ id }) => id === editor?.departmentId);
    if (!editor || !department) return nothing;
    return keyed(
      editor,
      html`<period-dialog
        .open=${true}
        .period=${editor.period}
        .paintedIn=${editor.paintedIn}
        .paintedInLinks=${false}
        .seasons=${this.options.model().seasons}
        .departmentId=${department.id}
        .departmentName=${department.name}
        .usedColours=${department.periods.map(({ colour }) => colour)}
        .menus=${this.options.model().menus}
        .busy=${this.busy}
        .submitLabel=${editor.period ? "" : t("painter.add_and_paint")}
        @period-save=${(event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>) =>
          void this.save(event)}
        @period-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editor === editor && !this.busy) this.close();
        }}
      ></period-dialog>`,
    );
  }
}
