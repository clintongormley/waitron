import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import {
  QueryController,
  codeMessage,
  codeOf,
  t as tKit,
  type CalendarViewHost,
} from "@waitron/dashboard-kit";
import {
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { areaKey, type AreaRef } from "../slots.js";
import type { StaffRole } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { columnErrorsKeeper, guidesKeeper, staffRoleDialog } from "./painter-parts.js";
import { t, tf } from "./strings.js";

interface Refused {
  message: string;
  area?: string;
  column?: string;
  reason?: string;
}

export abstract class StaffingPainterBase<
  R extends { areas: { area: AreaRef }[] },
  D extends Map<string, unknown>,
  E,
> extends LitElement {
  @property({ attribute: false }) api!: StaffingApi;
  /** The address's area key; the picker starts there and never writes it back. */
  @property() area = "";
  /** The Calendar's month, YYYY-MM, kept when closing. */
  @property() month = "";
  @property({ type: Boolean }) readOnly = false;
  /** Moves the Calendar's address. */
  @property({ attribute: false }) open!: CalendarViewHost["open"];

  protected viewSwitch(openHours: () => void) {
    return html`<wt-segmented-control
      slot="picker"
      name="calendarView"
      hide-label
      .label=${tKit("nav.calendar")}
      .options=${[
        { value: "hours", label: tKit("opening.title") },
        { value: "staffing", label: t("staffing.view.tab") },
      ]}
      value="staffing"
      ?disabled=${this.saving}
      @wt-change=${(event: Event) => {
        event.stopPropagation();
        const control = event.currentTarget as HTMLElementTagNameMap["wt-segmented-control"];
        // Staffing stays selected until the guarded navigation actually leaves it.
        control.value = "staffing";
        openHours();
      }}
    ></wt-segmented-control>`;
  }

  protected closePainter() {
    this.open("staffing", this.addressParams(), { replace: true });
  }

  @state() protected read?: R;
  @state() protected loadError?: string;
  @state() protected draft: D = new Map() as D;
  @state() protected shown = "";
  @state() protected chosen?: string;
  @state() protected headcount = 1;
  @state() protected staffRoles: StaffRole[] = [];
  @state() protected rolesError?: string;
  @state() protected saving = false;
  @state() protected refused?: Refused;
  /** Edits a re-read dropped because their area is gone. */
  @state() protected notice = "";
  /** Why the read after a successful save failed; cleared only by a read that succeeds. */
  @state() protected refreshError = "";
  @state() protected dialogOpen = false;
  protected baseline: D = new Map() as D;
  protected readFor?: string;
  /** Replaced whenever a save's answer would land on an item it no longer belongs to. */
  protected generation = {};
  /** Replaced by every read, so only the latest one's answer is taken. */
  protected latestRead = {};
  protected scope?: DraftScope<D>;
  protected coordinator?: LeaveCoordinator;
  protected watchingRoles = false;
  protected readonly guides = guidesKeeper();
  protected readonly columnErrors = columnErrorsKeeper();

  protected abstract get identity(): string;
  protected abstract readData(id: string): Promise<R>;
  protected abstract saveData(id: string, edits: E[]): Promise<void>;
  protected abstract seed(read: R): D;
  protected abstract copyDraft(draft: D): D;
  protected abstract sameDraft(a: D, b: D): boolean;
  protected abstract take(fresh: D, previous: R | undefined): void;
  protected abstract edits(read: R): E[];
  protected abstract savedBaseline(edits: E[]): D;
  protected abstract refuse(error: unknown, edits: E[], read: R): void;

  readonly #roles = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.rolesError = tf("staffing.role.load_error", { reason: codeMessage(codeOf(error)) });
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.watchingRoles = false;
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(): void {
    if (this.identity && this.identity !== this.readFor) this.load();
    if (this.api && !this.watchingRoles) {
      this.watchingRoles = true;
      this.api
        .watchStaffRoles(
          this.#roles,
          (staffRoles) => {
            this.staffRoles = staffRoles;
            this.rolesError = undefined;
          },
          "painter-staff-roles",
        )
        .catch(() => {
          // The controller's error callback has already said why.
        });
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: {},
        current: () => this.draft,
        snapshot: (value) => this.copyDraft(value),
        equal: (a, b) => this.sameDraft(a, b),
        restore: (value) => {
          this.draft = this.copyDraft(value);
          this.notice = "";
          this.refused = undefined;
        },
      });
      this.scope = scope;
      this.coordinator = coordinator;
      scope.commit(this.copyDraft(this.baseline));
      if (!this.sameDraft(this.draft, this.baseline)) scope.changed();
    }
  }

  /** `afterSave` keeps the draft and takes the answer in with `take`. */
  protected load(afterSave = false): void {
    const id = this.identity;
    const token = (this.latestRead = {});
    if (!afterSave) {
      this.generation = {};
      this.readFor = id;
      this.read = undefined;
      this.loadError = undefined;
      this.refused = undefined;
      this.notice = "";
      this.refreshError = "";
      this.saving = false;
      this.draft = new Map() as D;
      this.commitBaseline(new Map() as D);
    }
    this.readData(id).then(
      (read) => {
        if (token !== this.latestRead) return;
        const previous = this.read;
        this.read = read;
        this.refreshError = "";
        this.take(this.seed(read), previous);
      },
      (error: unknown) => {
        if (token !== this.latestRead) return;
        const reason = codeMessage(codeOf(error));
        if (afterSave) this.refreshError = tf("staffing.painter.refresh_error", { reason });
        else this.loadError = tf("staffing.painter.load_error", { reason });
      },
    );
  }

  protected commitBaseline(baseline: D): void {
    this.baseline = baseline;
    this.scope?.commit(this.copyDraft(baseline));
    if (!this.sameDraft(this.draft, baseline)) this.scope?.changed();
  }

  protected areaShown(read: R): string {
    const keys = read.areas.map(({ area }) => areaKey(area));
    return [this.shown, this.area].find((key) => keys.includes(key)) ?? keys[0] ?? "";
  }

  protected addressParams(): Record<string, string> {
    return this.area ? { month: this.month, area: this.area } : { month: this.month };
  }

  protected pick(value: string): void {
    if (!this.read!.areas.some(({ area }) => areaKey(area) === value)) return;
    this.notice = "";
    this.shown = value;
  }

  protected async save(): Promise<void> {
    if (this.saving || saveActionState(this.scope).unchanged) return;
    const read = this.read!;
    const edits = this.edits(read);
    const generation = this.generation;
    this.saving = true;
    this.notice = "";
    this.refused = undefined;
    try {
      await this.saveData(this.identity, edits);
    } catch (error) {
      if (generation === this.generation) {
        this.saving = false;
        this.refuse(error, edits, read);
      }
      return;
    }
    if (generation !== this.generation) return;
    this.saving = false;
    this.commitBaseline(this.savedBaseline(edits));
    this.load(true);
  }

  protected chosenRole(): string | undefined {
    return this.staffRoles.some(({ id }) => id === this.chosen)
      ? this.chosen
      : this.staffRoles[0]?.id;
  }

  protected roleDialog() {
    return this.readOnly
      ? nothing
      : staffRoleDialog(
          this.api,
          this.dialogOpen,
          this.staffRoles,
          (saved) => {
            if (!this.staffRoles.some(({ id }) => id === saved.id))
              this.staffRoles = [...this.staffRoles, saved];
            this.chosen = saved.id;
          },
          () => {
            this.dialogOpen = false;
          },
        );
  }
}
