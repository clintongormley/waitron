import { QueryController, tableNoMatches } from "@waitron/dashboard-kit";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { dashboardQuery } from "../api/live-queries.js";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  rowActionTail,
  submitOnEnter,
  parseDecimalInput,
  baseStyles,
  pageTitleStyles,
  FormFeedback,
  draftScopeFor,
  saveActionState,
  UrlStateController,
  encodePathSegment,
  navigationGuardFor,
  type DraftScope,
  type LeaveCoordinator,
  type WtButton,
} from "@waitron/ui";
import { renderSwitchGroup } from "../widgets/device-profile-switch-group.js";
import { renderDeviceProfileWhere } from "../widgets/device-profile-where.js";
import { renderDeviceProfileWho } from "../widgets/device-profile-who.js";
import {
  renderDeviceProfileKitchenScreens,
  type KitchenListsProps,
} from "../widgets/device-profile-kitchen.js";
import {
  renderDeviceProfilePrinterLists,
  renderDeviceProfileReaders,
  type PrinterChoice,
  type PrinterList,
  type PrinterListKey,
} from "../widgets/device-profile-equipment.js";
import { sameValue } from "../widgets/product-editor-model.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-tabs.js";
import type { TabItem } from "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { dashboardPath, leftToBrowser } from "../navigation.js";
import { a4Choices, printerLabel } from "../i18n/domain.js";
import type { StringKey } from "../i18n/strings.js";
// A local mirror keeps the layouts barrel's database imports out of the browser bundle.
import {
  CAPABILITY_FLAGS,
  FORM_FACTORS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  isSharedDisplay,
  sharedDisplayMay,
  type CapabilityFlag,
  type FormFactor,
} from "../device-profile-types.js";
import { toggleMembership } from "../array-utils.js";
import type {
  DeviceProfile,
  DashboardApi,
  KitchenScreenKind,
  KitchenScreenScope,
  PagePrinterRow,
  JobRole,
  Printer,
  ProfileEquipmentDefaults,
  ProfileKitchenScreen,
  ProfileKitchenScreens,
  ProfilePrinterLists,
  ProfileReaderList,
  ProfileSaveExtras,
  ReaderRow,
  ProfileScopeChoices,
  ProfileServiceScope,
  Station,
} from "../api/client.js";
import { KITCHEN_SCREEN_KINDS } from "../api/client.js";

/** Every printer list and default a profile holds; the save sends the drawer, invoice list and
 * defaults apart. */
type PrinterDraft = ProfilePrinterLists & ProfileEquipmentDefaults;
type PrinterRead = "printers" | "pages";
/** A receipt printer, or on the invoice list an A4 printer too. */
type ListablePrinter = Pick<Printer, "id" | "name" | "active">;

function equipmentInOrder<T extends { id: string; active: boolean }>(
  pool: readonly T[],
  order: readonly string[],
  listed: readonly string[],
): T[] {
  const available = new Map(
    pool.filter((item) => item.active || listed.includes(item.id)).map((item) => [item.id, item]),
  );
  return [
    ...order.flatMap((id) => {
      const item = available.get(id);
      available.delete(id);
      return item === undefined ? [] : [item];
    }),
    ...available.values(),
  ];
}

function toggleEquipment(
  listed: readonly string[],
  visible: readonly string[],
  id: string,
  checked: boolean,
): string[] {
  const others = listed.filter((other) => other !== id);
  if (checked) {
    const next = visible.slice(visible.indexOf(id) + 1).find((other) => others.includes(other));
    others.splice(next === undefined ? others.length : others.indexOf(next), 0, id);
  }
  return others;
}

interface ProfileDraft {
  name: string;
  capabilities: CapabilityFlag[];
  formFactor: FormFactor;
  inactivityMinutes: number | null;
  invalidInactivityText: string | null;
  printerLists: PrinterDraft;
  kitchenScreens: ProfileKitchenScreens;
  departmentId: string;
  everyZone: boolean;
  zoneIds: string[];
  startingZoneId: string;
  roles: string[];
  startingScreen: string | null;
}

const PRINTER_LISTS = [
  {
    key: "receiptPrinterIds",
    defaultKey: "receiptPrinterDefaultId",
    defaultField: "receiptDefault",
    test: "receipt-printers",
    heading: "device_profiles.receipt_printers",
    defaultLabel: "device_profiles.receipt_default",
  },
  {
    key: "paymentSlipPrinterIds",
    defaultKey: "paymentSlipPrinterDefaultId",
    defaultField: "slipDefault",
    test: "payment-slip-printers",
    heading: "device_profiles.payment_slip_printers",
    defaultLabel: "device_profiles.payment_slip_default",
  },
  {
    key: "cashDrawerPrinterIds",
    defaultKey: "cashDrawerPrinterDefaultId",
    defaultField: "drawerDefault",
    test: "cash-drawer-printers",
    heading: "device_profiles.cash_drawer_printers",
    defaultLabel: "device_profiles.cash_drawer_default",
  },
  {
    key: "invoicePrinterIds",
    defaultKey: "invoicePrinterDefaultId",
    defaultField: "invoiceDefault",
    test: "invoice-printers",
    heading: "device_profiles.invoice_printers",
    defaultLabel: "device_profiles.invoice_default",
  },
] as const satisfies readonly (PrinterList & { defaultField: EditorField })[];

const NO_EQUIPMENT: ProfileEquipmentDefaults = {
  cashDrawerPrinterIds: [],
  invoicePrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
  invoicePrinterDefaultId: null,
};

const NO_PRINTER_LISTS: PrinterDraft = {
  receiptPrinterIds: [],
  paymentSlipPrinterIds: [],
  ...NO_EQUIPMENT,
};

const NO_READERS: ProfileReaderList = { readerIds: [], defaultReaderId: null };

/** The same ids in the same order. */
function sameOrderedIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

function sameReaders(a: ProfileReaderList, b: ProfileReaderList): boolean {
  return a.defaultReaderId === b.defaultReaderId && sameOrderedIds(a.readerIds, b.readerIds);
}

/** The drawer and invoice lists and the four defaults, out of a profile or a draft that carries
 * more. */
function equipmentOf(from: ProfileEquipmentDefaults): ProfileEquipmentDefaults {
  return {
    cashDrawerPrinterIds: from.cashDrawerPrinterIds,
    invoicePrinterIds: from.invoicePrinterIds,
    receiptPrinterDefaultId: from.receiptPrinterDefaultId,
    paymentSlipPrinterDefaultId: from.paymentSlipPrinterDefaultId,
    cashDrawerPrinterDefaultId: from.cashDrawerPrinterDefaultId,
    invoicePrinterDefaultId: from.invoicePrinterDefaultId,
  };
}

const EVERY: KitchenScreenScope = { stationIds: null, zoneIds: null };

const KIND_SLUG: Record<KitchenScreenKind, string> = {
  station: "station-screen",
  pass: "pass-screen",
  pass_monitor: "pass-monitor",
};

/** The request field a refusal names for each kind's lists; a station screen has no zones. */
const KIND_FIELDS = {
  station: { stations: "stationScreenStations", zones: null },
  pass: { stations: "passScreenStations", zones: "passScreenZones" },
  pass_monitor: { stations: "passMonitorStations", zones: "passMonitorZones" },
} as const satisfies Record<
  KitchenScreenKind,
  { stations: EditorField; zones: EditorField | null }
>;

const KITCHEN_LIST_FIELDS: readonly EditorField[] = KITCHEN_SCREEN_KINDS.flatMap((kind) => {
  const { stations, zones } = KIND_FIELDS[kind];
  return zones === null ? [stations] : [stations, zones];
});

function comparableScreens(screens: ProfileKitchenScreens): ProfileKitchenScreens {
  const out: ProfileKitchenScreens = {};
  for (const kind of KITCHEN_SCREEN_KINDS) {
    const scope = screens[kind];
    if (scope === undefined) continue;
    out[kind] = {
      stationIds: scope.stationIds === null ? null : [...scope.stationIds].sort(),
      zoneIds: scope.zoneIds === null ? null : [...scope.zoneIds].sort(),
      ...(scope.showNonPassStations === false ? { showNonPassStations: false } : {}),
    };
  }
  return out;
}

/** Empty explicit station bounds survive copying so the copy cannot widen them to Every. */
function switchedOnScreens(
  screens: ProfileKitchenScreens,
  stationOn: (id: string) => boolean,
  zoneOn: (id: string) => boolean,
): ProfileKitchenScreens {
  const out: ProfileKitchenScreens = {};
  for (const kind of KITCHEN_SCREEN_KINDS) {
    const scope = screens[kind];
    if (scope === undefined) continue;
    const stationIds = scope.stationIds === null ? null : scope.stationIds.filter(stationOn);
    const zoneIds = scope.zoneIds === null ? null : scope.zoneIds.filter(zoneOn);
    out[kind] = { stationIds, zoneIds };
  }
  return out;
}

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

function activeZones(choices: ProfileScopeChoices, departmentId: string | null) {
  return choices.zones.filter((zone) => zone.departmentId === departmentId && zone.active);
}

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

/** The editor's fields a check or a refusal can mark, in the order the form draws them. */
const FIELDS = [
  "name",
  "inactivity",
  "startingScreen",
  "department",
  "zones",
  "startingZone",
  "roles",
  "actions",
  "kitchenScreens",
  "stationScreenStations",
  "passScreenStations",
  "passScreenZones",
  "passMonitorStations",
  "passMonitorZones",
  "receiptDefault",
  "slipDefault",
  "drawerList",
  "drawerDefault",
  "invoiceDefault",
  "readerDefault",
] as const;
type EditorField = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<EditorField, string>>;

type EditorTab = "general" | "where" | "who" | "kitchen" | "capabilities" | "equipment";
const FIELD_TAB: Record<EditorField, EditorTab> = {
  name: "general",
  inactivity: "general",
  startingScreen: "general",
  department: "where",
  zones: "where",
  startingZone: "where",
  roles: "who",
  actions: "capabilities",
  kitchenScreens: "kitchen",
  stationScreenStations: "kitchen",
  passScreenStations: "kitchen",
  passScreenZones: "kitchen",
  passMonitorStations: "kitchen",
  passMonitorZones: "kitchen",
  receiptDefault: "equipment",
  slipDefault: "equipment",
  drawerList: "equipment",
  drawerDefault: "equipment",
  invoiceDefault: "equipment",
  readerDefault: "equipment",
};

export function profileSettingTab(field: EditorField, formFactor: FormFactor): EditorTab {
  const tab = FIELD_TAB[field];
  return tab === "kitchen" && !isSharedDisplay(formFactor) ? "capabilities" : tab;
}
export function profileKindListsShown(
  kind: KitchenScreenKind,
  screens: ProfileKitchenScreens,
): boolean {
  return screens[kind] !== undefined;
}
export function profileReadersShown(
  ready: boolean,
  readers: readonly ReaderRow[],
  readerIds: readonly string[],
): boolean {
  return ready && (readers.length > 0 || readerIds.length > 0);
}
type ProfileSetting = {
  key: string;
  name: string;
  labelKey: StringKey;
  tab: EditorTab;
  equipment?: boolean;
  offered: (
    profile: DeviceProfile,
    screens: ProfileKitchenScreens,
    printers: boolean,
    readers: boolean,
  ) => boolean;
};
const orderingProfile = (profile: DeviceProfile) => !isSharedDisplay(profile.formFactor);
const profileField = (
  name: string,
  labelKey: StringKey,
  tab: EditorTab,
  offered: ProfileSetting["offered"] = () => true,
): ProfileSetting => ({ key: name, name, labelKey, tab, offered });
export const profileTabLabels = {
  general: "device_profiles.tab.general",
  where: "device_profiles.where_heading",
  who: "device_profiles.who_heading",
  kitchen: "device_profiles.tab.kitchen",
  capabilities: "device_profiles.tab.capabilities",
  equipment: "device_profiles.tab.equipment",
} as const;
export const profileSettingFields: readonly ProfileSetting[] = [
  profileField("name", "device_profiles.name", FIELD_TAB.name),
  profileField("formFactor", "device_profiles.form_factor", "general"),
  profileField(
    "inactivityTimeout",
    "device_profiles.inactivity_timeout_label",
    FIELD_TAB.inactivity,
  ),
  profileField(
    "startingScreen",
    "device_profiles.starting_screen",
    FIELD_TAB.startingScreen,
    orderingProfile,
  ),
  profileField("departmentId", "device_profiles.department", FIELD_TAB.department, orderingProfile),
  profileField(
    "everyZone",
    "device_profiles.every_zone",
    "where",
    (p) => orderingProfile(p) && p.departmentId !== null,
  ),
  profileField(
    "allowedZoneIds",
    "device_profiles.zones",
    FIELD_TAB.zones,
    (p) => orderingProfile(p) && p.departmentId !== null && p.allowedZoneIds !== null,
  ),
  profileField(
    "startingZoneId",
    "device_profiles.starting_zone",
    FIELD_TAB.startingZone,
    orderingProfile,
  ),
  profileField("admittedStaffRoleIds", "device_profiles.roles", FIELD_TAB.roles),
  ...CAPABILITY_FLAGS.map((flag): ProfileSetting => ({
    ...profileField(
      "capabilities",
      `device_profiles.capability.${flag}`,
      "capabilities",
      (p) => orderingProfile(p) || sharedDisplayMay(flag),
    ),
    key: `capability.${flag}`,
  })),
  ...(["kitchen", "capabilities"] as const).flatMap((tab): ProfileSetting[] => [
    profileField("kitchenScreens", "device_profiles.kitchen_screens", tab, (p) =>
      tab === "kitchen" ? !orderingProfile(p) : orderingProfile(p),
    ),
    ...KITCHEN_SCREEN_KINDS.flatMap((kind) => {
      const fields = KIND_FIELDS[kind];
      const offered: ProfileSetting["offered"] = (p, screens) =>
        profileSettingTab(fields.stations, p.formFactor) === tab &&
        profileKindListsShown(kind, screens);
      return [
        ...[
          [fields.stations, "device_profiles.kitchen_stations", "device_profiles.every_station"],
          ...(fields.zones === null
            ? []
            : [
                [fields.zones, "device_profiles.kitchen_zones", "device_profiles.every_zone_venue"],
              ]),
        ].flatMap(([name, group, every]) => [
          { ...profileField(name!, group as StringKey, tab, offered), key: name! },
          { ...profileField(name!, every as StringKey, tab, offered), key: `${name}.every` },
        ]),
      ];
    }),
    profileField(
      "showNonPassStations",
      "device_profiles.show_other_stations",
      tab,
      (p, screens) =>
        profileSettingTab("passScreenStations", p.formFactor) === tab &&
        (["pass", "pass_monitor"] as const).some((kind) => profileKindListsShown(kind, screens)),
    ),
  ]),
  ...PRINTER_LISTS.flatMap((list) => [
    profileField(
      list.key,
      list.heading,
      "equipment",
      (p, _s, printers) => orderingProfile(p) && printers,
    ),
    profileField(
      list.defaultKey,
      list.defaultLabel,
      "equipment",
      (p, _s, printers) => orderingProfile(p) && printers,
    ),
  ]).map((f) => ({ ...f, equipment: true })),
  ...[
    profileField(
      "readerIds",
      "device_profiles.card_readers",
      "equipment",
      (p, _s, _printers, readers) => orderingProfile(p) && readers,
    ),
    profileField(
      "defaultReaderId",
      "device_profiles.reader_default",
      "equipment",
      (p, _s, _printers, readers) => orderingProfile(p) && readers,
    ),
  ].map((f) => ({ ...f, equipment: true })),
];

/** Where each field is drawn; a group of switches takes focus on its first switch. */
const FIELD_TARGET: Record<EditorField, string> = {
  name: "[data-test=profile-name]",
  inactivity: "[data-test=profile-inactivity]",
  department: "[data-test=profile-department]",
  zones: "[data-test=profile-zones] wt-switch",
  startingZone: "[data-test=profile-starting-zone]",
  roles: "[data-test=profile-roles] wt-switch",
  actions: "[data-test=profile-actions] wt-switch",
  startingScreen: "[data-test=profile-starting-screen]",
  kitchenScreens: "[data-test=profile-kitchen-screens]",
  stationScreenStations: "[data-test=profile-station-screen-stations] wt-switch",
  passScreenStations: "[data-test=profile-pass-screen-stations] wt-switch",
  passScreenZones: "[data-test=profile-pass-screen-zones] wt-switch",
  passMonitorStations: "[data-test=profile-pass-monitor-stations] wt-switch",
  passMonitorZones: "[data-test=profile-pass-monitor-zones] wt-switch",
  receiptDefault: "[data-test=receipt-printers-default]",
  slipDefault: "[data-test=payment-slip-printers-default]",
  drawerList: "[data-test=cash-drawer-printers] wt-switch",
  drawerDefault: "[data-test=cash-drawer-printers-default]",
  invoiceDefault: "[data-test=invoice-printers-default]",
  readerDefault: "[data-test=profile-readers-default]",
};

/** The request field a refusal names, as the editor field that shows it. */
const FIELD_BY_PARAM: Record<string, EditorField> = {
  name: "name",
  inactivityTimeoutSeconds: "inactivity",
  capabilities: "actions",
  departmentId: "department",
  allowedZoneIds: "zones",
  startingZoneId: "startingZone",
  admittedStaffRoleIds: "roles",
  kitchenScreens: "kitchenScreens",
  stationScreenStations: "stationScreenStations",
  passScreenStations: "passScreenStations",
  passScreenZones: "passScreenZones",
  passMonitorStations: "passMonitorStations",
  passMonitorZones: "passMonitorZones",
  receiptPrinterDefaultId: "receiptDefault",
  paymentSlipPrinterDefaultId: "slipDefault",
  cashDrawerPrinterIds: "drawerList",
  cashDrawerPrinterDefaultId: "drawerDefault",
  invoicePrinterDefaultId: "invoiceDefault",
  defaultReaderId: "readerDefault",
};

/** What a refusal says under each field, when it is not the refusal's own sentence. */
const FIELD_SENTENCE: Partial<Record<EditorField, StringKey>> = {
  department: "device_profiles.err_department",
  zones: "device_profiles.err_zones",
  startingZone: "device_profiles.err_starting_zone",
  roles: "device_profiles.err_roles",
  startingScreen: "device_profiles.err_starting_screen",
  receiptDefault: "device_profiles.err_default_not_listed",
  slipDefault: "device_profiles.err_default_not_listed",
  drawerDefault: "device_profiles.err_default_not_listed",
  invoiceDefault: "device_profiles.err_default_not_listed",
  readerDefault: "device_profiles.err_default_not_listed",
  drawerList: "device_profiles.err_no_cash_drawer",
};

/** `device_profile.invalid`'s reasons that are about one field. */
const FIELD_BY_REASON: Record<string, EditorField> = {
  bad_inactivity_timeout: "inactivity",
  bad_capabilities: "actions",
  shared_display_action: "actions",
  bad_starting_screen: "startingScreen",
};

@customElement("dashboard-device-profiles-screen")
export class DeviceProfilesScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      nav {
        display: flex;
        gap: var(--wt-space-1);
        margin-bottom: var(--wt-space-2);
        color: var(--wt-color-primary-text);
      }
      nav a {
        color: var(--wt-color-primary-text);
        text-decoration: underline;
      }
      .list-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .list-heading .title {
        margin: 0;
      }
      wt-data-table::part(profile-summary) {
        white-space: nowrap;
      }
      .capability-columns {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-form-max-width) / 2)), 1fr)
        );
        gap: var(--wt-space-5);
        align-items: start;
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
      .nested {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-self: stretch;
        margin-inline-start: var(--wt-space-5);
        padding-inline-start: var(--wt-space-3);
        border-inline-start: 1px solid var(--wt-color-border);
      }
      .nested .field {
        margin-bottom: 0;
      }
      .status {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.#standingReadError = { error };
      this.#showReadError(error);
    },
    () => {
      this.#standingReadError = null;
      if (this.#readErrorOwner === "main") this.#showError(null);
    },
  );

  @state() private mode: "list" | "editor" = "list";
  @state() private editorTab: EditorTab = "general";
  @state() private targetUnavailable = false;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "device-profiles") return;
      const before = this.#addressProfile;
      this.#linkedProfile = this.#addressProfile = this.#url.read("profile");
      if (this.#linkedProfile === null) {
        if (before !== null) {
          if (this.mode === "editor" || this.#openingId !== null) this.#closeEditor(false);
        } else if (this.mode === "editor" && this.editingId !== null)
          this.#nameKeptProfile(this.editingId);
      } else if (this.#profilesRead) this.#openLinkedProfile();
    },
    dashboardPath,
  );
  #linkedProfile: string | null = null;
  /** The `profile` word as this screen last read or wrote it. A new profile's editor is named by
   * none, so only the word going away closes an editor. */
  #addressProfile: string | null = null;

  #writeProfileWord(profile: string | null, view = this.#url.read("view")): void {
    void this.#url.write({ profile, view: profile === null ? null : view }, true);
    if (this.#url.read("dashboard") === "device-profiles")
      this.#addressProfile = this.#url.read("profile");
  }
  #profilesRead = false;
  /** The profile whose editor is being read, until the read lands. */
  #openingId: string | null = null;

  /** An id naming no profile opens nothing, and leaves the path rather than sitting in it. */
  #openLinkedProfile(): void {
    const id = this.#linkedProfile;
    if (id === null) return;
    this.#linkedProfile = null;
    if (id === this.#openingId) return;
    if (this.mode === "editor" && id === this.editingId) {
      this.#selectTargetTab();
      return;
    }
    if (this.profiles.some((profile) => profile.id === id))
      void this.#openEditor(id, this.#url.read("view"));
    else this.#writeProfileWord(null);
  }

  #changeEditorTab(tab: EditorTab): void {
    this.editorTab = tab;
    if (this.editingId === null) return;
    const guard = navigationGuardFor(window);
    if (!guard) {
      void this.#url.write({ view: tab }, true);
      return;
    }
    const url = new URL(guard.href);
    url.pathname = `${dashboardPath.basePath}/device-profiles/profile/${encodePathSegment(this.editingId)}/view/${tab}`;
    guard.rewrite(url);
  }

  #selectTargetTab(view = this.#url.read("view")): void {
    const target = view ?? "general";
    this.targetUnavailable = !this.#editorTabs({}).some((tab) => tab.key === target);
    if (!this.targetUnavailable) this.editorTab = target as EditorTab;
  }

  #closeEditor(writeUrl = true): void {
    this.#clearDraft();
    this.mode = "list";
    if (writeUrl && this.#url.read("profile") !== null) this.#writeProfileWord(null);
  }

  @state() private profiles: DeviceProfile[] = [];
  @state() private listScopeChoices: ProfileScopeChoices | null = null;
  @state() private listScopeError: string | null = null;
  readonly #listScopeQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.listScopeError = codeOf(error);
    },
  );

  @state() private printers: Printer[] = [];
  @state() private pagePrinters: PagePrinterRow[] = [];
  @state() private printersState: "loading" | "ready" = "loading";
  /** Both printer reads must answer before the lists are drawn. */
  #printerReads = new Set<PrinterRead>();
  @state() private printerReading: ReadonlySet<PrinterRead> = new Set();

  @state() private stations: Station[] = [];

  @state() private kitchenScreens: { profileId: string; screens: ProfileKitchenScreens }[] = [];

  @state() private scopeChoices: ProfileScopeChoices = { departments: [], zones: [] };

  @state() private jobRoles: JobRole[] = [];
  @state() private jobRolesRead = false;

  @state() private errorKey: string | null = null;
  #readErrorOwner: "main" | "scope" | "profiles" | null = null;
  /** The live reads' latest failure until they recover. Opening the editor clears the screen's
   * message, and this is put back so the form still says why its lists may be stale or empty. */
  #standingReadError: { error: unknown } | null = null;

  @state() private editingId: string | null = null;
  @state() private draftName = "";
  @state() private draftCapabilities: CapabilityFlag[] = [];
  @state() private draftFormFactor: FormFactor = FORM_FACTORS[0];
  @state() private draftInactivityMinutes: number | null = null;
  @state() private invalidInactivityText: string | null = null;
  #otherInactivityDraft?: Pick<ProfileDraft, "inactivityMinutes" | "invalidInactivityText">;
  @state() private draftPrinterLists: PrinterDraft = NO_PRINTER_LISTS;
  #printerDisplayOrder: Partial<Record<PrinterListKey, readonly string[]>> = {};
  /** The drawer list and defaults as opened, so a save sends only the ones it changed. */
  #loadedEquipment: ProfileEquipmentDefaults | null = null;
  /** "hidden" when the session may not manage card readers. */
  @state() private readerState: "loading" | "ready" | "hidden" | "failed" = "loading";
  @state() private readers: ReaderRow[] = [];
  @state() private draftReaders: ProfileReaderList = NO_READERS;
  #loadedReaders: ProfileReaderList = NO_READERS;
  @state() private draftKitchenScreens: ProfileKitchenScreens = {};
  /** The screens the edited profile held when opened, so a save that leaves them alone omits them. */
  #loadedKitchenScreens: ProfileKitchenScreens = {};
  @state() private draftDepartmentId = "";
  @state() private draftEveryZone = true;
  /** The chosen zones while `draftEveryZone` is off, by the zones' position. */
  @state() private draftZoneIds: string[] = [];
  @state() private draftStartingZoneId = "";
  /** Until the service scope changes, unrelated edits leave its stored fields untouched. */
  #scopeEdited = false;
  @state() private draftRoles: string[] = [];
  @state() private draftStartingScreen: string | null = null;
  /** The edited profile as opened, so an edit sends only the parts it changed; null for a new one. */
  #loaded: DeviceProfile | null = null;

  readonly #feedback = new FormFeedback(this);
  /** A refusal's sentence under the field it names, until that field changes or Save is pressed. */
  @state() private fieldRefusal: { field: EditorField; sentence: string } | null = null;

  @state() private saving = false;

  @state() private deleteTarget: DeviceProfile | null = null;

  #draftScope?: DraftScope<ProfileDraft>;
  /** The card readers are read after the editor opens, so their draft is a scope of its own under
   * the editor's. */
  #readerScope?: DraftScope<ProfileReaderList>;
  #leave?: LeaveCoordinator;
  #saveTurn = 0;

  #draftValue(): ProfileDraft {
    const ordering = this.#ordering();
    return {
      name: this.draftName.trim(),
      capabilities: this.draftCapabilities
        .filter((flag) => ordering || sharedDisplayMay(flag))
        .sort(),
      formFactor: this.draftFormFactor,
      inactivityMinutes: this.draftInactivityMinutes,
      invalidInactivityText: this.invalidInactivityText,
      printerLists: structuredClone(this.draftPrinterLists),
      kitchenScreens: comparableScreens(this.draftKitchenScreens),
      departmentId: ordering ? this.draftDepartmentId : "",
      everyZone: ordering ? this.draftEveryZone : true,
      zoneIds: ordering && !this.draftEveryZone ? [...this.draftZoneIds].sort() : [],
      startingZoneId: ordering ? this.draftStartingZoneId : "",
      roles: [...this.draftRoles].sort(),
      startingScreen: ordering ? this.draftStartingScreen : null,
    };
  }

  #registerDraft(): void {
    this.#draftScope?.dispose();
    const { coordinator, scope } = draftScopeFor<ProfileDraft>(this, {
      id: this,
      current: () => this.#draftValue(),
      snapshot: (value) => structuredClone(value),
      equal: sameValue,
      restore: (value) => {
        this.draftName = value.name;
        this.draftCapabilities = [...value.capabilities];
        this.draftFormFactor = value.formFactor;
        this.draftInactivityMinutes = value.inactivityMinutes;
        this.invalidInactivityText = value.invalidInactivityText;
        this.#otherInactivityDraft = undefined;
        this.draftPrinterLists = structuredClone(value.printerLists);
        this.#printerDisplayOrder = {};
        this.draftKitchenScreens = structuredClone(value.kitchenScreens);
        this.draftDepartmentId = value.departmentId;
        this.draftEveryZone = value.everyZone;
        this.draftZoneIds = [...value.zoneIds];
        this.draftStartingZoneId = value.startingZoneId;
        this.draftRoles = [...value.roles];
        this.draftStartingScreen = value.startingScreen;
      },
    });
    this.#leave = coordinator;
    this.#draftScope = scope;
  }

  /** One Save covers the profile and, once they have loaded, its card readers. */
  #saveState() {
    const state = saveActionState({
      isDirty: () => Boolean(this.#draftScope?.isDirty() || this.#readerScope?.isDirty()),
    });
    const awaitingJobs = this.editingId === null && !this.jobRolesRead;
    return {
      ...state,
      variant: awaitingJobs ? ("secondary" as const) : state.variant,
      awaitingJobs,
    };
  }

  override disconnectedCallback(): void {
    this.#clearDraft();
    this.mode = "list";
    this.#profilesRead = false;
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  #jobRolesReady: Promise<void> = Promise.resolve();

  async #load(): Promise<void> {
    this.#showError(null);
    this.listScopeError = null;
    this.jobRolesRead = false;
    try {
      this.#jobRolesReady = this.#queries.watch("listJobRoles", [], (value) => {
        this.jobRoles = value;
        this.jobRolesRead = true;
      });
      await Promise.all([
        this.#listScopeQueries
          .watch(
            "names",
            dashboardQuery(this.api.background ?? this.api, "getProfileScopeChoices", []),
            (value) => {
              this.listScopeChoices = value;
              this.listScopeError = null;
            },
          )
          .catch(() => {}),
        this.#jobRolesReady,
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.profiles = value;
          if (this.#readErrorOwner === "profiles") this.#showError(null);
          this.#profilesRead = true;
          this.#openLinkedProfile();
        }),
        this.#queries.watchSent(
          "listPrinters",
          [],
          (read) => this.#sendPrinterRead("printers", read),
          (value) => {
            this.printers = value;
            this.#printersRead("printers");
          },
        ),
        this.#queries.watchSent(
          "listPagePrinters",
          [],
          (read) => this.#sendPrinterRead("pages", read),
          (value) => {
            this.pagePrinters = value;
            this.#printersRead("pages");
          },
        ),
        this.#queries.watch("listStations", [], (value) => {
          this.stations = value;
        }),
        this.#queries.watch("listProfileKitchenScreens", [], (value) => {
          this.kitchenScreens = value;
        }),
      ]);
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #printersRead(read: PrinterRead): void {
    this.#printerReads.add(read);
    if (this.#printerReads.size === 2) this.printersState = "ready";
  }

  async #sendPrinterRead<T>(read: PrinterRead, send: () => Promise<T>): Promise<T> {
    const others = (from: ReadonlySet<PrinterRead>) => new Set([...from].filter((r) => r !== read));
    this.printerReading = new Set([...this.printerReading, read]);
    try {
      return await send();
    } finally {
      this.printerReading = others(this.printerReading);
    }
  }

  #clearErrorOnOpen(): void {
    this.#showError(null);
    if (this.#standingReadError !== null) this.#showReadError(this.#standingReadError.error);
  }

  #showError(code: string | null, owner: "main" | "scope" | "profiles" | null = null): void {
    this.errorKey = code;
    this.#readErrorOwner = owner;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown, owner: "main" | "scope" | "profiles" = "main"): void {
    if (this.errorKey === null || this.#readErrorOwner !== null)
      this.#showError(codeOf(error), owner);
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.#showError(null);
    let written = false;
    try {
      await action();
      written = true;
      this.profiles = await this.api.listDeviceProfiles();
    } catch (error) {
      if (written) this.#showReadError(error, "profiles");
      else this.#showError(codeOf(error));
    }
  }

  /** The field a refusal is about and what to say there, by what the error carries. */
  #refusedField(error: unknown): { field: EditorField; sentence: string } | null {
    const code = codeOf(error);
    const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
    let field: EditorField | undefined;
    if (code === "device_profile.name_taken") field = "name";
    else if (code === "device_profile.invalid")
      field =
        typeof params.field === "string"
          ? FIELD_BY_PARAM[params.field]
          : typeof params.reason === "string"
            ? FIELD_BY_REASON[params.reason]
            : undefined;
    else if (code === "management.request_invalid" && params.field === "kitchenScreens")
      // Only a dashboard bug sends a malformed entry, so no field of the form can mend it.
      field = undefined;
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
        : code === "device_profile.access_invalid" &&
            params.reason === "empty" &&
            KITCHEN_LIST_FIELDS.includes(field)
          ? t("device_profiles.err_list_empty")
          : own !== undefined
            ? t(own)
            : codeMessage(code);
    return { field, sentence };
  }

  #capabilitySummary(capabilities: string[], compact = false): string {
    const known = CAPABILITY_FLAGS.filter((flag) => capabilities.includes(flag));
    if (known.length === 0) return t("device_profiles.no_capabilities");
    const labels = known
      .slice(0, compact ? 2 : undefined)
      .map((flag) => t(`device_profiles.capability.${flag}` as StringKey));
    if (compact && known.length > 2)
      labels.push(fill("device_profiles.more_capabilities", { count: String(known.length - 2) }));
    return labels.join(", ");
  }

  // ── The form's own checks ────────────────────────────────────────────────────────────────────────

  #ordering(): boolean {
    return !isSharedDisplay(this.draftFormFactor);
  }

  /** The fields the form draws now, so a refusal about a hidden one goes to the bottom instead. */
  #shownFields(): EditorField[] {
    const kds = !this.#ordering();
    const listsShown: EditorField[] = KITCHEN_SCREEN_KINDS.flatMap((kind) => {
      if (!this.#kindListsShown(kind)) return [];
      const { stations, zones } = KIND_FIELDS[kind];
      return zones === null ? [stations] : [stations, zones];
    });
    return FIELDS.filter((field) => {
      if (kds && FIELD_TAB[field] === "equipment") return false;
      if (KITCHEN_LIST_FIELDS.includes(field)) return listsShown.includes(field);
      if (["department", "zones", "startingZone", "startingScreen"].includes(field)) return !kds;
      if (field === "readerDefault") return !kds && this.#readersShown();
      return true;
    });
  }

  #decidesScope(): boolean {
    const loaded = this.#loaded;
    return (
      loaded === null ||
      loaded.departmentId === null ||
      this.#scopeEdited ||
      this.#allowedZones().length === 0
    );
  }

  #ownErrors(): FieldErrors {
    if (!this.#feedback.attempted) return {};
    const errors: FieldErrors = {};
    if (this.draftName.trim() === "") errors.name = t("form.name_required");
    if (this.invalidInactivityText !== null)
      errors.inactivity = t("device_profiles.err_inactivity");
    if (this.#ordering()) {
      if (this.#decidesScope()) {
        const departmentHasZones = this.#departmentZones(this.draftDepartmentId).length > 0;
        if (this.draftDepartmentId === "")
          errors.department = t("device_profiles.err_department_required");
        else if (!departmentHasZones) errors.zones = t("device_profiles.err_department_no_zones");
        else if (this.#allowedZones().length === 0)
          errors.zones = t("device_profiles.err_zones_required");
        if (
          this.draftStartingZoneId === "" &&
          (this.draftDepartmentId === "" || departmentHasZones)
        )
          errors.startingZone = t("device_profiles.err_starting_zone_required");
      }
    }
    return errors;
  }

  /** A refusal's sentence goes under its field unless the form's own check already marks it. */
  #errors(): FieldErrors {
    const errors = this.#ownErrors();
    const refused = this.fieldRefusal;
    if (
      refused !== null &&
      this.#feedback.shows(refused.field) &&
      this.#shownFields().includes(refused.field) &&
      !errors[refused.field]
    )
      errors[refused.field] = refused.sentence;
    return errors;
  }

  #clearRefusal(...fields: EditorField[]): void {
    if (this.fieldRefusal !== null && fields.includes(this.fieldRefusal.field))
      this.#feedback.dismiss(this.fieldRefusal.field);
  }

  #showFieldRefusal(refused: NonNullable<typeof this.fieldRefusal>): void {
    this.fieldRefusal = refused;
    this.#feedback.newRefusal(refused.field);
    void this.#focusFirstError({ [refused.field]: refused.sentence });
  }

  #fieldTab(field: EditorField): EditorTab {
    return profileSettingTab(field, this.draftFormFactor);
  }

  #editorTabs(errors: FieldErrors): TabItem[] {
    const tabs: { key: EditorTab; label: StringKey }[] = [
      { key: "general", label: "device_profiles.tab.general" },
      ...(this.#ordering()
        ? [{ key: "where" as const, label: "device_profiles.where_heading" as const }]
        : [{ key: "kitchen" as const, label: "device_profiles.tab.kitchen" as const }]),
      { key: "who", label: "device_profiles.who_heading" },
      { key: "capabilities", label: "device_profiles.tab.capabilities" },
      ...(this.#ordering()
        ? [{ key: "equipment" as const, label: "device_profiles.tab.equipment" as const }]
        : []),
    ];
    return tabs.map(({ key, label }) => ({
      key,
      label: t(label),
      marked: FIELDS.some((field) => errors[field] && this.#fieldTab(field) === key)
        ? t("form.fix_fields")
        : undefined,
    }));
  }

  async #focusFirstError(errors: FieldErrors): Promise<void> {
    await this.updateComplete;
    const field = FIELDS.find((name) => errors[name]);
    if (field === undefined) return;
    this.#changeEditorTab(this.#fieldTab(field));
    await this.updateComplete;
    await this.renderRoot.querySelector("wt-tabs")?.updateComplete;
    const target = FIELD_TARGET[field];
    this.renderRoot.querySelector<HTMLElement>(target)?.focus();
  }

  // ── Where it serves ──────────────────────────────────────────────────────────────────────────────

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
    this.#scopeEdited = true;
    this.draftDepartmentId = event.detail.value;
    this.draftEveryZone = true;
    this.draftZoneIds = [];
    this.draftStartingZoneId = "";
    this.#settleStartingZone();
    this.#clearRefusal("department", "zones", "startingZone");
    this.#draftScope?.changed();
  }

  #onEveryZone(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.#scopeEdited = true;
    this.draftEveryZone = event.detail.checked;
    this.draftZoneIds = event.detail.checked
      ? []
      : this.#departmentZones(this.draftDepartmentId).map((zone) => zone.id);
    this.#settleStartingZone();
    this.#clearRefusal("zones", "startingZone");
    this.#draftScope?.changed();
  }

  #onZone(event: CustomEvent<{ checked: boolean }>, zoneId: string): void {
    event.stopPropagation();
    this.#scopeEdited = true;
    this.draftZoneIds = toggleMembership(
      this.draftZoneIds,
      this.#departmentZones(this.draftDepartmentId).map((zone) => zone.id),
      zoneId,
      event.detail.checked,
    );
    this.#settleStartingZone();
    this.#clearRefusal("zones", "startingZone");
    this.#draftScope?.changed();
  }

  #onStartingZone(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#scopeEdited = true;
    this.draftStartingZoneId = event.detail.value;
    this.#clearRefusal("startingZone");
    this.#draftScope?.changed();
  }

  // ── Who can sign in ──────────────────────────────────────────────────────────────────────────────

  #onRole(event: CustomEvent<{ checked: boolean }>, role: string): void {
    event.stopPropagation();
    this.draftRoles = toggleMembership(
      this.draftRoles,
      this.jobRoles.map((job) => job.id),
      role,
      event.detail.checked,
    );
    this.#clearRefusal("roles");
    this.#draftScope?.changed();
  }

  #clearDraft(): void {
    this.#scopeQueries.release("choices");
    this.#latestScopeChoices = null;
    this.#saveTurn++;
    this.saving = false;
    this.#draftScope?.dispose();
    this.#draftScope = undefined;
    this.#readerScope?.dispose();
    this.#readerScope = undefined;
    this.#leave = undefined;
    this.#openingId = null;
    this.editingId = null;
    this.editorTab = "general";
    this.targetUnavailable = false;
    this.draftName = "";
    this.draftCapabilities = [];
    this.draftFormFactor = FORM_FACTORS[0];
    this.draftInactivityMinutes = null;
    this.invalidInactivityText = null;
    this.#otherInactivityDraft = undefined;
    this.draftPrinterLists = NO_PRINTER_LISTS;
    this.#printerDisplayOrder = {};
    this.#loadedEquipment = null;
    this.readerState = "loading";
    this.readers = [];
    this.draftReaders = NO_READERS;
    this.#loadedReaders = NO_READERS;
    this.draftKitchenScreens = {};
    this.#loadedKitchenScreens = {};
    this.draftDepartmentId = "";
    this.draftEveryZone = true;
    this.draftZoneIds = [];
    this.draftStartingZoneId = "";
    this.#scopeEdited = false;
    this.draftRoles = this.jobRoles.map((role) => role.id);
    this.draftStartingScreen = null;
    this.#loaded = null;
    this.#feedback.reset();
    this.fieldRefusal = null;
    this.#opened += 1;
  }

  /** Bumped by every open and close of the editor, so a read that lands after the editor moved
   * on changes nothing. */
  #opened = 0;

  #latestScopeChoices: ProfileScopeChoices | null = null;

  readonly #scopeQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => this.#showReadError(error, "scope"),
    () => {
      if (this.#readErrorOwner === "scope") this.#showError(null);
    },
  );

  #watchScopeChoices(): Promise<ProfileScopeChoices> {
    const opened = this.#opened;
    const first = this.api.getProfileScopeChoices();
    let initial = true;
    const query = dashboardQuery(this.api.background ?? this.api, "getProfileScopeChoices", []);
    void this.#scopeQueries
      .watch(
        "choices",
        {
          ...query,
          // The list snapshot must not replace the editor's opening read.
          key: `editor:${query.key}`,
          read: () => {
            if (!initial) return query.read();
            initial = false;
            return first;
          },
        },
        (choices) => {
          if (opened !== this.#opened) return;
          this.#latestScopeChoices = choices;
          this.scopeChoices = choices;
          if (this.mode === "editor") this.#settleStartingZone();
        },
      )
      .catch(() => {});
    return first;
  }

  #openCreate(): void {
    this.#clearDraft();
    this.#clearErrorOnOpen();
    this.mode = "editor";
    this.#registerDraft();
    const baseline = this.#draftValue();
    const scope = this.#draftScope;
    const opened = this.#opened;
    void this.#loadReaders(null, opened);
    Promise.all([this.#watchScopeChoices(), this.#jobRolesReady]).then(
      ([initialChoices]) => {
        if (opened !== this.#opened) return;
        const choices = this.#latestScopeChoices ?? initialChoices;
        this.scopeChoices = choices;
        const defaults = this.jobRoles.map((role) => role.id);
        if (sameIds(this.draftRoles, baseline.roles)) this.draftRoles = defaults;
        baseline.roles = [...defaults].sort();
        scope?.commit(baseline);
        if (this.draftDepartmentId !== "") return;
        const departments = choices.departments.filter((department) => department.active);
        if (departments.length !== 1) return;
        this.draftDepartmentId = departments[0]!.id;
        this.#settleStartingZone();
        scope?.commit({
          ...baseline,
          departmentId: this.draftDepartmentId,
          startingZoneId: this.draftStartingZoneId,
        });
      },
      (error: unknown) => {
        if (opened === this.#opened) this.#showReadError(error, "scope");
      },
    );
  }

  /** Fetches the profile and its kitchen screens fresh, rather than reusing rows a read may not have
   * delivered yet. */
  async #openEditor(id: string, view: string | null = null): Promise<void> {
    this.#clearErrorOnOpen();
    this.#clearDraft();
    const opened = this.#opened;
    this.#openingId = id;
    try {
      const [profile, kitchenScreens, initialChoices] = await Promise.all([
        this.api.getDeviceProfile(id),
        this.api.listProfileKitchenScreens(),
        this.#watchScopeChoices(),
      ]);
      if (opened !== this.#opened) return;
      this.#openingId = null;
      const choices = this.#latestScopeChoices ?? initialChoices;
      this.scopeChoices = choices;
      this.editingId = id;
      this.#loaded = profile;
      this.draftName = profile.name;
      this.draftCapabilities = CAPABILITY_FLAGS.filter((flag) =>
        profile.capabilities.includes(flag),
      );
      this.draftFormFactor = profile.formFactor;
      this.invalidInactivityText = null;
      this.draftInactivityMinutes =
        profile.inactivityTimeoutSeconds == null ? null : profile.inactivityTimeoutSeconds / 60;
      const equipment = equipmentOf(profile);
      this.#loadedEquipment = equipment;
      this.draftPrinterLists = {
        receiptPrinterIds: profile.receiptPrinterIds,
        paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
        ...equipment,
      };
      this.#loadedKitchenScreens =
        kitchenScreens.find((entry) => entry.profileId === id)?.screens ?? {};
      this.draftKitchenScreens = structuredClone(this.#loadedKitchenScreens);
      this.draftDepartmentId = profile.departmentId ?? "";
      if (profile.departmentId !== null) {
        const zones = liveZones(profile, choices);
        this.draftEveryZone = zones.allowedZoneIds === null;
        this.draftZoneIds = zones.allowedZoneIds ?? [];
        this.draftStartingZoneId = zones.startingZoneId;
      }
      this.draftRoles = [...profile.admittedStaffRoleIds];
      this.draftStartingScreen = profile.startingScreen;
      if (this.#ordering() && profile.departmentId !== null && this.#allowedZones().length === 0)
        this.#feedback.press();
      this.mode = "editor";
      this.#registerDraft();
      this.#selectTargetTab(view);
      this.#writeProfileWord(id, view);
      void this.#loadReaders(id, this.#opened);
    } catch (error) {
      if (opened === this.#opened) {
        this.#openingId = null;
        if (this.#url.read("profile") === id) this.#writeProfileWord(null);
        this.#showReadError(error);
      }
    }
  }

  async #loadReaders(profileId: string | null, opened: number): Promise<void> {
    try {
      const [readers, list] = await Promise.all([
        this.api.listReaders(),
        profileId === null ? NO_READERS : this.api.getProfileReaders(profileId),
      ]);
      if (opened !== this.#opened) return;
      this.readers = readers;
      this.#loadedReaders = list;
      this.draftReaders = list;
      this.readerState = "ready";
      this.#readerScope?.dispose();
      this.#readerScope = draftScopeFor<ProfileReaderList>(this, {
        id: {},
        parent: this,
        current: () => this.draftReaders,
        snapshot: (value) => structuredClone(value),
        equal: sameReaders,
        restore: (value) => {
          this.draftReaders = value;
        },
      }).scope;
    } catch (error) {
      if (opened !== this.#opened) return;
      if (codeOf(error) === "authorization.not_permitted") this.readerState = "hidden";
      else {
        this.readerState = "failed";
        this.#showReadError(error);
      }
    }
  }

  /** After a reader deleted elsewhere is refused, so it drops out of the list and the default. */
  async #rereadReaders(profileId: string, opened: number, turn: number): Promise<void> {
    try {
      const [readers, list] = await Promise.all([
        this.api.listReaders(),
        this.api.getProfileReaders(profileId),
      ]);
      if (opened !== this.#opened || turn !== this.#saveTurn) return;
      const exists = (id: string | null) => readers.some((reader) => reader.id === id);
      this.readers = readers;
      this.#loadedReaders = list;
      this.#readerScope?.commit(list);
      const draft = this.draftReaders;
      this.draftReaders = {
        readerIds: draft.readerIds.filter(exists),
        defaultReaderId: exists(draft.defaultReaderId) ? draft.defaultReaderId : null,
      };
      this.#readerScope?.changed();
    } catch (error) {
      if (opened !== this.#opened || turn !== this.#saveTurn) return;
      this.#showReadError(error);
    }
  }

  /** Drawn once read, and only where the venue has a reader or the profile still lists one. */
  #readersShown(): boolean {
    return profileReadersShown(
      this.readerState === "ready",
      this.readers,
      this.draftReaders.readerIds,
    );
  }

  #onName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftName = event.detail.value;
    this.#clearRefusal("name");
    this.#draftScope?.changed();
  }

  #onFormFactor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const formFactor = event.detail.value as FormFactor;
    if (isSharedDisplay(formFactor) !== isSharedDisplay(this.draftFormFactor)) {
      const other = this.#otherInactivityDraft;
      this.#otherInactivityDraft = {
        inactivityMinutes: this.draftInactivityMinutes,
        invalidInactivityText: this.invalidInactivityText,
      };
      this.draftInactivityMinutes = other?.inactivityMinutes ?? null;
      this.invalidInactivityText = other?.invalidInactivityText ?? null;
      this.#clearRefusal("inactivity");
    }
    this.draftFormFactor = formFactor;
    this.#clearRefusal("actions");
    this.#draftScope?.changed();
  }

  #onInactivity(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const raw = event.detail.value.trim();
    const parsed = parseDecimalInput(raw);
    this.invalidInactivityText = parsed === null && /[\d.,]/.test(raw) ? raw : null;
    if (this.invalidInactivityText === null)
      this.draftInactivityMinutes = parsed === null ? null : Number(parsed);
    this.#clearRefusal("inactivity");
    this.#draftScope?.changed();
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
    this.#draftScope?.changed();
  }

  #onStartingScreen(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftStartingScreen = event.detail.value === "" ? null : event.detail.value;
    this.#clearRefusal("startingScreen");
    this.#draftScope?.changed();
  }

  #printerOrder(key: PrinterListKey, visible?: readonly string[]): readonly string[] {
    const order = this.#printerDisplayOrder[key] ?? this.#loaded?.[key] ?? [];
    return visible === undefined ? order : [...new Set([...order, ...visible])];
  }

  #onPrinterToggle(
    event: CustomEvent<{ checked: boolean }>,
    list: (typeof PRINTER_LISTS)[number],
    printerId: string,
    visible: readonly string[],
  ): void {
    event.stopPropagation();
    this.#printerDisplayOrder[list.key] = this.#printerOrder(list.key, visible);
    const unlisted = !event.detail.checked && this.draftPrinterLists[list.defaultKey] === printerId;
    this.draftPrinterLists = {
      ...this.draftPrinterLists,
      [list.key]: toggleEquipment(
        this.draftPrinterLists[list.key],
        visible,
        printerId,
        event.detail.checked,
      ),
      ...(unlisted ? { [list.defaultKey]: null } : {}),
    };
    this.#clearRefusal(
      list.defaultField,
      ...(list.key === "cashDrawerPrinterIds" ? (["drawerList"] as const) : []),
    );
    this.#draftScope?.changed();
  }

  #onPrinterDefault(
    event: CustomEvent<{ value: string }>,
    list: (typeof PRINTER_LISTS)[number],
  ): void {
    event.stopPropagation();
    this.draftPrinterLists = {
      ...this.draftPrinterLists,
      [list.defaultKey]: event.detail.value === "" ? null : event.detail.value,
    };
    this.#clearRefusal(list.defaultField);
    this.#draftScope?.changed();
  }

  #onReaderToggle(
    event: CustomEvent<{ checked: boolean }>,
    readerId: string,
    visible: readonly string[],
  ): void {
    event.stopPropagation();
    const unlisted = !event.detail.checked && this.draftReaders.defaultReaderId === readerId;
    this.draftReaders = {
      readerIds: toggleEquipment(
        this.draftReaders.readerIds,
        visible,
        readerId,
        event.detail.checked,
      ),
      defaultReaderId: unlisted ? null : this.draftReaders.defaultReaderId,
    };
    this.#clearRefusal("readerDefault");
    this.#readerScope?.changed();
  }

  #onReaderDefault(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftReaders = {
      ...this.draftReaders,
      defaultReaderId: event.detail.value === "" ? null : event.detail.value,
    };
    this.#clearRefusal("readerDefault");
    this.#readerScope?.changed();
  }

  /** The drawer and invoice lists and defaults this save sends: on an edit only those that changed. */
  #equipmentToSend(): Partial<ProfileEquipmentDefaults> {
    if (!this.#ordering()) return {};
    const draft = this.draftPrinterLists;
    const loaded = this.#loadedEquipment ?? NO_EQUIPMENT;
    const sent: Partial<ProfileEquipmentDefaults> = {};
    for (const key of ["cashDrawerPrinterIds", "invoicePrinterIds"] as const)
      if (!sameOrderedIds(draft[key], loaded[key])) sent[key] = [...draft[key]];
    for (const { defaultKey } of PRINTER_LISTS)
      if (draft[defaultKey] !== loaded[defaultKey]) sent[defaultKey] = draft[defaultKey];
    return sent;
  }

  #scopeOf(kind: KitchenScreenKind): ProfileKitchenScreen {
    return this.draftKitchenScreens[kind] ?? EVERY;
  }

  #onKitchenScreenKind(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const kind = KITCHEN_SCREEN_KINDS.find((kind) => kind === event.detail.value);
    this.draftKitchenScreens =
      kind === undefined
        ? {}
        : { [kind]: structuredClone(this.#loadedKitchenScreens[kind] ?? EVERY) };
    this.#clearRefusal("kitchenScreens", ...KITCHEN_LIST_FIELDS);
    this.#draftScope?.changed();
  }

  #setScreen(kind: KitchenScreenKind, scope: ProfileKitchenScreen | undefined): void {
    const next = { ...this.draftKitchenScreens };
    if (scope === undefined) delete next[kind];
    else next[kind] = scope;
    this.draftKitchenScreens = next;
    const { stations, zones } = KIND_FIELDS[kind];
    this.#clearRefusal("kitchenScreens", stations, ...(zones === null ? [] : [zones]));
    this.#draftScope?.changed();
  }

  /** Every station, or each switched-on station listed. */
  #onScreenEveryStation(event: CustomEvent<{ checked: boolean }>, kind: KitchenScreenKind): void {
    event.stopPropagation();
    const stationIds = event.detail.checked
      ? null
      : this.stations.filter((station) => station.active).map((station) => station.id);
    this.#setScreen(kind, { ...this.#scopeOf(kind), stationIds });
  }

  #onScreenEveryZone(event: CustomEvent<{ checked: boolean }>, kind: KitchenScreenKind): void {
    event.stopPropagation();
    const zoneIds = event.detail.checked
      ? null
      : this.scopeChoices.zones.filter((zone) => zone.active).map((zone) => zone.id);
    this.#setScreen(kind, { ...this.#scopeOf(kind), zoneIds });
  }

  #onShowOtherStations(event: CustomEvent<{ checked: boolean }>, kind: KitchenScreenKind): void {
    event.stopPropagation();
    this.#setScreen(kind, { ...this.#scopeOf(kind), showNonPassStations: event.detail.checked });
  }

  #onListed(
    event: CustomEvent<{ checked: boolean }>,
    kind: KitchenScreenKind,
    key: "stationIds" | "zoneIds",
    id: string,
  ): void {
    event.stopPropagation();
    const scope = this.#scopeOf(kind);
    const others = (scope[key] ?? []).filter((entry) => entry !== id);
    this.#setScreen(kind, { ...scope, [key]: event.detail.checked ? [...others, id] : others });
  }

  /**
   * The kitchen screens, when this save should send them: only when they changed, so a save that
   * leaves them alone cannot be refused over a list it does not touch.
   */
  #kitchenScreensToSend(): ProfileSaveExtras | undefined {
    if (
      sameValue(
        comparableScreens(this.draftKitchenScreens),
        comparableScreens(this.#loadedKitchenScreens),
      )
    )
      return undefined;
    const screens = structuredClone(this.draftKitchenScreens);
    for (const scope of Object.values(screens)) {
      if (scope.stationIds !== null)
        scope.stationIds = scope.stationIds.filter((id) =>
          this.stations.some((station) => station.active && station.id === id),
        );
    }
    return { kitchenScreens: screens };
  }

  #extrasToSend(formFactor: FormFactor): ProfileSaveExtras | undefined {
    const loaded = this.#loaded;
    const extras: ProfileSaveExtras = {
      ...this.#kitchenScreensToSend(),
      ...this.#equipmentToSend(),
    };
    if (isSharedDisplay(formFactor)) {
      if (loaded !== null && loaded.startingScreen !== null) extras.startingScreen = null;
    } else {
      const scope: ProfileServiceScope = {
        departmentId: this.draftDepartmentId,
        allowedZoneIds: this.draftEveryZone ? null : [...this.draftZoneIds],
        startingZoneId: this.draftStartingZoneId,
      };
      if (this.#decidesScope() && (loaded === null || !sameScope(scope, loaded)))
        Object.assign(extras, scope);
      const screen = this.draftStartingScreen;
      if (loaded === null ? screen !== null : screen !== loaded.startingScreen)
        extras.startingScreen = screen;
    }
    const roles = this.draftRoles;
    if (
      !sameIds(
        roles,
        loaded === null ? this.jobRoles.map((role) => role.id) : loaded.admittedStaffRoleIds,
      )
    )
      extras.admittedStaffRoleIds = [...roles];
    return Object.keys(extras).length === 0 ? undefined : extras;
  }

  /** Swaps with the neighbour on screen, so an id the printer list has not delivered is passed
   * over rather than swapped with unseen. */
  async #movePrinter(
    key: PrinterListKey,
    drawn: readonly string[],
    visible: readonly string[],
    printerId: string,
    by: -1 | 1,
    button: WtButton,
  ): Promise<void> {
    const focused = this.shadowRoot!.activeElement === button;
    const neighbour = drawn[drawn.indexOf(printerId) + by]!;
    const list = [...this.draftPrinterLists[key]];
    const from = list.indexOf(printerId);
    const to = list.indexOf(neighbour);
    [list[from], list[to]] = [neighbour, printerId];
    this.#printerDisplayOrder[key] = this.#printerOrder(key, visible).map((id) =>
      id === printerId ? neighbour : id === neighbour ? printerId : id,
    );
    this.draftPrinterLists = { ...this.draftPrinterLists, [key]: list };
    this.#draftScope?.changed();
    if (!focused) return;
    await this.updateComplete;
    const active = this.shadowRoot!.activeElement;
    if (button.isConnected && (active === null || active === button)) {
      const target = button.disabled
        ? button.parentElement?.querySelector<WtButton>("wt-button:not([disabled])")
        : button;
      target?.focus();
    }
  }

  async #cancel(reason: "cancel" | "navigation" = "cancel"): Promise<void> {
    if (this.saving) return;
    const proceed = () => {
      this.#closeEditor();
      this.#showError(null);
      if (this.#standingReadError !== null) this.#showReadError(this.#standingReadError.error);
    };
    if (this.#leave) await this.#leave.request({ scopes: [this], reason, proceed });
    else proceed();
  }

  /** The editor stays open on the saved profile, so the next Save edits it rather than adding
   * another. */
  #keepEditing(saved: DeviceProfile, submitted: ProfileDraft): void {
    this.editingId = saved.id;
    this.#loaded = saved;
    this.#loadedKitchenScreens = structuredClone(submitted.kitchenScreens);
    this.#loadedEquipment = equipmentOf(submitted.printerLists);
    this.#nameKeptProfile(saved.id);
  }

  /** A guarded write would ask the leave question whenever unsaved input is held. */
  #nameKeptProfile(id: string): void {
    if (this.#url.read("dashboard") !== "device-profiles" || this.#url.read("profile") === id)
      return;
    const guard = navigationGuardFor(window);
    if (guard === undefined) return this.#writeProfileWord(id);
    const url = new URL(guard.href);
    url.pathname = `${dashboardPath.basePath}/device-profiles/profile/${encodePathSegment(id)}`;
    guard.rewrite(url);
  }

  /**
   * Saves the reader list captured at Save once the profile is saved, when it changed. Only a
   * refusal for this editor's opening keeps it open; false means the save goes no further.
   */
  async #saveReaders(
    saved: DeviceProfile,
    submitted: ProfileDraft,
    readers: ProfileReaderList | null,
    scope: DraftScope<ProfileReaderList> | undefined,
    active: () => boolean,
    turn: number,
  ): Promise<boolean> {
    if (readers === null || sameReaders(readers, this.#loadedReaders)) return true;
    try {
      await this.api.setProfileReaders(saved.id, readers);
    } catch (error) {
      if (!active()) return false;
      this.#keepEditing(saved, submitted);
      if (codeOf(error) === "reader.not_found")
        void this.#rereadReaders(saved.id, this.#opened, turn);
      const refused = this.#refusedField(error);
      if (refused === null) this.#showError(codeOf(error));
      else this.#showFieldRefusal(refused);
      return false;
    }
    if (!active()) return false;
    this.#loadedReaders = readers;
    scope?.commit(readers);
    return true;
  }

  /** The server accepts `""` as a name, so an empty name is refused here. */
  async #save(): Promise<void> {
    const state = this.#saveState();
    if (this.saving || state.unchanged || state.awaitingJobs) return;
    this.#feedback.press();
    this.fieldRefusal = null;
    this.#showError(null);
    const own = this.#ownErrors();
    if (Object.keys(own).length > 0) {
      void this.#focusFirstError(own);
      return;
    }
    const name = this.draftName.trim();
    const id = this.editingId;
    const formFactor = this.draftFormFactor;
    const capabilities = this.draftCapabilities.filter(
      (flag) => !isSharedDisplay(formFactor) || sharedDisplayMay(flag),
    );
    const inactivityTimeoutSeconds =
      this.draftInactivityMinutes === null ? null : this.draftInactivityMinutes * 60;
    const printerLists: ProfilePrinterLists = {
      receiptPrinterIds: this.#ordering() ? this.draftPrinterLists.receiptPrinterIds : [],
      paymentSlipPrinterIds: this.#ordering() ? this.draftPrinterLists.paymentSlipPrinterIds : [],
    };
    const extras = this.#extrasToSend(formFactor);
    const extrasArg = extras === undefined ? [] : ([extras] as const);
    const scope = this.#draftScope;
    const submitted = this.#draftValue();
    const readers = this.readerState === "ready" ? this.draftReaders : null;
    const readerScope = this.#readerScope;
    const opened = this.#opened;
    const active = () => this.isConnected && opened === this.#opened;
    const turn = ++this.#saveTurn;
    let resultTurn = turn;
    this.saving = true;
    let written = false;
    try {
      const saved =
        id !== null
          ? await this.api.updateDeviceProfile(
              id,
              name,
              capabilities,
              formFactor,
              inactivityTimeoutSeconds,
              printerLists,
              ...extrasArg,
            )
          : await this.api.createDeviceProfile(
              name,
              capabilities,
              formFactor,
              inactivityTimeoutSeconds,
              printerLists,
              ...extrasArg,
            );
      written = true;
      if (!active()) return;
      scope?.commit(submitted);
      if (!(await this.#saveReaders(saved, submitted, readers, readerScope, active, turn))) return;
      if (scope?.isDirty() || readerScope?.isDirty()) this.#keepEditing(saved, submitted);
      else this.#closeEditor();
      resultTurn = this.#saveTurn;
      const profiles = await this.api.listDeviceProfiles();
      if (this.isConnected && resultTurn === this.#saveTurn && (this.mode === "list" || active()))
        this.profiles = profiles;
    } catch (error) {
      if (
        !this.isConnected ||
        resultTurn !== this.#saveTurn ||
        (this.mode === "editor" && !active())
      )
        return;
      if (written) this.#showReadError(error);
      else {
        const refused = this.#refusedField(error);
        if (refused === null) this.#showError(codeOf(error));
        else this.#showFieldRefusal(refused);
      }
    } finally {
      if (turn === this.#saveTurn) this.saving = false;
    }
  }

  // ── Duplicate ────────────────────────────────────────────────────────────────────────────────────

  #duplicate(profile: DeviceProfile): void {
    const name = `${profile.name}${t("device_profiles.copy_suffix")}`;
    let readersFailed: { error: unknown } | null = null;
    const copied = this.#mutate(async () => {
      const extras: ProfileSaveExtras = { admittedStaffRoleIds: [...profile.admittedStaffRoleIds] };
      const choices = await this.api.getProfileScopeChoices();
      const stored = this.kitchenScreens.find((entry) => entry.profileId === profile.id)?.screens;
      const screens = switchedOnScreens(
        stored ?? {},
        (id) => this.stations.some((station) => station.id === id && station.active),
        (id) => choices.zones.some((zone) => zone.id === id && zone.active),
      );
      if (Object.keys(screens).length > 0) extras.kitchenScreens = screens;
      if (!isSharedDisplay(profile.formFactor)) {
        const departmentOn = choices.departments.some(
          (department) => department.id === profile.departmentId && department.active,
        );
        const zones = liveZones(profile, choices);
        if (departmentOn && zones.startingZoneId !== "")
          Object.assign(extras, { departmentId: profile.departmentId, ...zones });
        if (profile.startingScreen !== null) extras.startingScreen = profile.startingScreen;
      }
      if (profile.cashDrawerPrinterIds.length > 0)
        extras.cashDrawerPrinterIds = profile.cashDrawerPrinterIds;
      if (profile.invoicePrinterIds.length > 0)
        extras.invoicePrinterIds = profile.invoicePrinterIds;
      for (const { defaultKey } of PRINTER_LISTS)
        if (profile[defaultKey] !== null) extras[defaultKey] = profile[defaultKey];
      const extrasArg = Object.keys(extras).length === 0 ? [] : ([extras] as const);
      const created = await this.api.copyDeviceProfile(
        profile.id,
        name,
        profile.capabilities,
        profile.formFactor,
        profile.inactivityTimeoutSeconds,
        {
          receiptPrinterIds: profile.receiptPrinterIds,
          paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
        },
        ...extrasArg,
      );
      readersFailed = await this.#copyReaders(profile.id, created.id);
    });
    void copied.then(() => {
      if (readersFailed !== null) this.#showError(codeOf(readersFailed.error));
    });
  }

  /** The copy is made and kept even when its readers cannot be; a manager who may not manage card
   * readers copies none, as the editor hides them. */
  async #copyReaders(fromId: string, toId: string): Promise<{ error: unknown } | null> {
    try {
      const list = await this.api.getProfileReaders(fromId);
      if (list.readerIds.length > 0) await this.api.setProfileReaders(toId, list);
      return null;
    } catch (error) {
      return codeOf(error) === "authorization.not_permitted" ? null : { error };
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #deleteOpener: HTMLElement | null = null;

  #openDelete(profile: DeviceProfile, event: Event): void {
    this.#deleteOpener =
      (event.currentTarget as HTMLElement)
        .closest("wt-row-actions")
        ?.shadowRoot?.querySelector("button") ?? null;
    this.deleteTarget = profile;
  }

  #confirmDelete(): void {
    const target = this.deleteTarget;
    if (target === null) return;
    const id = target.id;
    this.deleteTarget = null;
    void this.#mutate(() => this.api.deleteDeviceProfile(id)).then(async () => {
      if (this.profiles.some((profile) => profile.id === id)) return;
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>('[data-test="create"]')?.focus();
    });
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #scopeSummary(profile: DeviceProfile): string {
    if (isSharedDisplay(profile.formFactor)) return t("device_profiles.scope_kitchen");
    const choices = this.listScopeChoices;
    if (this.listScopeError !== null) return t("device_profiles.scope_unavailable");
    if (choices === null) return t("device_profiles.scope_loading");
    const department = choices.departments.find(({ id }) => id === profile.departmentId);
    if (!department) return t("device_profiles.department_unavailable");
    if (profile.allowedZoneIds === null)
      return `${department.name} · ${t("device_profiles.all_zones")}`;
    const zones = profile.allowedZoneIds.map((id) => {
      const zone = choices.zones.find(
        (zone) => zone.id === id && zone.departmentId === department.id,
      );
      return zone === undefined
        ? undefined
        : zone.active
          ? zone.name
          : `${zone.name} (${t("device_profiles.zone_disabled_mark")})`;
    });
    if (zones.length === 0) return `${department.name} · ${t("device_profiles.no_zones")}`;
    return zones.some((name) => name === undefined)
      ? t("device_profiles.scope_unavailable")
      : `${department.name} · ${zones.join(", ")}`;
  }

  #columns(): DataTableColumn<DeviceProfile>[] {
    return [
      {
        key: "name",
        label: t("device_profiles.name"),
        searchValue: (profile) => profile.name,
        sortValue: (profile) => profile.name,
        cell: (profile) =>
          html`<span part="profile-summary" data-test=${`profile-name-${profile.id}`}
            >${profile.name}</span
          >`,
      },
      {
        key: "formFactor",
        label: t("device_profiles.form_factor"),
        searchValue: (profile) =>
          t(`device_profiles.form_factor.${profile.formFactor}` as StringKey),
        cell: (profile) =>
          html`<span part="profile-summary"
            >${t(`device_profiles.form_factor.${profile.formFactor}` as StringKey)}</span
          >`,
      },
      {
        key: "scope",
        label: t("device_profiles.where_serves"),
        searchValue: (profile) => this.#scopeSummary(profile),
        cell: (profile) =>
          html`<span part="profile-summary" data-test=${`profile-scope-${profile.id}`}
            >${this.#scopeSummary(profile)}</span
          >`,
      },
      {
        key: "capabilities",
        label: t("device_profiles.capabilities"),
        searchValue: (profile) => this.#capabilitySummary(profile.capabilities),
        cell: (profile) =>
          html`<span part="profile-summary" data-test=${`profile-caps-${profile.id}`}
            >${this.#capabilitySummary(profile.capabilities, true)}</span
          >`,
      },
      {
        key: "actions",
        label: t("device_profiles.row_actions"),
        pinned: "end",
        cell: (profile) =>
          html`<wt-row-actions
            align="end"
            label=${`${t("device_profiles.row_actions")}: ${profile.name}`}
          >
            <wt-button
              icon="menu-edit"
              data-test=${`edit-${profile.id}`}
              @click=${() => void this.#openEditor(profile.id)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              icon="menu-copy"
              data-test=${`duplicate-${profile.id}`}
              @click=${() => this.#duplicate(profile)}
              >${t("device_profiles.duplicate")}</wt-button
            >
            ${rowActionTail(true, [
              html`<wt-button
                icon="menu-delete"
                variant="danger"
                data-test=${`delete-${profile.id}`}
                @click=${(event: Event) => this.#openDelete(profile, event)}
                >${t("action.delete_dialog")}</wt-button
              >`,
            ])}
          </wt-row-actions>`,
      },
    ];
  }

  #renderDeleteDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("device_profiles.delete_title")}
      .open=${this.deleteTarget !== null}
      .opener=${this.#deleteOpener}
      @wt-close=${() => (this.deleteTarget = null)}
    >
      <p data-test="delete-message">${t("device_profiles.delete_message")}</p>
      <wt-button slot="footer" data-test="cancel-delete" @click=${() => (this.deleteTarget = null)}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        variant="danger"
        data-test="confirm-delete"
        @click=${() => this.#confirmDelete()}
        >${t("action.delete")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderList(): TemplateResult {
    const error = this.errorKey ?? this.listScopeError;
    return html`
      <div class="list-heading">
        <h1 class="title">${t("device_profiles.title")}</h1>
        <wt-button variant="primary" data-test="create" @click=${() => this.#openCreate()}
          >${t("device_profiles.create")}</wt-button
        >
      </div>
      <wt-data-table
        aria-label=${t("device_profiles.title")}
        searchable
        searchLabel=${t("device_profiles.search")}
        noMatchesMessage=${tableNoMatches()}
        emptyMessage=${t("device_profiles.empty")}
        viewKey="waitron.device-profiles.table"
        customiseColumnsLabel=${t("table.customise_columns")}
        customiseLabel=${t("table.customise")}
        restoreColumnsLabel=${t("table.restore_columns")}
        doneLabel=${t("table.done")}
        moveColumnLabel=${t("table.move_column")}
        showColumnLabel=${t("table.show_column")}
        hideColumnLabel=${t("table.hide_column")}
        alwaysShownColumnLabel=${t("table.column_always_shown")}
        lastShownColumnLabel=${t("table.column_last_shown")}
        columnPositionLabel=${t("table.column_position")}
        filtersLabel=${t("table.filters")}
        filteredColumnLabel=${t("table.filtered_column")}
        filtersClearAllLabel=${t("table.filters_clear_all")}
        filtersCloseLabel=${t("table.filters_close")}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.profiles}
        .columns=${this.#columns()}
        .rowKey=${(profile: DeviceProfile) => profile.id}
        .rowClick=${(profile: DeviceProfile) => void this.#openEditor(profile.id)}
        .rowClickLabel=${(profile: DeviceProfile) => `${t("action.edit")}: ${profile.name}`}
        .loading=${!this.#profilesRead}
      ></wt-data-table>
      ${this.#renderDeleteDialog()}
      ${error ? html`<p class="error" role="alert">${codeMessage(error)}</p>` : nothing}
    `;
  }

  #printerChoices(key: PrinterListKey): PrinterChoice[] {
    const listed = this.draftPrinterLists[key];
    const drawers = key === "cashDrawerPrinterIds";
    const pool: (ListablePrinter & { drawerless?: boolean })[] = [
      ...this.printers
        .filter((printer) => !drawers || printer.hasCashDrawer || listed.includes(printer.id))
        .map((printer) => ({ ...printer, drawerless: drawers && !printer.hasCashDrawer })),
      ...(key === "invoicePrinterIds" ? a4Choices(this.pagePrinters) : []),
    ];
    const label = (printer: (typeof pool)[number]) =>
      printer.drawerless
        ? `${printerLabel(printer)} (${t("device_profiles.no_drawer_attached")})`
        : printerLabel(printer);
    return equipmentInOrder(pool, this.#printerOrder(key), listed).map((printer) => ({
      printer,
      listed: listed.includes(printer.id),
      label: label(printer),
    }));
  }

  #renderPrinterLists(errors: FieldErrors): TemplateResult | typeof nothing {
    return renderDeviceProfilePrinterLists({
      loading: this.printersState === "loading",
      reading: this.printerReading.size > 0,
      readFailed:
        this.#queries.failing("listPrinters") || this.#queries.failing("listPagePrinters"),
      lists:
        this.printersState === "ready"
          ? PRINTER_LISTS.map((list) => ({
              list,
              choices: this.#printerChoices(list.key),
              listError: list.key === "cashDrawerPrinterIds" ? errors.drawerList : undefined,
              defaultError: errors[list.defaultField] ?? "",
              defaultValue: this.draftPrinterLists[list.defaultKey] ?? "",
            }))
          : [],
      onPrinterToggle: (event, list, printerId, visible) =>
        this.#onPrinterToggle(event, list, printerId, visible),
      onMovePrinter: (list, drawn, visible, printerId, by, button) =>
        void this.#movePrinter(list.key, drawn, visible, printerId, by, button),
      onPrinterDefault: (event, list) => this.#onPrinterDefault(event, list),
    });
  }

  #renderReaders(errors: FieldErrors): TemplateResult | typeof nothing {
    if (!this.#readersShown()) return nothing;
    const listed = this.draftReaders.readerIds;
    const label = (reader: ReaderRow) =>
      reader.active
        ? reader.name
        : `${reader.name} (${t(reader.canEnable ? "payments.reader_unavailable" : "payments.reader_unpaired")})`;
    return renderDeviceProfileReaders({
      choices: equipmentInOrder(this.readers, this.#loadedReaders.readerIds, listed).map(
        (reader) => ({ id: reader.id, label: label(reader), listed: listed.includes(reader.id) }),
      ),
      defaultValue: this.draftReaders.defaultReaderId ?? "",
      error: errors.readerDefault ?? "",
      onReaderToggle: (event, readerId, visible) => this.#onReaderToggle(event, readerId, visible),
      onReaderDefault: (event) => this.#onReaderDefault(event),
    });
  }

  #kindListsShown(kind: KitchenScreenKind): boolean {
    return profileKindListsShown(kind, this.draftKitchenScreens);
  }

  #kitchenLists(kind: KitchenScreenKind, errors: FieldErrors): KitchenListsProps {
    const fields = KIND_FIELDS[kind];
    return {
      kind,
      slug: KIND_SLUG[kind],
      stationsField: fields.stations,
      zonesField: fields.zones,
      scope: this.#scopeOf(kind),
      stations: this.stations.filter((station) => station.active),
      zones: this.scopeChoices.zones,
      stationsError: errors[fields.stations],
      zonesError: fields.zones === null ? undefined : errors[fields.zones],
      onEveryStation: (event) => this.#onScreenEveryStation(event, kind),
      onEveryZone: (event) => this.#onScreenEveryZone(event, kind),
      onListed: (event, key, id) => this.#onListed(event, kind, key, id),
      onShowOtherStations: (event) => this.#onShowOtherStations(event, kind),
    };
  }

  #renderKitchenScreens(errors: FieldErrors): TemplateResult {
    const selected = KITCHEN_SCREEN_KINDS.find(
      (kind) => this.draftKitchenScreens[kind] !== undefined,
    );
    return renderDeviceProfileKitchenScreens({
      selected,
      error: errors.kitchenScreens ?? "",
      lists:
        selected !== undefined && this.#kindListsShown(selected)
          ? this.#kitchenLists(selected, errors)
          : undefined,
      onKind: (event) => this.#onKitchenScreenKind(event),
    });
  }

  #renderWhere(errors: FieldErrors): TemplateResult {
    return renderDeviceProfileWhere({
      departments: this.scopeChoices.departments,
      departmentId: this.draftDepartmentId,
      zones: this.#departmentZones(this.draftDepartmentId),
      allowedZones: this.#allowedZones(),
      everyZone: this.draftEveryZone,
      zoneIds: this.draftZoneIds,
      startingZoneId: this.draftStartingZoneId,
      departmentError: errors.department,
      zonesError: errors.zones,
      startingZoneError: errors.startingZone,
      onDepartment: (event) => this.#onDepartment(event),
      onEveryZone: (event) => this.#onEveryZone(event),
      onZone: (event, zoneId) => this.#onZone(event, zoneId),
      onStartingZone: (event) => this.#onStartingZone(event),
    });
  }

  #renderWho(errors: FieldErrors): TemplateResult {
    return renderDeviceProfileWho({
      roles: this.jobRoles,
      roleIds: this.draftRoles,
      rolesRead: this.jobRolesRead,
      rolesError: errors.roles,
      onRole: (event, roleId) => this.#onRole(event, roleId),
    });
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
    return html`<div class="capability-columns">
      ${renderSwitchGroup(
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
      ${renderSwitchGroup(
        "profile-screens",
        t("device_profiles.screens"),
        undefined,
        PROFILE_SCREENS.map((flag) => this.#capabilitySwitch(flag)),
      )}
      ${kds ? nothing : this.#renderKitchenScreens(errors)}
    </div>`;
  }

  #renderStartingScreen(errors: FieldErrors): TemplateResult {
    return html`
      ${
        !this.#ordering()
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
    const ownMarked = Object.keys(this.#ownErrors()).length > 0;
    const save = this.#saveState();
    const message = this.#feedback.message(
      { request: this.errorKey === null ? undefined : codeMessage(this.errorKey) },
      new Set(FIELDS.filter((field) => errors[field])),
      t("form.fix_fields"),
    );
    return html`
      <div class="editor" data-test="editor-form" data-editing-id=${this.editingId ?? nothing}>
        <nav aria-label=${t("device_profiles.title")}>
          <a
            href="/device-profiles"
            @click=${(event: MouseEvent) => {
              if (leftToBrowser(event)) return;
              event.preventDefault();
              void this.#cancel("navigation");
            }}
            >${t("device_profiles.title")}</a
          ><span aria-hidden="true">›</span>
        </nav>
        <h1 class="title">${this.#loaded?.name ?? t("device_profiles.create")}</h1>
        <wt-tabs
          label=${t("device_profiles.title")}
          .items=${this.#editorTabs(errors)}
          .value=${this.editorTab}
          @wt-tab-change=${(event: CustomEvent<{ value: EditorTab }>) => {
            this.#changeEditorTab(event.detail.value);
          }}
        >
          <section slot="general">
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
            <wt-input
              @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]"))}
              class="field"
              decimal-locale=${currentLocale()}
              data-test="profile-inactivity"
              name="inactivityTimeout"
              label=${t("device_profiles.inactivity_timeout_label")}
              hint=${ordering ? "" : t("device_profiles.kitchen_inactivity_hint")}
              .value=${this.invalidInactivityText ?? (this.draftInactivityMinutes == null ? "" : String(this.draftInactivityMinutes))}
              .error=${errors.inactivity ?? ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onInactivity(e)}
            ></wt-input>
            ${ordering ? this.#renderStartingScreen(errors) : nothing}
          </section>
          ${
            ordering
              ? html`<section slot="where">${this.#renderWhere(errors)}</section>`
              : html`<section slot="kitchen">${this.#renderKitchenScreens(errors)}</section>`
          }
          <section slot="who">${this.#renderWho(errors)}</section>
          <section slot="capabilities">${this.#renderCapabilities(errors)}</section>
          ${
            ordering
              ? html`<section slot="equipment">
                  ${this.#renderPrinterLists(errors)} ${this.#renderReaders(errors)}
                </section>`
              : nothing
          }
        </wt-tabs>
        <wt-form-actions .error=${message}>
          <wt-button
            slot="cancel"
            variant="secondary"
            data-test="profile-cancel"
            ?disabled=${this.saving}
            @click=${() => void this.#cancel()}
            >${t("device_profiles.cancel")}</wt-button
          >
          <wt-button
            variant=${save.variant}
            data-test="profile-save"
            ?disabled=${save.unchanged || save.awaitingJobs || this.saving || ownMarked}
            @click=${() => void this.#save()}
            >${t("device_profiles.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    `;
  }

  override render(): TemplateResult {
    if (this.targetUnavailable)
      return html`<p role="alert">${t("device_profiles.setting_unavailable")}</p>
        <wt-button data-test="profile-target-cancel" @click=${() => this.#closeEditor()}
          >${t("action.cancel")}</wt-button
        >`;
    return this.mode === "editor" ? this.#renderEditor() : this.#renderList();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-device-profiles-screen": DeviceProfilesScreen;
  }
}
