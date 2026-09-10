import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { diag } from "./diagnostics.js";
import "./dashboard-app.js";

// The browser entry point for the management dashboard. It paints the token layer onto the document
// root and mounts <dashboard-app> against a real, same-origin DashboardApi. The shell consumes that
// api on boot — firstUpdated → #probeSession → api.getMe() (WHOAMI) — to decide whether to open on a
// logged-in face (the business overview for a manager/supervisor/admin, self-service my-schedule for
// staff) or the login screen. Excluded from coverage (see vitest.config.ts): this runs only in a real
// browser at startup.
applyTokens(document.documentElement);

// Crash capture + an instrumented fetch feed the one per-session diagnostics trail: window errors and
// every API round trip land in `diag`, shared with <dashboard-app>'s nav logging via ./diagnostics.js.
installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;
// Build the api and the module-request primitive from the SAME instrumented fetch, so a module screen's
// round trips land in the one per-session diagnostics trail exactly as the app client's do.
const instrumentedFetch = createInstrumentedFetch(fetch, diag);
const reportSessionError = (code: string): void => {
  if (
    code === "management_session.expired" ||
    code === "management_session.required" ||
    code === "person.suspended"
  ) {
    window.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
  }
};
const reportSessionActivity = (): void => {
  window.dispatchEvent(new Event("waitron-session-active"));
};
render(
  html`<dashboard-app
    .api=${new DashboardApi("", instrumentedFetch, reportSessionError, reportSessionActivity)}
    .request=${createRequest({
      fetchImpl: instrumentedFetch,
      onError: reportSessionError,
      onSuccess: reportSessionActivity,
    })}
  ></dashboard-app>`,
  app,
);
