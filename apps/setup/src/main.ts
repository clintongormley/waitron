import { html, render } from "lit";
import { applyTokens, startThemeChoice, startThemedFavicon } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture, watchBuild } from "@waitron/diagnostics";
import { diag, setReportBuild } from "./diagnostics.js";
import { makeSetupId } from "./random-id.js";
import { SetupApi } from "./api/client.js";
import "./setup-app.js";
import "./screens/handover-screen.js";
import { matchBrowserLocale } from "./i18n/match-browser-locale.js";
import { setLocale } from "./i18n/t.js";

applyTokens(document.documentElement);
startThemeChoice(document.documentElement);
startThemedFavicon();

const app = document.querySelector<HTMLElement>("#app")!;
const transport = createInstrumentedFetch(
  watchBuild(fetch, { origin: location.origin, onFirstBuild: setReportBuild, onChange() {} }),
  diag,
  { makeId: makeSetupId },
);
installErrorCapture(window, diag);
const operation = /^\/handover\/([^/]+)$/.exec(location.pathname);
if (operation) {
  setLocale(matchBrowserLocale(navigator.languages));
  render(
    html`<setup-handover-screen
      .api=${new SetupApi("", transport)}
      operationId=${decodeURIComponent(operation[1]!)}
    ></setup-handover-screen>`,
    app,
  );
} else {
  render(html`<setup-app .api=${new SetupApi("", transport)}></setup-app>`, app);
}
