import { html, render } from "lit";
import { applyTokens, startThemeChoice, startThemedFavicon } from "@waitron/ui";
import { SetupApi } from "./api/client.js";
import "./setup-app.js";

applyTokens(document.documentElement);
startThemeChoice(document.documentElement);
startThemedFavicon();

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<setup-app .api=${new SetupApi()}></setup-app>`, app);
