import type { LiveData } from "./live-data.js";
import type { TemplateResult } from "lit";
import type { DashboardRequest } from "./request.js";

// The contract a dashboard module UI fills to contribute a screen. A module hands the app one
// DashboardContribution; the app validates its nav group, registers its strings, and mounts its screen.
// It names no concrete module.

/** A dashboard nav-group id; the app validates a contribution's group against its own known ids. */
export type NavGroupId = string;

/** What a contributed screen is handed at construction — the API request primitive, so far. */
export interface DashboardModuleContext {
  request: DashboardRequest;
  liveData?: LiveData;
}

/** A mounted screen instance: the app calls render() to paint it. */
export interface DashboardScreenHandle {
  render(): TemplateResult;
}

/** One module's dashboard contribution: its identity, the screen's nav placement + permission, its
 * localised strings, and a factory the app calls with the module context. */
export interface DashboardContribution {
  module: string; // == the server descriptor name
  screen: {
    id: string;
    navLabelKey: string;
    group: NavGroupId;
    order?: number;
    requiresPermission: string;
  };
  strings: { en: Record<string, string>; es: Record<string, string> };
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}
