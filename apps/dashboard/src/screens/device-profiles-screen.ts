import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, formMessage, formMessageStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { bottomMessage } from "../i18n/form-message.js";
import { printerLabel, roleName } from "../i18n/domain.js";
import type { StringKey } from "../i18n/strings.js";
// Reuses the canvas editor's dashboard-local mirror: `@waitron/layouts`' barrel would pull
// `@waitron/db` into the browser bundle. A profile's `capabilities` is an opaque `string[]` on the
// wire, rendered defensively against `CAPABILITY_FLAGS`.
import {
  CAPABILITY_FLAGS,
  FORM_FACTORS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  type CapabilityFlag,
  type FormFactor,
} from "./canvas-editor/card-contracts.js";
import { toggleMembership } from "../array-utils.js";
import type {
  Canvas,
  DeviceProfile,
  DashboardApi,
  PersonException,
  PersonRole,
  PersonSummary,
  Printer,
  ProfileKitchenLists,
  ProfilePrinterLists,
  ProfileSaveExtras,
  ProfileScopeChoices,
  ProfileServiceScope,
  Station,
  Watcher,
} from "../api/client.js";

type PrinterListKey = keyof ProfilePrinterLists;

const PRINTER_LISTS = [
  {
    key: "receiptPrinterIds",
    test: "receipt-printers",
    heading: "device_profiles.receipt_printers",
  },
  {
    key: "paymentSlipPrinterIds",
    test: "payment-slip-printers",
    heading: "device_profiles.payment_slip_printers",
  },
] as const satisfies readonly { key: PrinterListKey; test: string; heading: StringKey }[];

const NO_PRINTER_LISTS: ProfilePrinterLists = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };

const NO_KITCHEN_LISTS: ProfileKitchenLists = { stationIds: [], watcherIds: [] };

type KitchenListKey = keyof ProfileKitchenLists;

/** A kitchen display's two lists: what its screens may be set to show. */
const KITCHEN_LISTS = [
  {
    key: "stationIds",
    test: "profile-stations",
    item: "profile-station",
    heading: "device_profiles.stations",
    inUse: "device_profile.station_in_use",
    inUseSentence: "device_profiles.station_in_use",
  },
  {
    key: "watcherIds",
    test: "profile-watchers",
    item: "profile-watcher",
    heading: "device_profiles.watchers",
    inUse: "device_profile.watcher_in_use",
    inUseSentence: "device_profiles.watcher_in_use",
  },
] as const satisfies readonly {
  key: KitchenListKey;
  test: string;
  item: string;
  heading: StringKey;
  inUse: string;
  inUseSentence: StringKey;
}[];

/** The same ids, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameScope(a: ProfileServiceScope, b: ProfileServiceScope): boolean {
  return (
    a.departmentId === b.departmentId &&
    a.startingZoneId === b.startingZoneId &&
    (a.allowedZoneIds === null || b.allowedZoneIds === null
      ? a.allowedZoneIds === b.allowedZoneIds
      : sameIds(a.allowedZoneIds, b.allowedZoneIds))
  );
}

function sameExceptions(a: readonly PersonException[], b: readonly PersonException[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry) =>
      b.some((other) => other.personId === entry.personId && other.admitted === entry.admitted),
    )
  );
}

/** The department's switched-on zones, by position. */
function activeZones(choices: ProfileScopeChoices, departmentId: string | null) {
  return choices.zones.filter((zone) => zone.departmentId === departmentId && zone.active);
}

/**
 * A stored subset and starting zone less the zones switched off since, as the till reads them: the
 * start moves to the first zone left, or is empty when none is.
 */
function liveZones(
  scope: ProfileServiceScope,
  choices: ProfileScopeChoices,
): { allowedZoneIds: string[] | null; startingZoneId: string } {
  const zones = activeZones(choices, scope.departmentId).map((zone) => zone.id);
  const allowed =
    scope.allowedZoneIds === null ? null : zones.filter((id) => scope.allowedZoneIds!.includes(id));
  const usable = allowed ?? zones;
  const start = scope.startingZoneId;
  return {
    allowedZoneIds: allowed,
    startingZoneId: start !== null && usable.includes(start) ? start : (usable[0] ?? ""),
  };
}

const EVERY_ROLE: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/** The one action a kitchen display may take: nobody signs in on it. */
const SHARED_DISPLAY_ACTIONS: readonly CapabilityFlag[] = ["prepare-orders"];

function sharedDisplayMay(flag: CapabilityFlag): boolean {
  return (
    !(PROFILE_ACTIONS as readonly CapabilityFlag[]).includes(flag) ||
    SHARED_DISPLAY_ACTIONS.includes(flag)
  );
}

/** The editor's fields a check or a refusal can mark, in the order the form draws them. */
const FIELDS = [
  "name",
  "canvas",
  "inactivity",
  "department",
  "zones",
  "startingZone",
  "roles",
  "people",
  "actions",
  "startingScreen",
  "stationIds",
  "watcherIds",
] as const;
type EditorField = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<EditorField, string>>;

/** Where each field is drawn; a group of switches takes focus on its first switch. */
const FIELD_TARGET: Record<EditorField, string> = {
  name: "[data-test=profile-name]",
  canvas: "[data-test=profile-canvas]",
  inactivity: "[data-test=profile-inactivity]",
  department: "[data-test=profile-department]",
  zones: "[data-test=profile-zones] wt-switch",
  startingZone: "[data-test=profile-starting-zone]",
  roles: "[data-test=profile-roles] wt-switch",
  people: "[data-test=profile-people] wt-combobox",
  actions: "[data-test=profile-actions] wt-switch",
  startingScreen: "[data-test=profile-starting-screen]",
  stationIds: "[data-test=profile-stations] wt-switch",
  watcherIds: "[data-test=profile-watchers] wt-switch",
};

/** The request field a refusal names, as the editor field that shows it. */
const FIELD_BY_PARAM: Record<string, EditorField> = {
  name: "name",
  canvasId: "canvas",
  inactivityTimeoutSeconds: "inactivity",
  capabilities: "actions",
  departmentId: "department",
  allowedZoneIds: "zones",
  startingZoneId: "startingZone",
  admittedRoles: "roles",
  personExceptions: "people",
  stationIds: "stationIds",
  watcherIds: "watcherIds",
};

/** What a refusal says under each field, when it is not the refusal's own sentence. */
const FIELD_SENTENCE: Partial<Record<EditorField, StringKey>> = {
  department: "device_profiles.err_department",
  zones: "device_profiles.err_zones",
  startingZone: "device_profiles.err_starting_zone",
  roles: "device_profiles.err_roles_required",
  people: "device_profiles.err_people",
  startingScreen: "device_profiles.err_starting_screen",
};

/** `device_profile.invalid`'s reasons that are about one field. */
const FIELD_BY_REASON: Record<string, EditorField> = {
  bad_canvas_ref: "canvas",
  bad_inactivity_timeout: "inactivity",
  bad_capabilities: "actions",
  shared_display_action: "actions",
  bad_starting_screen: "startingScreen",
};

@customElement("dashboard-device-profiles-screen")
export class DeviceProfilesScreen extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: var(--wt-space-4) 0 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        margin-right: auto;
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .section-title {
        margin: var(--wt-space-5) 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .panel-subtitle {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        margin-bottom: var(--wt-space-2);
      }
      .hint {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .toggles {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
      }
      .printer-choice,
      .order {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .printer-choice {
        flex-wrap: wrap;
      }
      wt-form-actions {
        margin-top: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .field-error {
        color: var(--wt-color-danger);
        margin: var(--wt-space-2) 0 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private mode: "list" | "editor" = "list";

  @state() private profiles: DeviceProfile[] = [];

  @state() private canvases: Canvas[] = [];

  @state() private printers: Printer[] = [];

  @state() private stations: Station[] = [];

  @state() private watchers: Watcher[] = [];

  @state() private kitchenLists: ({ profileId: string } & ProfileKitchenLists)[] = [];

  @state() private scopeChoices: ProfileScopeChoices = { departments: [], zones: [] };

  @state() private staff: PersonSummary[] = [];

  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  @state() private editingId: string | null = null;
  @state() private draftName = "";
  @state() private draftCanvasId: string | null = null;
  @state() private draftCapabilities: CapabilityFlag[] = [];
  @state() private draftFormFactor: FormFactor = FORM_FACTORS[0];
  // In whole MINUTES (`null` = never); the wire value is SECONDS.
  @state() private draftInactivityMinutes: number | null = null;
  @state() private draftPrinterLists: ProfilePrinterLists = NO_PRINTER_LISTS;
  @state() private draftKitchenLists: ProfileKitchenLists = NO_KITCHEN_LISTS;
  /** The lists the edited profile held when opened, so a save that leaves them alone omits them. */
  #loadedKitchenLists: ProfileKitchenLists = NO_KITCHEN_LISTS;
  @state() private draftDepartmentId = "";
  @state() private draftEveryZone = true;
  /** The chosen zones while `draftEveryZone` is off, by the zones' position. */
  @state() private draftZoneIds: string[] = [];
  @state() private draftStartingZoneId = "";
  @state() private draftRoles: PersonRole[] = [...EVERY_ROLE];
  @state() private draftExceptions: PersonException[] = [];
  @state() private draftStartingScreen: string | null = null;
  /** The edited profile as opened, so an edit sends only the parts it changed; null for a new one. */
  #loaded: DeviceProfile | null = null;

  /** Set by the first Save; from then on the form's own checks mark their fields. */
  @state() private attempted = false;
  /** A refusal's sentence under the field it names, until that field changes or Save is pressed. */
  @state() private fieldRefusal: { field: EditorField; sentence: string } | null = null;

  @state() private saving = false;

  @state() private deleteTarget: DeviceProfile | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
    try {
      await Promise.all([
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.profiles = value;
        }),
        this.#queries.watch("listCanvases", [], (value) => {
          this.canvases = value;
        }),
        this.#queries.watch("listPrinters", [], (value) => {
          this.printers = value;
        }),
        this.#queries.watch("listStations", [], (value) => {
          this.stations = value;
        }),
        this.#queries.watch("listWatchers", [], (value) => {
          this.watchers = value;
        }),
        this.#queries.watch("listProfileKitchenLists", [], (value) => {
          this.kitchenLists = value;
        }),
        this.#queries.watch("listStaff", [], (value) => {
          this.staff = value;
        }),
      ]);
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  /** Reloads only the PROFILES: no profile write changes the canvas or printer set. */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.#showError(null);
    let written = false;
    try {
      await action();
      written = true;
      this.profiles = await this.api.listDeviceProfiles();
    } catch (error) {
      if (written) this.#showReadError(error);
      else this.#showError(codeOf(error));
    }
  }

  /** The field a refusal is about and what to say there, by what the error carries. */
  #refusedField(error: unknown): { field: EditorField; sentence: string } | null {
    const code = codeOf(error);
    const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
    const list = KITCHEN_LISTS.find((entry) => entry.inUse === code);
    if (list !== undefined && typeof params.deviceName === "string")
      return {
        field: list.key,
        sentence: t(list.inUseSentence).replace("{device}", params.deviceName),
      };
    let field: EditorField | undefined;
    if (code === "device_profile.name_taken") field = "name";
    else if (code === "device_profile.invalid")
      field = typeof params.reason === "string" ? FIELD_BY_REASON[params.reason] : undefined;
    else if (
      code === "management.request_invalid" ||
      code === "device_profile.access_invalid" ||
      code === "device_profile.admission_invalid"
    )
      field = typeof params.field === "string" ? FIELD_BY_PARAM[params.field] : undefined;
    if (field === undefined || !this.#shownFields().includes(field)) return null;
    const own = code === "management.request_invalid" ? undefined : FIELD_SENTENCE[field];
    const sentence =
      code === "device_profile.invalid" && params.reason === "shared_display_action"
        ? t("device_profiles.err_shared_display_action")
        : own !== undefined
          ? t(own)
          : codeMessage(code);
    return { field, sentence };
  }

  #canvasLabel(canvasId: string | null): string {
    if (canvasId === null) return t("device_profiles.canvas_default");
    const canvas = this.canvases.find((c) => c.id === canvasId);
    return canvas ? canvas.name : t("device_profiles.canvas_unknown");
  }

  /** Only the KNOWN flags, so an unknown wire value is ignored rather than shown. */
  #capabilitySummary(capabilities: string[]): string {
    const known = CAPABILITY_FLAGS.filter((flag) => capabilities.includes(flag));
    if (known.length === 0) return t("device_profiles.no_capabilities");
    return known.map((flag) => t(`device_profiles.capability.${flag}` as StringKey)).join(", ");
  }

  // ── The form's own checks ────────────────────────────────────────────────────────────────────────

  #ordering(): boolean {
    return this.draftFormFactor !== "kds";
  }

  /** The fields the form draws now, so a refusal about a hidden one goes to the bottom instead. */
  #shownFields(): EditorField[] {
    const kds = !this.#ordering();
    return FIELDS.filter((field) => {
      if (field === "inactivity") return !kds;
      if (field === "stationIds" || field === "watcherIds") return kds;
      if (
        ["department", "zones", "startingZone", "roles", "people", "startingScreen"].includes(field)
      )
        return !kds;
      return true;
    });
  }

  #ownErrors(): FieldErrors {
    if (!this.attempted) return {};
    const errors: FieldErrors = {};
    if (this.draftName.trim() === "") errors.name = t("form.name_required");
    if (this.#ordering()) {
      if (this.draftDepartmentId === "")
        errors.department = t("device_profiles.err_department_required");
      else if (!this.draftEveryZone && this.draftZoneIds.length === 0)
        errors.zones = t("device_profiles.err_zones_required");
      if (this.draftStartingZoneId === "")
        errors.startingZone = t("device_profiles.err_starting_zone_required");
      if (this.draftRoles.length === 0) errors.roles = t("device_profiles.err_roles_required");
    }
    return errors;
  }

  /** A refusal's sentence goes under its field unless the form's own check already marks it. */
  #errors(): FieldErrors {
    const errors = this.#ownErrors();
    const refused = this.fieldRefusal;
    if (refused !== null && !errors[refused.field]) errors[refused.field] = refused.sentence;
    return errors;
  }

  #clearRefusal(...fields: EditorField[]): void {
    if (this.fieldRefusal !== null && fields.includes(this.fieldRefusal.field))
      this.fieldRefusal = null;
  }

  async #focusFirstError(errors: FieldErrors): Promise<void> {
    await this.updateComplete;
    const field = FIELDS.find((name) => errors[name]);
    if (field === undefined) return;
    this.renderRoot.querySelector<HTMLElement>(FIELD_TARGET[field])?.focus();
  }

  // ── Where it serves ──────────────────────────────────────────────────────────────────────────────

  /** The department's switched-on zones, by position. */
  #departmentZones(departmentId: string): ProfileScopeChoices["zones"] {
    return activeZones(this.scopeChoices, departmentId);
  }

  #allowedZones(): ProfileScopeChoices["zones"] {
    const zones = this.#departmentZones(this.draftDepartmentId);
    return this.draftEveryZone
      ? zones
      : zones.filter((zone) => this.draftZoneIds.includes(zone.id));
  }

  /** Keeps the starting zone while it is still allowed, else the first allowed one. */
  #settleStartingZone(): void {
    const allowed = this.#allowedZones();
    if (!allowed.some((zone) => zone.id === this.draftStartingZoneId))
      this.draftStartingZoneId = allowed[0]?.id ?? "";
  }

  #onDepartment(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftDepartmentId = event.detail.value;
    this.draftEveryZone = true;
    this.draftZoneIds = [];
    this.draftStartingZoneId = "";
    this.#settleStartingZone();
    this.#clearRefusal("department", "zones", "startingZone");
  }

  #onEveryZone(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.draftEveryZone = event.detail.checked;
    this.draftZoneIds = event.detail.checked
      ? []
      : this.#departmentZones(this.draftDepartmentId).map((zone) => zone.id);
    this.#settleStartingZone();
    this.#clearRefusal("zones", "startingZone");
  }

  #onZone(event: CustomEvent<{ checked: boolean }>, zoneId: string): void {
    event.stopPropagation();
    const order = this.#departmentZones(this.draftDepartmentId).map((zone) => zone.id);
    const others = this.draftZoneIds.filter((id) => id !== zoneId);
    const chosen = event.detail.checked ? [...others, zoneId] : others;
    this.draftZoneIds = order.filter((id) => chosen.includes(id));
    this.#settleStartingZone();
    this.#clearRefusal("zones", "startingZone");
  }

  #onStartingZone(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftStartingZoneId = event.detail.value;
    this.#clearRefusal("startingZone");
  }

  // ── Who can sign in ──────────────────────────────────────────────────────────────────────────────

  #onRole(event: CustomEvent<{ checked: boolean }>, role: PersonRole): void {
    event.stopPropagation();
    const others = this.draftRoles.filter((entry) => entry !== role);
    const chosen = event.detail.checked ? [...others, role] : others;
    this.draftRoles = EVERY_ROLE.filter((entry) => chosen.includes(entry));
    this.#clearRefusal("roles");
  }

  #onPersonRule(event: CustomEvent<{ value: string }>, personId: string): void {
    event.stopPropagation();
    const rule = event.detail.value;
    const existing = this.draftExceptions.findIndex((entry) => entry.personId === personId);
    const exceptions = [...this.draftExceptions];
    if (rule === "") {
      if (existing !== -1) exceptions.splice(existing, 1);
    } else {
      const entry = { personId, admitted: rule === "allow" };
      if (existing === -1) exceptions.push(entry);
      else exceptions[existing] = entry;
    }
    this.draftExceptions = exceptions;
    this.#clearRefusal("people");
  }

  #ruleOf(personId: string): "" | "allow" | "deny" {
    const entry = this.draftExceptions.find((exception) => exception.personId === personId);
    return entry === undefined ? "" : entry.admitted ? "allow" : "deny";
  }

  /** The active people the draft admits: a person's own rule first, then their role. */
  #admittedPeople(): PersonSummary[] {
    return this.staff.filter((person) => {
      if (person.status !== "active") return false;
      const rule = this.#ruleOf(person.personId);
      return rule === "" ? this.draftRoles.includes(person.role) : rule === "allow";
    });
  }

  // ── New / Edit ─────────────────────────────────────────────────────────────────────────────────

  #clearDraft(): void {
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.draftFormFactor = FORM_FACTORS[0];
    this.draftInactivityMinutes = null;
    this.draftPrinterLists = NO_PRINTER_LISTS;
    this.draftKitchenLists = NO_KITCHEN_LISTS;
    this.#loadedKitchenLists = NO_KITCHEN_LISTS;
    this.draftDepartmentId = "";
    this.draftEveryZone = true;
    this.draftZoneIds = [];
    this.draftStartingZoneId = "";
    this.draftRoles = [...EVERY_ROLE];
    this.draftExceptions = [];
    this.draftStartingScreen = null;
    this.#loaded = null;
    this.attempted = false;
    this.fieldRefusal = null;
    this.#opened += 1;
  }

  /** Bumped by every open and close of the editor, so a read that lands after the editor moved
   * on changes nothing. */
  #opened = 0;

  /** Read when the editor opens rather than kept live: the editor is the only reader. */
  async #readScopeChoices(): Promise<ProfileScopeChoices> {
    this.scopeChoices = await this.api.getProfileScopeChoices();
    return this.scopeChoices;
  }

  /** A venue with one department starts the profile there, at its first zone. */
  #openCreate(): void {
    this.#clearDraft();
    this.#showError(null);
    this.mode = "editor";
    const opened = this.#opened;
    this.#readScopeChoices().then(
      (choices) => {
        if (opened !== this.#opened || this.draftDepartmentId !== "") return;
        const departments = choices.departments.filter((department) => department.active);
        if (departments.length !== 1) return;
        this.draftDepartmentId = departments[0]!.id;
        this.#settleStartingZone();
      },
      (error: unknown) => {
        if (opened === this.#opened) this.#showReadError(error);
      },
    );
  }

  /** Fetches the profile and its station and watcher lists fresh, rather than reusing rows a read
   * may not have delivered yet. */
  async #openEditor(id: string): Promise<void> {
    this.#showError(null);
    try {
      const [profile, kitchenLists, choices] = await Promise.all([
        this.api.getDeviceProfile(id),
        this.api.listProfileKitchenLists(),
        this.#readScopeChoices(),
      ]);
      this.#clearDraft();
      this.editingId = id;
      this.#loaded = profile;
      this.draftName = profile.name;
      this.draftCanvasId = profile.canvasId;
      this.draftCapabilities = CAPABILITY_FLAGS.filter((flag) =>
        profile.capabilities.includes(flag),
      );
      this.draftFormFactor = profile.formFactor;
      this.draftInactivityMinutes =
        profile.inactivityTimeoutSeconds == null ? null : profile.inactivityTimeoutSeconds / 60;
      this.draftPrinterLists = {
        receiptPrinterIds: profile.receiptPrinterIds,
        paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
      };
      const stored = kitchenLists.find((entry) => entry.profileId === id);
      this.#loadedKitchenLists = {
        stationIds: stored?.stationIds ?? [],
        watcherIds: stored?.watcherIds ?? [],
      };
      this.draftKitchenLists = this.#loadedKitchenLists;
      this.draftDepartmentId = profile.departmentId ?? "";
      if (profile.departmentId !== null) {
        const zones = liveZones(profile, choices);
        this.draftEveryZone = zones.allowedZoneIds === null;
        this.draftZoneIds = zones.allowedZoneIds ?? [];
        this.draftStartingZoneId = zones.startingZoneId;
      }
      this.draftRoles = EVERY_ROLE.filter((role) => profile.admittedRoles.includes(role));
      this.draftExceptions = [...profile.personExceptions];
      this.draftStartingScreen = profile.startingScreen;
      this.mode = "editor";
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #onName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftName = event.detail.value;
    this.#clearRefusal("name");
  }

  #onCanvas(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    this.draftCanvasId = value === "" ? null : value;
    this.#clearRefusal("canvas");
  }

  #onFormFactor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftFormFactor = event.detail.value as FormFactor;
    this.#clearRefusal("actions");
  }

  #onInactivity(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const raw = event.detail.value.trim();
    const minutes = Number(raw);
    this.draftInactivityMinutes = raw === "" || Number.isNaN(minutes) ? null : minutes;
    this.#clearRefusal("inactivity");
  }

  /** Switching off the screen a profile starts on starts it on the first tab instead. */
  #onCapToggle(event: CustomEvent<{ checked: boolean }>, flag: CapabilityFlag): void {
    event.stopPropagation();
    this.draftCapabilities = toggleMembership(
      this.draftCapabilities,
      CAPABILITY_FLAGS,
      flag,
      event.detail.checked,
    ) as CapabilityFlag[];
    if (!event.detail.checked && this.draftStartingScreen === flag) this.draftStartingScreen = null;
    this.#clearRefusal("actions", "startingScreen");
  }

  #onStartingScreen(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftStartingScreen = event.detail.value === "" ? null : event.detail.value;
    this.#clearRefusal("startingScreen");
  }

  /** Appended when switched on: the order decides which printer a joining device starts on. */
  #onPrinterToggle(
    event: CustomEvent<{ checked: boolean }>,
    key: PrinterListKey,
    printerId: string,
  ): void {
    event.stopPropagation();
    const others = this.draftPrinterLists[key].filter((id) => id !== printerId);
    this.draftPrinterLists = {
      ...this.draftPrinterLists,
      [key]: event.detail.checked ? [...others, printerId] : others,
    };
  }

  #onKitchenToggle(
    event: CustomEvent<{ checked: boolean }>,
    key: KitchenListKey,
    id: string,
  ): void {
    event.stopPropagation();
    const others = this.draftKitchenLists[key].filter((listed) => listed !== id);
    this.draftKitchenLists = {
      ...this.draftKitchenLists,
      [key]: event.detail.checked ? [...others, id] : others,
    };
    this.#clearRefusal(key);
  }

  /**
   * A kitchen display's lists, when this save should send them: on an edit only when they changed,
   * so a save that leaves them alone cannot be refused over a screen they do not touch.
   */
  #kitchenListsToSend(formFactor: FormFactor, editing: boolean): ProfileKitchenLists | undefined {
    if (formFactor !== "kds") return undefined;
    const draft = this.draftKitchenLists;
    const loaded = this.#loadedKitchenLists;
    const changed =
      !sameIds(draft.stationIds, loaded.stationIds) ||
      !sameIds(draft.watcherIds, loaded.watcherIds);
    if (editing ? !changed : draft.stationIds.length + draft.watcherIds.length === 0)
      return undefined;
    return { stationIds: [...draft.stationIds], watcherIds: [...draft.watcherIds] };
  }

  /**
   * What the save sends beside the profile's own settings. An edit sends a part only when it
   * changed, as the kitchen lists are, so a zone switched off since cannot refuse a save that does
   * not touch where the profile serves; a new profile sends its department and what is not the
   * server's default. A kitchen display has no department, sign-in rule or starting screen.
   */
  #extrasToSend(formFactor: FormFactor): ProfileSaveExtras | undefined {
    const loaded = this.#loaded;
    const extras: ProfileSaveExtras = { ...this.#kitchenListsToSend(formFactor, loaded !== null) };
    if (formFactor === "kds") {
      if (loaded !== null && loaded.startingScreen !== null) extras.startingScreen = null;
    } else {
      const scope: ProfileServiceScope = {
        departmentId: this.draftDepartmentId,
        allowedZoneIds: this.draftEveryZone ? null : [...this.draftZoneIds],
        startingZoneId: this.draftStartingZoneId,
      };
      if (loaded === null || !sameScope(scope, loaded)) Object.assign(extras, scope);
      const roles = this.draftRoles;
      if (
        loaded === null ? roles.length < EVERY_ROLE.length : !sameIds(roles, loaded.admittedRoles)
      )
        extras.admittedRoles = [...roles];
      const exceptions = this.draftExceptions;
      if (
        loaded === null
          ? exceptions.length > 0
          : !sameExceptions(exceptions, loaded.personExceptions)
      )
        extras.personExceptions = exceptions.map((entry) => ({ ...entry }));
      const screen = this.draftStartingScreen;
      if (loaded === null ? screen !== null : screen !== loaded.startingScreen)
        extras.startingScreen = screen;
    }
    return Object.keys(extras).length === 0 ? undefined : extras;
  }

  /** Swaps with the neighbour on screen, so an id the printer list has not delivered is passed
   * over rather than swapped with unseen. */
  #movePrinter(key: PrinterListKey, drawn: readonly string[], printerId: string, by: -1 | 1): void {
    const neighbour = drawn[drawn.indexOf(printerId) + by]!;
    const list = [...this.draftPrinterLists[key]];
    const from = list.indexOf(printerId);
    const to = list.indexOf(neighbour);
    [list[from], list[to]] = [neighbour, printerId];
    this.draftPrinterLists = { ...this.draftPrinterLists, [key]: list };
  }

  #cancel(): void {
    this.#clearDraft();
    this.mode = "list";
    this.#showError(null);
  }

  /** The server accepts `""` as a name, so an empty name is refused here. */
  async #save(): Promise<void> {
    if (this.saving) return;
    this.attempted = true;
    this.fieldRefusal = null;
    this.#showError(null);
    const own = this.#ownErrors();
    if (Object.keys(own).length > 0) {
      void this.#focusFirstError(own);
      return;
    }
    const name = this.draftName.trim();
    const id = this.editingId;
    const canvasId = this.draftCanvasId;
    const formFactor = this.draftFormFactor;
    const capabilities = this.draftCapabilities.filter(
      (flag) => formFactor !== "kds" || sharedDisplayMay(flag),
    );
    // Minutes → seconds at the wire edge. A `kds` profile always sends null, whatever minutes are left
    // in the draft: the input is hidden for kds.
    const inactivityTimeoutSeconds =
      formFactor === "kds" || this.draftInactivityMinutes == null
        ? null
        : this.draftInactivityMinutes * 60;
    const printerLists = this.draftPrinterLists;
    const extras = this.#extrasToSend(formFactor);
    const extrasArg = extras === undefined ? [] : ([extras] as const);
    this.saving = true;
    let written = false;
    try {
      if (id !== null)
        await this.api.updateDeviceProfile(
          id,
          name,
          canvasId,
          capabilities,
          formFactor,
          inactivityTimeoutSeconds,
          printerLists,
          ...extrasArg,
        );
      else
        await this.api.createDeviceProfile(
          name,
          canvasId,
          capabilities,
          formFactor,
          inactivityTimeoutSeconds,
          printerLists,
          ...extrasArg,
        );
      written = true;
      this.#clearDraft();
      this.mode = "list";
      this.profiles = await this.api.listDeviceProfiles();
    } catch (error) {
      if (written) this.#showReadError(error);
      else {
        const refused = this.#refusedField(error);
        if (refused === null) this.#showError(codeOf(error));
        else {
          this.fieldRefusal = refused;
          void this.#focusFirstError({ [refused.field]: refused.sentence });
        }
      }
    } finally {
      this.saving = false;
    }
  }

  // ── Duplicate ────────────────────────────────────────────────────────────────────────────────────

  /**
   * A copy keeps where the profile serves and who signs in on it, less the zones switched off since.
   * With its department off, or none of its zones left, the copy carries no department, so the
   * refusal says one is needed. A kitchen display's copy lists the switched-on stations and watchers
   * the original lists.
   */
  #duplicate(profile: DeviceProfile): void {
    const name = `${profile.name}${t("device_profiles.copy_suffix")}`;
    void this.#mutate(async () => {
      const extras: ProfileSaveExtras = {};
      if (profile.formFactor === "kds") {
        const stored = this.kitchenLists.find((entry) => entry.profileId === profile.id);
        const on = (all: { id: string; active: boolean }[], ids: readonly string[]) =>
          all.filter((entry) => entry.active && ids.includes(entry.id)).map((entry) => entry.id);
        const lists = {
          stationIds: on(this.stations, stored?.stationIds ?? []),
          watcherIds: on(this.watchers, stored?.watcherIds ?? []),
        };
        if (lists.stationIds.length + lists.watcherIds.length > 0) Object.assign(extras, lists);
      } else {
        const choices = await this.api.getProfileScopeChoices();
        const departmentOn = choices.departments.some(
          (department) => department.id === profile.departmentId && department.active,
        );
        const zones = liveZones(profile, choices);
        if (departmentOn && zones.startingZoneId !== "")
          Object.assign(extras, { departmentId: profile.departmentId, ...zones });
        if (profile.admittedRoles.length < EVERY_ROLE.length)
          extras.admittedRoles = profile.admittedRoles;
        if (profile.personExceptions.length > 0) extras.personExceptions = profile.personExceptions;
        if (profile.startingScreen !== null) extras.startingScreen = profile.startingScreen;
      }
      const extrasArg = Object.keys(extras).length === 0 ? [] : ([extras] as const);
      await this.api.createDeviceProfile(
        name,
        profile.canvasId,
        profile.capabilities,
        profile.formFactor,
        profile.inactivityTimeoutSeconds,
        {
          receiptPrinterIds: profile.receiptPrinterIds,
          paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
        },
        ...extrasArg,
      );
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(profile: DeviceProfile): void {
    this.deleteTarget = profile;
  }

  #confirmDelete(): void {
    const target = this.deleteTarget;
    if (target === null) return;
    const id = target.id;
    this.deleteTarget = null;
    void this.#mutate(() => this.api.deleteDeviceProfile(id));
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #renderRow(profile: DeviceProfile): TemplateResult {
    return html`<li data-test="profile-row-${profile.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="profile-name-${profile.id}">${profile.name}</span>
            <span class="meta">
              <span data-test="profile-canvas-${profile.id}"
                >${t("device_profiles.canvas_label")}: ${this.#canvasLabel(profile.canvasId)}</span
              >
              <span data-test="profile-caps-${profile.id}"
                >${this.#capabilitySummary(profile.capabilities)}</span
              >
            </span>
          </div>
          <div class="actions">
            <wt-button
              variant="primary"
              size="sm"
              data-test="edit-${profile.id}"
              @click=${() => void this.#openEditor(profile.id)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              variant="secondary"
              size="sm"
              data-test="duplicate-${profile.id}"
              @click=${() => this.#duplicate(profile)}
              >${t("device_profiles.duplicate")}</wt-button
            >
            <wt-button
              variant="danger"
              size="sm"
              data-test="delete-${profile.id}"
              @click=${() => this.#openDelete(profile)}
              >${t("device_profiles.delete_confirm")}</wt-button
            >
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #renderDeleteDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("device_profiles.delete_title")}
      .open=${this.deleteTarget !== null}
      @wt-close=${() => (this.deleteTarget = null)}
    >
      <p data-test="delete-message">${t("device_profiles.delete_message")}</p>
      <wt-button
        slot="footer"
        variant="danger"
        data-test="confirm-delete"
        @click=${() => this.#confirmDelete()}
        >${t("device_profiles.delete_confirm")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderList(): TemplateResult {
    return html`
      <h1 class="title">${t("device_profiles.title")}</h1>
      <wt-button variant="primary" data-test="create" @click=${() => this.#openCreate()}
        >${t("device_profiles.create")}</wt-button
      >
      ${
        this.profiles.length === 0
          ? html`<p class="empty" data-test="no-profiles">${t("device_profiles.empty")}</p>`
          : html`<ol>
              ${this.profiles.map((profile) => this.#renderRow(profile))}
            </ol>`
      }
      ${this.#renderDeleteDialog()}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  #canvasOptions(): { value: string; label: string }[] {
    return [
      { value: "", label: t("device_profiles.canvas_default") },
      ...this.canvases.map((canvas) => ({ value: canvas.id, label: canvas.name })),
    ];
  }

  /** The list's own printers first, in its order, switched-off ones included so a save keeps them;
   * then every other printer that is switched on. */
  #printerChoices(key: PrinterListKey): { printer: Printer; listed: boolean }[] {
    const listed = this.draftPrinterLists[key];
    return [
      ...listed.flatMap((id) => {
        const printer = this.printers.find((p) => p.id === id);
        return printer === undefined ? [] : [{ printer, listed: true }];
      }),
      ...this.printers
        .filter((printer) => printer.active && !listed.includes(printer.id))
        .map((printer) => ({ printer, listed: false })),
    ];
  }

  #renderPrinterList(
    list: (typeof PRINTER_LISTS)[number],
    choices: { printer: Printer; listed: boolean }[],
  ): TemplateResult {
    const drawn = choices.filter((choice) => choice.listed).map((choice) => choice.printer.id);
    return html`<div
      class="field"
      role="group"
      aria-labelledby="${list.test}-heading"
      data-test=${list.test}
    >
      <span class="panel-subtitle" id="${list.test}-heading">${t(list.heading)}</span>
      <div class="toggles">
        ${choices.map(({ printer, listed }) => {
          const position = drawn.indexOf(printer.id);
          const name = printerLabel(printer);
          return html`<div class="printer-choice">
            <wt-switch
              data-test="${list.test}-${printer.id}"
              data-printer-id=${printer.id}
              label=${name}
              .checked=${listed}
              @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                this.#onPrinterToggle(e, list.key, printer.id)}
            ></wt-switch>
            ${
              listed
                ? html`<span class="order"
                    ><wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-up-${printer.id}"
                      aria-label="${t("device_profiles.move_up")} ${printer.name}"
                      ?disabled=${position === 0}
                      @click=${() => this.#movePrinter(list.key, drawn, printer.id, -1)}
                      >${t("device_profiles.move_up")}</wt-button
                    >
                    <wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-down-${printer.id}"
                      aria-label="${t("device_profiles.move_down")} ${printer.name}"
                      ?disabled=${position === drawn.length - 1}
                      @click=${() => this.#movePrinter(list.key, drawn, printer.id, 1)}
                      >${t("device_profiles.move_down")}</wt-button
                    ></span
                  >`
                : nothing
            }
          </div>`;
        })}
      </div>
    </div>`;
  }

  #renderPrinterLists(): TemplateResult {
    const lists = PRINTER_LISTS.map((list) => ({ list, choices: this.#printerChoices(list.key) }));
    if (lists.every(({ choices }) => choices.length === 0))
      return html`<p class="field" data-test="no-printers">${t("device_profiles.no_printers")}</p>`;
    return html`${lists.map(({ list, choices }) => this.#renderPrinterList(list, choices))}`;
  }

  /** The list's own entries first, switched-off ones included and marked so a save keeps them;
   * then every other one that is switched on. */
  #kitchenChoices(key: KitchenListKey): { id: string; label: string; listed: boolean }[] {
    const all: { id: string; name: string; active: boolean }[] =
      key === "stationIds" ? this.stations : this.watchers;
    const mark =
      key === "stationIds"
        ? t("devices.station_disabled_mark")
        : t("devices.watcher_disabled_mark");
    const listed = this.draftKitchenLists[key];
    return [
      ...all
        .filter((entry) => listed.includes(entry.id))
        .sort((a, b) => Number(b.active) - Number(a.active))
        .map((entry) => ({
          id: entry.id,
          label: entry.active ? entry.name : `${entry.name} (${mark})`,
          listed: true,
        })),
      ...all
        .filter((entry) => entry.active && !listed.includes(entry.id))
        .map((entry) => ({ id: entry.id, label: entry.name, listed: false })),
    ];
  }

  #renderKitchenLists(errors: FieldErrors): TemplateResult {
    const lists = KITCHEN_LISTS.map((list) => ({ list, choices: this.#kitchenChoices(list.key) }));
    if (lists.every(({ choices }) => choices.length === 0))
      return html`<p class="field" data-test="no-kitchen-choices">
        ${t("device_profiles.no_kitchen_choices")}
      </p>`;
    return html`<p class="hint" data-test="kitchen-lists-hint">
        ${t("device_profiles.kitchen_lists_hint")}
      </p>
      ${lists.map(({ list, choices }) => {
        const refusal = errors[list.key] ?? null;
        return html`<div
          class="field"
          role="group"
          aria-labelledby="${list.test}-heading"
          aria-describedby=${refusal === null ? nothing : `${list.test}-error`}
          data-test=${list.test}
        >
          <span class="panel-subtitle" id="${list.test}-heading">${t(list.heading)}</span>
          <div class="toggles">
            ${choices.map(
              (choice) =>
                html`<wt-switch
                  data-test="${list.item}-${choice.id}"
                  name="${list.key}"
                  label=${choice.label}
                  .checked=${choice.listed}
                  @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                    this.#onKitchenToggle(e, list.key, choice.id)}
                ></wt-switch>`,
            )}
          </div>
          ${this.#groupError(list.test, refusal)}
        </div>`;
      })}`;
  }

  #groupError(test: string, error: string | null | undefined): TemplateResult | typeof nothing {
    return error
      ? html`<p class="field-error" id="${test}-error" data-test="${test}-error">${error}</p>`
      : nothing;
  }

  /** A titled group of switches, described by its hint and, once marked, its error. */
  #switchGroup(
    test: string,
    heading: string,
    error: string | undefined,
    switches: TemplateResult[],
    hint?: { test: string; text: string },
  ): TemplateResult {
    const described = [hint ? `${test}-hint` : "", error ? `${test}-error` : ""]
      .filter((id) => id !== "")
      .join(" ");
    return html`<div
      class="field"
      role="group"
      aria-labelledby="${test}-heading"
      aria-describedby=${described === "" ? nothing : described}
      data-test=${test}
    >
      <span class="panel-subtitle" id="${test}-heading">${heading}</span>
      ${
        hint
          ? html`<p class="hint" id="${test}-hint" data-test=${hint.test}>${hint.text}</p>`
          : nothing
      }
      <div class="toggles">${switches}</div>
      ${this.#groupError(test, error)}
    </div>`;
  }

  #departmentOptions(): { value: string; label: string }[] {
    const options = this.scopeChoices.departments
      .filter((department) => department.active || department.id === this.draftDepartmentId)
      .map((department) => ({
        value: department.id,
        label: department.active
          ? department.name
          : `${department.name} (${t("device_profiles.department_disabled_mark")})`,
      }));
    return options;
  }

  #renderWhere(errors: FieldErrors): TemplateResult {
    const department = this.scopeChoices.departments.find(
      (entry) => entry.id === this.draftDepartmentId,
    );
    const zones = this.#departmentZones(this.draftDepartmentId);
    const everyZoneHint = t("device_profiles.every_zone_hint").replace(
      "{department}",
      department?.name ?? "",
    );
    return html`
      <h2 class="section-title">${t("device_profiles.where_heading")}</h2>
      <wt-combobox
        class="field"
        data-test="profile-department"
        name="departmentId"
        required
        label=${t("device_profiles.department")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.#departmentOptions()}
        .value=${this.draftDepartmentId}
        .error=${errors.department ?? ""}
        .invalid=${Boolean(errors.department)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDepartment(e)}
      >
        <wt-help-tooltip slot="help" aria-label=${t("device_profiles.department_help_label")}
          >${t("device_profiles.department_hint")}</wt-help-tooltip
        >
      </wt-combobox>
      ${
        this.draftDepartmentId === ""
          ? nothing
          : html`<div class="field">
                <wt-switch
                  data-test="profile-every-zone"
                  name="everyZone"
                  label=${t("device_profiles.every_zone")}
                  description=${this.draftEveryZone ? everyZoneHint : ""}
                  .checked=${this.draftEveryZone}
                  @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onEveryZone(e)}
                ></wt-switch>
                ${
                  this.draftEveryZone
                    ? html`<p class="hint" data-test="profile-zones-hint" aria-hidden="true">
                          ${everyZoneHint}
                        </p>
                        ${this.#groupError("profile-zones", errors.zones)}`
                    : nothing
                }
              </div>
              ${
                this.draftEveryZone
                  ? nothing
                  : this.#switchGroup(
                      "profile-zones",
                      t("device_profiles.zones"),
                      errors.zones,
                      zones.map(
                        (zone) =>
                          html`<wt-switch
                            data-test="profile-zone-${zone.id}"
                            name="allowedZoneIds"
                            label=${zone.name}
                            .checked=${this.draftZoneIds.includes(zone.id)}
                            @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                              this.#onZone(e, zone.id)}
                          ></wt-switch>`,
                      ),
                    )
              }`
      }
      <wt-combobox
        class="field"
        data-test="profile-starting-zone"
        name="startingZoneId"
        required
        label=${t("device_profiles.starting_zone")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.#allowedZones().map((zone) => ({ value: zone.id, label: zone.name }))}
        .value=${this.draftStartingZoneId}
        .error=${errors.startingZone ?? ""}
        .invalid=${Boolean(errors.startingZone)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onStartingZone(e)}
      >
        <wt-help-tooltip slot="help" aria-label=${t("device_profiles.starting_zone_help_label")}
          >${t("device_profiles.starting_zone_hint")}</wt-help-tooltip
        >
      </wt-combobox>
    `;
  }

  #ruleLabel(rule: "" | "allow" | "deny"): string {
    return t(
      rule === "allow"
        ? "device_profiles.person_allowed"
        : rule === "deny"
          ? "device_profiles.person_refused"
          : "device_profiles.person_follows_role",
    );
  }

  #renderWho(errors: FieldErrors): TemplateResult {
    const admitted = this.#admittedPeople().map((person) => person.displayName);
    const people = this.staff.filter((person) => person.status === "active");
    const ruled = people.filter((person) => this.#ruleOf(person.personId) !== "");
    const summary =
      ruled.length === 0
        ? t("device_profiles.people_none")
        : ruled
            .map(
              (person) =>
                `${person.displayName}: ${this.#ruleLabel(this.#ruleOf(person.personId))}`,
            )
            .join(" · ");
    return html`
      <h2 class="section-title">${t("device_profiles.who_heading")}</h2>
      ${this.#switchGroup(
        "profile-roles",
        t("device_profiles.roles"),
        errors.roles,
        EVERY_ROLE.map(
          (role) =>
            html`<wt-switch
              data-test="profile-role-${role}"
              name="admittedRoles"
              label=${roleName(role)}
              .checked=${this.draftRoles.includes(role)}
              @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onRole(e, role)}
            ></wt-switch>`,
        ),
      )}
      <p class="hint" data-test="admitted-people" aria-live="polite">
        ${
          admitted.length === 0
            ? t("device_profiles.admitted_nobody")
            : t("device_profiles.admitted_people").replace("{names}", admitted.join(", "))
        }
      </p>
      ${
        people.length === 0
          ? nothing
          : html`<wt-disclosure
              class="field"
              data-test="profile-people"
              heading=${t("device_profiles.people")}
              summary=${summary}
              ?has-error=${Boolean(errors.people)}
            >
              ${people.map(
                (person) =>
                  html`<wt-combobox
                    class="field"
                    data-test="profile-person-${person.personId}"
                    name="personExceptions"
                    label=${person.displayName}
                    search="never"
                    show-empty-option
                    .options=${(["", "allow", "deny"] as const).map((rule) => ({
                      value: rule,
                      label: this.#ruleLabel(rule),
                    }))}
                    .value=${this.#ruleOf(person.personId)}
                    @wt-change=${(e: CustomEvent<{ value: string }>) =>
                      this.#onPersonRule(e, person.personId)}
                  ></wt-combobox>`,
              )}
              ${this.#groupError("profile-people", errors.people)}
            </wt-disclosure>`
      }
    `;
  }

  #capabilitySwitch(flag: CapabilityFlag): TemplateResult {
    return html`<wt-switch
      data-test="cap-${flag}"
      name="capabilities"
      label=${t(`device_profiles.capability.${flag}` as StringKey)}
      .checked=${this.draftCapabilities.includes(flag)}
      @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onCapToggle(e, flag)}
    ></wt-switch>`;
  }

  #renderCapabilities(errors: FieldErrors): TemplateResult {
    const kds = !this.#ordering();
    const actions = PROFILE_ACTIONS.filter((flag) => !kds || sharedDisplayMay(flag));
    return html`
      ${this.#switchGroup(
        "profile-actions",
        t("device_profiles.actions"),
        errors.actions,
        actions.map((flag) => this.#capabilitySwitch(flag)),
        {
          test: "actions-hint",
          text: t(
            kds ? "device_profiles.shared_display_actions_hint" : "device_profiles.actions_hint",
          ),
        },
      )}
      ${this.#switchGroup(
        "profile-screens",
        t("device_profiles.screens"),
        undefined,
        PROFILE_SCREENS.map((flag) => this.#capabilitySwitch(flag)),
      )}
      ${
        kds
          ? nothing
          : html`<wt-combobox
              class="field"
              data-test="profile-starting-screen"
              name="startingScreen"
              label=${t("device_profiles.starting_screen")}
              search="never"
              show-empty-option
              .options=${[
                { value: "", label: t("device_profiles.starting_screen_first_tab") },
                ...NAVIGATION_SCREENS.filter((screen) =>
                  this.draftCapabilities.includes(screen),
                ).map((screen) => ({
                  value: screen,
                  label: t(`device_profiles.screen.${screen}` as StringKey),
                })),
              ]}
              .value=${this.draftStartingScreen ?? ""}
              .error=${errors.startingScreen ?? ""}
              .invalid=${Boolean(errors.startingScreen)}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onStartingScreen(e)}
            ></wt-combobox>`
      }
    `;
  }

  #renderEditor(): TemplateResult {
    const errors = this.#errors();
    const ordering = this.#ordering();
    const marked = FIELDS.some((field) => errors[field]);
    const ownMarked = Object.keys(this.#ownErrors()).length > 0;
    const message = bottomMessage(
      this.errorKey === null ? null : codeMessage(this.errorKey),
      marked ? t("form.fix_fields") : null,
    );
    return html`
      <div class="editor" data-test="editor-form" data-editing-id=${this.editingId ?? nothing}>
        <h1 class="title">${t("device_profiles.title")}</h1>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]"))}
          class="field"
          data-test="profile-name"
          name="name"
          required
          label=${t("device_profiles.name")}
          .value=${this.draftName}
          .error=${errors.name ?? ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onName(e)}
        ></wt-input>
        <wt-combobox
          class="field"
          data-test="profile-canvas"
          name="canvasId"
          label=${t("device_profiles.canvas_label")}
          search="auto"
          placeholder=${t("device_profiles.canvas_default")}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#canvasOptions()}
          .value=${this.draftCanvasId ?? ""}
          .error=${errors.canvas ?? ""}
          .invalid=${Boolean(errors.canvas)}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onCanvas(e)}
        ></wt-combobox>
        <wt-combobox
          class="field"
          data-test="profile-form-factor"
          name="formFactor"
          label=${t("device_profiles.form_factor")}
          search="auto"
          .options=${FORM_FACTORS.map((ff) => ({
            value: ff,
            label: t(`device_profiles.form_factor.${ff}` as StringKey),
          }))}
          .value=${this.draftFormFactor}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFormFactor(e)}
        ></wt-combobox>
        ${
          ordering
            ? html`<wt-input
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]"))}
                class="field"
                type="number"
                min="1"
                data-test="profile-inactivity"
                name="inactivityTimeout"
                label=${t("device_profiles.inactivity_timeout_label")}
                .value=${this.draftInactivityMinutes == null ? "" : String(this.draftInactivityMinutes)}
                .error=${errors.inactivity ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onInactivity(e)}
              ></wt-input>`
            : nothing
        }
        ${ordering ? this.#renderWhere(errors) : nothing}
        ${ordering ? this.#renderWho(errors) : nothing} ${this.#renderCapabilities(errors)}
        ${this.#renderPrinterLists()} ${ordering ? nothing : this.#renderKitchenLists(errors)}
        ${formMessage(message)}
        <wt-form-actions .showError=${false}>
          <wt-button
            slot="cancel"
            variant="secondary"
            data-test="profile-cancel"
            @click=${() => this.#cancel()}
            >${t("device_profiles.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="profile-save"
            ?disabled=${this.saving || ownMarked}
            @click=${() => void this.#save()}
            >${t("device_profiles.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    `;
  }

  override render(): TemplateResult {
    return this.mode === "editor" ? this.#renderEditor() : this.#renderList();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-device-profiles-screen": DeviceProfilesScreen;
  }
}
