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
}

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
}
