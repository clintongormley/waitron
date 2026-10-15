import type { LiveData } from "./live-data.js";
import type { TemplateResult } from "lit";
import type { DashboardRequest } from "./request.js";

// The contract a dashboard module UI fills to contribute its screens. A module hands the app one
// DashboardContribution; the app validates its nav groups, registers its strings, and mounts its screens.
// It names no concrete module.

/** A dashboard nav-group id; the app validates each contributed screen's group against its own
 * known ids. */
export type NavGroupId = string;

/** What a contributed screen is handed at construction. */
export interface DashboardModuleContext {
  request: DashboardRequest;
  liveData?: LiveData;
  renderPanel?: DashboardPanelRenderer;
  /** The enabled modules' Calendar views the person may read, ordered by `order`, each with whether
   * the person holds its `requiresPermission`. */
  calendarViews?: readonly { view: DashboardCalendarView; canWrite: boolean }[];
}

export type DashboardPanelRenderer = (
  panel: string,
  subject: { id: string; name: string },
) => TemplateResult | null;

/** A mounted screen instance: the app calls render() to paint it. */
export interface DashboardScreenHandle {
  render(readOnly?: boolean): TemplateResult;
}

/** Where a contributed screen sits in the nav, and the permission that opens it. */
export interface DashboardScreenPlacement {
  id: string;
  navLabelKey: string;
  group: NavGroupId;
  order?: number;
  requiresPermission: string;
  readPermission?: string;
}

/** A contributed screen: where it sits and how it is built. */
export interface DashboardFurtherScreen {
  screen: DashboardScreenPlacement;
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}

/** What the Calendar hands a module's view. */
export interface CalendarViewHost {
  /** The month the Calendar is showing, YYYY-MM. */
  month: string;
  /** The address's `<key>/<value>` pairs after `view/<id>`; a key survives the shell's rewrite only
   * when the dashboard's `navigation.ts` lists it. */
  params: Readonly<Record<string, string>>;
  canWrite: boolean;
  /** Moves the Calendar to `view/<view>/<key>/<value>…`; `"hours"` returns to Opening hours. */
  open(view: string, params: Record<string, string>): void;
}

/** The Calendar's own address view words, which no module view may take; `hours` is how a view
 * asks to return to Opening hours. */
export const CALENDAR_OWN_VIEW_IDS: readonly string[] = [
  "year",
  "month",
  "season",
  "special-day",
  "date",
  "calendar",
  "hours",
];

/** A view a module adds to the Calendar (the Opening hours screen) beside Opening hours. */
export interface DashboardCalendarView {
  /** The address's view name; unique, and none of the Calendar's own view words. */
  id: string;
  labelKey: string;
  order: number;
  requiresPermission: string;
  readPermission?: string;
  create(ctx: DashboardModuleContext, host: CalendarViewHost): DashboardScreenHandle;
}

/** A Venue settings tab key; the app validates each contributed panel's tab against its own list. */
export type SettingsTabId = string;

/** A panel a module adds to a Venue settings tab. The page owns the h1. */
export interface DashboardSettingsPanel {
  /** Unique across core and module panels. */
  id: string;
  tab: SettingsTabId;
  /** Core panels count as 0 and come first on a tie. */
  order?: number;
  requiresPermission: string;
  readPermission?: string;
  create(ctx: DashboardModuleContext): { render(readOnly?: boolean): TemplateResult };
}

/** One module's dashboard contribution: its identity, its first screen's placement and factory, any
 * further screens, and its localised strings. */
export interface DashboardContribution extends DashboardFurtherScreen {
  module: string; // == the server descriptor name
  strings: { en: Record<string, string>; es: Record<string, string> };
  /** Mounted, listed, searched and permission-gated exactly as `screen` is. */
  moreScreens?: readonly DashboardFurtherScreen[];
  settingsPanels?: readonly DashboardSettingsPanel[];
  calendarViews?: readonly DashboardCalendarView[];
}
