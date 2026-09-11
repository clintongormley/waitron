import { html } from "lit";
import { applyTokens, registerIcons, type WtDataTable } from "../src/index.js";
import "../src/components/wt-button.js";
import "../src/components/wt-card.js";
import "../src/components/wt-dialog.js";
import "../src/components/wt-modal.js";
import "../src/components/wt-form-actions.js";
import "../src/components/wt-form-error-summary.js";
import "../src/components/wt-data-table.js";
import "../src/components/wt-icon.js";
import "../src/components/wt-input.js";
import "../src/components/wt-spinner.js";
import "../src/components/wt-switch.js";
import "../src/components/wt-tabs.js";
import "../src/components/wt-row-actions.js";

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
    <div class="row">
      <wt-button loading>Buscando…</wt-button>
      <wt-spinner size="sm" label="Cargando"></wt-spinner>
      <wt-spinner label="Cargando"></wt-spinner>
      <wt-spinner size="lg" label="Cargando"></wt-spinner>
    </div>
    <wt-card raised>
      <span slot="header">Ticket</span>
      <wt-input label="Peso (kg)" value="1.25"></wt-input>
      <div class="row" style="margin-top:16px">
        <wt-switch label="Modo formación"></wt-switch>
        <wt-switch label="Activado" checked></wt-switch>
      </div>
    </wt-card>
    <wt-tabs label="Venue settings">
      <section slot="status"><p>Choose Team to manage your staff in a table.</p></section>
      <section slot="team">
        <div class="row">
          <h3>Team</h3>
          <wt-row-actions label="Team actions">
            <wt-button class="create-member">Create team member</wt-button>
          </wt-row-actions>
        </div>
        <wt-data-table class="demo-table" aria-label="Team"></wt-data-table>
      </section>
    </wt-tabs>
    <div class="row" style="margin-top:16px">
      <wt-button class="open-dialog">Abrir diálogo</wt-button>
      <wt-button class="open-modal">Open form modal</wt-button>
    </div>
    <wt-dialog heading="Anular venta">
      Esto generará un registro rectificativo.
      <wt-button slot="footer" variant="danger">Anular</wt-button>
    </wt-dialog>
    <wt-modal heading="Add printer">
      <wt-input name="printer-name" label="Printer name" value="Kitchen"></wt-input>
      <p>Connect a printer to send orders to your kitchen or print receipts.</p>
      <details>
        <summary>Preview a long form</summary>
        ${Array.from({ length: 16 }, (_, i) => `<p>Additional printer setting ${i + 1}</p>`).join("")}
      </details>
      <wt-form-actions slot="footer">
        <wt-button slot="cancel" variant="secondary" class="close-modal">Cancel</wt-button>
        <wt-button variant="primary" class="close-modal">Save</wt-button>
      </wt-form-actions>
    </wt-modal>
    <wt-modal class="member-modal" heading="Create team member">
      <wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>
      <wt-input name="member-name" label="Name" required autocomplete="name"></wt-input>
      <wt-form-actions slot="footer">
        <wt-button slot="cancel" variant="secondary" class="cancel-member">Cancel</wt-button>
        <wt-button variant="primary" class="save-member">Save</wt-button>
      </wt-form-actions>
    </wt-modal>
  </div>
`;

const app = document.querySelector("#app")!;
app.innerHTML = `<div class="panels">${panel("light")}${panel("dark")}</div>`;

for (const el of app.querySelectorAll<HTMLElement>(".panel")) {
  applyTokens(el);
  const tabs = el.querySelector("wt-tabs")!;
  tabs.items = [
    { key: "status", label: "Status" },
    { key: "team", label: "Team" },
  ];
  tabs.value = "team";
  const table = el.querySelector<WtDataTable<{ name: string; role: string }>>("wt-data-table")!;
  const memberModal = el.querySelector<HTMLElementTagNameMap["wt-modal"]>(".member-modal")!;
  const nameInput = memberModal.querySelector("wt-input")!;
  const memberErrors = memberModal.querySelector("wt-form-error-summary")!;
  let editing: { name: string; role: string } | undefined;
  const openMember = (row?: { name: string; role: string }) => {
    editing = row;
    memberModal.heading = row ? "Edit team member" : "Create team member";
    nameInput.value = row?.name ?? "";
    nameInput.error = "";
    memberErrors.errors = [];
    memberModal.open = true;
  };
  el.querySelector(".create-member")!.addEventListener("click", () => openMember());
  memberModal.querySelector(".cancel-member")!.addEventListener("click", () => {
    memberModal.open = false;
  });
  memberModal.querySelector(".save-member")!.addEventListener("click", () => {
    if (!nameInput.value.trim()) {
      nameInput.error = "Enter a name.";
      memberErrors.errors = [nameInput.error];
      return;
    }
    const member = { name: nameInput.value.trim(), role: editing?.role ?? "Staff" };
    table.rows = editing
      ? table.rows.map((row) => (row === editing ? member : row))
      : [...table.rows, member];
    memberModal.open = false;
  });
  table.rows = [
    { name: "Ada", role: "Manager" },
    { name: "Bea", role: "Staff" },
  ];
  table.columns = [
    { key: "name", label: "Name", cell: (row: { name: string }) => row.name },
    { key: "role", label: "Role", cell: (row: { role: string }) => row.role },
    {
      key: "actions",
      label: "Actions",
      align: "end",
      cell: (row: { name: string; role: string }) => html`
        <wt-row-actions label=${`Actions for ${row.name}`}>
          <wt-button @click=${() => openMember(row)}>Edit</wt-button>
          <wt-button
            variant="danger"
            @click=${() => {
              table.rows = table.rows.filter((member) => member !== row);
            }}
            >Delete</wt-button
          >
        </wt-row-actions>
      `,
    },
  ];
}

for (const trigger of app.querySelectorAll<HTMLElement>(".open-dialog")) {
  trigger.addEventListener("click", () => {
    const dialog = trigger.closest(".panel")!.querySelector("wt-dialog") as HTMLElement & {
      open: boolean;
    };
    dialog.open = true;
  });
}

for (const panel of app.querySelectorAll(".panel")) {
  const modal = panel.querySelector("wt-modal")!;
  panel.querySelector(".open-modal")!.addEventListener("click", () => {
    modal.open = true;
  });
  for (const button of modal.querySelectorAll(".close-modal")) {
    button.addEventListener("click", () => {
      modal.open = false;
    });
  }
}
