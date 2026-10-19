import type { LiveData } from "./live-data.js";
import type { TemplateResult } from "lit";
import type { DashboardRequest } from "./request.js";

// The contract a dashboard module UI fills to contribute to the dashboard. A module hands the app
// one DashboardContribution; the app validates its nav groups, registers its strings, and mounts
// what it contributes. It names no concrete module.

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
  calendarViews?: readonly CalendarViewEntry[];
}

export type DashboardPanelRenderer = (
  panel: string,
  subject: { id: string; name: string },
) => TemplateResult | null;

/** A mounted screen instance: the app calls render() to paint it. */
export interface DashboardScreenHandle {
  render(readOnly?: boolean): TemplateResult;
  /** Scopes this navigation may release; undefined protects every scope. */
  navigationScopes?(destination: URL): readonly object[] | undefined;
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
  /** The address's `<key>/<value>` pairs after `view/<id>`. */
  params: Readonly<Record<string, string>>;
  canWrite: boolean;
  /** Moves the Calendar to `view/<view>/<key>/<value>…`; `"hours"` returns to Opening hours. */
  open(view: string, params: Record<string, string>): void;
}

/** The Calendar's own address view words, which no module view may take; `hours` is how a view
 * asks to return to Opening hours, and `week` is the Week's. */
export const CALENDAR_OWN_VIEW_IDS: readonly string[] = [
  "year",
  "month",
  "season",
  "special-day",
  "date",
  "calendar",
  "hours",
  "week",
];

/** A static destination inside a page. Its parent must be readable as well as any child gate. */
export interface DashboardSearchDestination {
  id: string;
  screen: string;
  labelKey: string;
  path: string;
  requiresPermission?: string;
  readPermission?: string;
}

/** A view a module adds to the Calendar (the Opening hours screen) beside Opening hours. */
export interface DashboardCalendarView {
  searchDestinations?: readonly {
    id: string;
    labelKey: string;
    params: Readonly<Record<string, string>>;
  }[];
  /** The address's view name; unique, and none of the Calendar's own view words. */
  id: string;
  labelKey: string;
  order: number;
  requiresPermission: string;
  readPermission?: string;
  create(ctx: DashboardModuleContext, host: CalendarViewHost): DashboardScreenHandle;
}

/** A Calendar view as the app hands it on: the view, and whether the person may change it. */
export interface CalendarViewEntry {
  view: DashboardCalendarView;
  canWrite: boolean;
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

interface DashboardContributionBase {
  module: string; // == the server descriptor name
  strings: { en: Record<string, string>; es: Record<string, string> };
  /** Mounted, listed, searched and permission-gated exactly as `screen` is. */
  moreScreens?: readonly DashboardFurtherScreen[];
  settingsPanels?: readonly DashboardSettingsPanel[];
  calendarViews?: readonly DashboardCalendarView[];
  searchDestinations?: readonly DashboardSearchDestination[];
}

/** One module's dashboard contribution. */
export type DashboardContribution = DashboardContributionBase &
  (DashboardFurtherScreen | { screen?: undefined; create?: undefined });

/** The contribution's own screen, if it brings one, then its further screens. */
export function contributedScreens(c: DashboardContribution): readonly DashboardFurtherScreen[] {
  const own: DashboardFurtherScreen[] = c.screen === undefined ? [] : [c];
  return [...own, ...(c.moreScreens ?? [])];
}
