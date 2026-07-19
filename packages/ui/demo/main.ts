import { applyTokens, registerIcons } from "../src/index.js";
import "../src/components/wt-button.js";
import "../src/components/wt-card.js";
import "../src/components/wt-dialog.js";
import "../src/components/wt-icon.js";
import "../src/components/wt-input.js";
import "../src/components/wt-switch.js";

registerIcons({
  check: "M2 8 L6 12 L14 4",
  cart: "M1 2 h3 l2 8 h7 l2 -6 H5",
});

const panel = (theme: "light" | "dark") => `
  <div class="panel" data-theme="${theme}">
    <h2>${theme}</h2>
    <div class="row">
      <wt-button variant="primary">Cobrar</wt-button>
      <wt-button variant="secondary">Cancelar</wt-button>
      <wt-button variant="danger">Anular</wt-button>
      <wt-button variant="ghost"><wt-icon name="cart"></wt-icon> Cesta</wt-button>
    </div>
    <div class="row">
      <wt-button size="sm">sm</wt-button>
      <wt-button size="md">md</wt-button>
      <wt-button size="lg">lg</wt-button>
    </div>
    <wt-card raised>
      <span slot="header">Ticket</span>
      <wt-input label="Peso (kg)" value="1.25"></wt-input>
      <div class="row" style="margin-top:16px">
        <wt-switch label="Modo formación"></wt-switch>
        <wt-switch label="Activado" checked></wt-switch>
      </div>
    </wt-card>
    <div class="row" style="margin-top:16px">
      <wt-button class="open-dialog">Abrir diálogo</wt-button>
    </div>
    <wt-dialog heading="Anular venta">
      Esto generará un registro rectificativo.
      <wt-button slot="footer" variant="danger">Anular</wt-button>
    </wt-dialog>
  </div>
`;

const app = document.querySelector("#app")!;
app.innerHTML = `<div class="panels">${panel("light")}${panel("dark")}</div>`;

for (const el of app.querySelectorAll<HTMLElement>(".panel")) {
  applyTokens(el);
}

for (const trigger of app.querySelectorAll<HTMLElement>(".open-dialog")) {
  trigger.addEventListener("click", () => {
    const dialog = trigger.closest(".panel")!.querySelector("wt-dialog") as HTMLElement & {
      open: boolean;
    };
    dialog.open = true;
  });
}
