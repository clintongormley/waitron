import { html, render } from "lit";
import { applyTokens, registerIcons, startThemeChoice, startVenueTheme } from "@waitron/ui";
import {
  BUILD_CHANGED_EVENT,
  createInstrumentedFetch,
  installErrorCapture,
  watchBuild,
} from "@waitron/diagnostics";
import { createRequest, LiveConnection } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { mountPublicModulePage } from "./public-module-page.js";
import { DashboardApi } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { createSessionEpoch, createSessionSignals } from "./session-signals.js";
import { DASHBOARD_ICONS } from "./icons.js";
import "./dashboard-app.js";
import "./screens/attendance-corrections-screen.js";

applyTokens(document.documentElement);
startThemeChoice(document.documentElement);
registerIcons(DASHBOARD_ICONS);
const app = document.querySelector<HTMLElement>("#app")!;
const publicLocale =
  navigator.languages
    .find((language) => /^(en|es)(-|$)/i.test(language))
    ?.split("-")[0]
    ?.toLowerCase() === "es"
    ? "es"
    : "en";
if (!mountPublicModulePage(app, location.pathname, DASHBOARD_MODULES, { locale: publicLocale })) {
  startSessionDashboard();
}

function startSessionDashboard(): void {
  const instrumentedFetch = createInstrumentedFetch(
    watchBuild(fetch, {
      origin: location.origin,
      onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
    }),
    diag,
  );
  startVenueTheme(document.documentElement, { fetchImpl: instrumentedFetch });

  installErrorCapture(window, diag);

  const epoch = createSessionEpoch();
  const sessionGeneration = epoch.current;
  const signals = createSessionSignals({ sessionGeneration });
  const api = new DashboardApi(
    "",
    instrumentedFetch,
    signals.reportError,
    signals.reportActivity,
    false,
    { sessionGeneration },
  );
  const liveUpdates = new LiveConnection(api.liveData, {
    sessionGeneration,
    onSessionInvalid: (code, generation) => signals.reportError(code, undefined, generation),
  });
  render(
    html`<dashboard-app
      .api=${api}
      .sessionEpoch=${epoch}
      .liveUpdates=${liveUpdates}
      .request=${createRequest({
        fetchImpl: instrumentedFetch,
        onError: signals.reportError,
        onSuccess: signals.reportActivity,
        sessionGeneration,
      })}
    ></dashboard-app>`,
    app,
  );
}
