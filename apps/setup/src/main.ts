import { html, render } from "lit";
import { applyTokens, startThemeChoice, startThemedFavicon } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture, watchBuild } from "@waitron/diagnostics";
import { diag, setReportBuild } from "./diagnostics.js";
import { makeSetupId } from "./random-id.js";
import { SetupApi } from "./api/client.js";
import "./setup-app.js";

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
render(html`<setup-app .api=${new SetupApi("", transport)}></setup-app>`, app);
