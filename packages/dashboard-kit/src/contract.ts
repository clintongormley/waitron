import type { LiveData } from "./live-data.js";
import type { TemplateResult } from "lit";
import type { DashboardRequest } from "./request.js";

// The contract a dashboard module UI fills to contribute a screen. A module hands the app one
// DashboardContribution; the app validates its nav groups, registers its strings, and mounts its screens.
// It names no concrete module.

/** A dashboard nav-group id; the app validates a contribution's group against its own known ids. */
export type NavGroupId = string;

/** What a contributed screen is handed at construction. */
export interface DashboardModuleContext {
  request: DashboardRequest;
  liveData?: LiveData;
}

/** A mounted screen instance: the app calls render() to paint it. */
export interface DashboardScreenHandle {
  render(): TemplateResult;
}

/** Where a contributed screen sits in the nav, and the permission that opens it. */
export interface DashboardScreenPlacement {
  id: string;
  navLabelKey: string;
  group: NavGroupId;
  order?: number;
  requiresPermission: string;
}

/** A screen a module contributes beside its primary one. */
export interface DashboardFurtherScreen {
  screen: DashboardScreenPlacement;
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}

/** One module's dashboard contribution: its identity, the screen's nav placement + permission, its
 * localised strings, and a factory the app calls with the module context. */
export interface DashboardContribution {
  module: string; // == the server descriptor name
  screen: DashboardScreenPlacement;
  strings: { en: Record<string, string>; es: Record<string, string> };
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
  /** Mounted, listed, searched and permission-gated exactly as `screen` is. */
  moreScreens?: readonly DashboardFurtherScreen[];
}
