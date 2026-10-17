import { html, render } from "lit";
import { applyTokens, registerIcons, startThemeChoice } from "@waitron/ui";
import {
  BUILD_CHANGED_EVENT,
  createInstrumentedFetch,
  installErrorCapture,
  watchBuild,
} from "@waitron/diagnostics";
import { createRequest, LiveConnection } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { createSessionSignals } from "./session-signals.js";
import { DASHBOARD_ICONS } from "./icons.js";
import "./dashboard-app.js";
import "./screens/attendance-corrections-screen.js";

applyTokens(document.documentElement);
startThemeChoice(document.documentElement);
registerIcons(DASHBOARD_ICONS);

installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;
// One instrumented fetch for both the api and the module-request primitive, so a module screen's
// round trips land in the same diagnostics trail as the app client's.
const instrumentedFetch = createInstrumentedFetch(
  watchBuild(fetch, {
    origin: location.origin,
    onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
  }),
  diag,
);
const signals = createSessionSignals();
const api = new DashboardApi("", instrumentedFetch, signals.reportError, signals.reportActivity);
const liveUpdates = new LiveConnection(api.liveData, { onSessionInvalid: signals.reportError });
render(
  html`<dashboard-app
    .api=${api}
    .liveUpdates=${liveUpdates}
    .request=${createRequest({
      fetchImpl: instrumentedFetch,
      onError: signals.reportError,
      onSuccess: signals.reportActivity,
    })}
  ></dashboard-app>`,
  app,
);
