import { html, render } from "lit";
import { applyTokens, registerIcons } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { createRequest, LiveConnection } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { DASHBOARD_ICONS } from "./icons.js";
import "./dashboard-app.js";

applyTokens(document.documentElement);
registerIcons(DASHBOARD_ICONS);

installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;
// One instrumented fetch for both the api and the module-request primitive, so a module screen's
// round trips land in the same diagnostics trail as the app client's.
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
const api = new DashboardApi("", instrumentedFetch, reportSessionError, reportSessionActivity);
const liveUpdates = new LiveConnection(api.liveData, { onSessionInvalid: reportSessionError });
render(
  html`<dashboard-app
    .api=${api}
    .liveUpdates=${liveUpdates}
    .request=${createRequest({
      fetchImpl: instrumentedFetch,
      onError: reportSessionError,
      onSuccess: reportSessionActivity,
    })}
  ></dashboard-app>`,
  app,
);
