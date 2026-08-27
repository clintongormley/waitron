import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import "./setup-app.js";

// The browser entry point for the setup wizard. It paints the token layer onto the document root and
// mounts <setup-app>. The wizard's SetupApi is not wired yet — that arrives in Task 2; this shell
// renders a placeholder card. Excluded from coverage (see vitest.config.ts): this runs only in a
// real browser at startup.
applyTokens(document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<setup-app></setup-app>`, app);
