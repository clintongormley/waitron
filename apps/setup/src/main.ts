import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { SetupApi } from "./api/client.js";
import "./setup-app.js";

applyTokens(document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<setup-app .api=${new SetupApi()}></setup-app>`, app);
