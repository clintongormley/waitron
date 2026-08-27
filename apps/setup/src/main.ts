import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { SetupApi } from "./api/client.js";
import "./setup-app.js";

// The browser entry point for the setup wizard. It paints the token layer onto the document root and
// mounts <setup-app> with a real same-origin SetupApi. Excluded from coverage (see vitest.config.ts):
// this runs only in a real browser at startup.
applyTokens(document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<setup-app .api=${new SetupApi()}></setup-app>`, app);
