import { html, render } from "lit";
import { applyTokens, registerIcons } from "@waitron/ui";

// The browser entry point for the Counter POS till. The real <till-app> element arrives in
// Task 19; this placeholder exists now so the browser toolchain — Vite dev server, the token
// layer and the icon registry — is wired and de-risked for Tasks 9-19. It is excluded from
// coverage (see vitest.config.ts) because it runs only in a real browser at startup.
applyTokens(document.documentElement);

// A handful of placeholder icons the till will use. Registered here so the registry is
// populated before any component that renders an <wt-icon> mounts.
registerIcons({
  cart: "M1 2 h3 l2 8 h7 l2 -6 H5",
  check: "M2 8 L6 12 L14 4",
});

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<p>Waitron Till — the till UI arrives in Task 19.</p>`, app);
