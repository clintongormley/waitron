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
import "../src/components/wt-combobox.js";

registerIcons({
  check: "M2 8 L6 12 L14 4",
  cart: "M1 2 h3 l2 8 h7 l2 -6 H5",
  // The same centred cross apps/dashboard/src/icons.ts registers for the round add button.
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
  // wt-row-actions requires its consuming app to register this — an unregistered name renders
  // nothing, leaving its trigger a blank button (apps/dashboard/src/icons.ts registers the same
  // path for the real app).
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  "chevron-down": "M3 6 L8 11 L13 6",
});

const panel = (theme: "light" | "dark") => `
  <div class="panel" data-theme="${theme}">
    <h2>${theme}</h2>
    <div class="row">
      <wt-button variant="primary">Cobrar</wt-button>
      <wt-button variant="secondary">Cancelar</wt-button>
      <wt-button variant="danger">Anular</wt-button>
      <wt-button variant="ghost"><wt-icon name="cart"></wt-icon> Cesta</wt-button>
      <wt-button shape="round" variant="primary" aria-label="Añadir"
        ><wt-icon name="plus"></wt-icon
      ></wt-button>
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
      <div class="row" style="margin-top:16px">
        <wt-combobox
          label="Favourite tag"
          placeholder="Choose a tag"
          class="demo-combobox"
          allow-add
        ></wt-combobox>
        <wt-combobox
          label="Dietary tags"
          placeholder="Choose tags"
          class="demo-multi-combobox"
          multiple
          allow-add
        ></wt-combobox>
      </div>
    </wt-card>
    <wt-tabs label="Venue settings">
      <section slot="status"><p>Choose Team to manage your staff in a table.</p></section>
      <section slot="team">
        <div class="row">
          <h3>Team</h3>
          <wt-row-actions label="Team actions">
            <wt-button align="start" class="create-member">Create team member</wt-button>
          </wt-row-actions>
        </div>
        <wt-data-table class="demo-table" aria-label="Team"></wt-data-table>
      </section>
      <section slot="catalogue">
        <h3>Catalogue</h3>
        <wt-data-table class="demo-search-table" aria-label="Catalogue" searchable></wt-data-table>
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
    { key: "catalogue", label: "Catalogue" },
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
          <wt-button align="start" @click=${() => openMember(row)}>Edit</wt-button>
          <wt-button
            align="start"
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

  // A second, independent wt-data-table exercising the toolbar: search, a column filter, a
  // chosen starting sort, and a remembered view. viewKey is per-theme so the light and dark
  // panels (both mounted on this page) don't share one session-storage entry.
  const searchTable =
    el.querySelector<WtDataTable<{ name: string; category: string; price: number }>>(
      ".demo-search-table",
    )!;
  searchTable.searchLabel = "Search catalogue";
  searchTable.viewKey = `demo-catalogue-view-${el.dataset.theme}`;
  searchTable.sortKey = "name";
  searchTable.sortDirection = "ascending";
  searchTable.rows = [
    { name: "Espresso", category: "Drinks", price: 1.8 },
    { name: "Cortado", category: "Drinks", price: 2.0 },
    { name: "Croissant", category: "Bakery", price: 2.2 },
    { name: "Ensaimada", category: "Bakery", price: 2.6 },
    { name: "Tortilla", category: "Food", price: 4.5 },
  ];
  searchTable.columns = [
    {
      key: "name",
      label: "Name",
      cell: (row) => row.name,
      sortValue: (row) => row.name,
      searchValue: (row) => row.name,
    },
    {
      key: "category",
      label: "Category",
      cell: (row) => row.category,
      sortValue: (row) => row.category,
      filter: {
        label: "Category",
        allLabel: "All categories",
        value: (row) => row.category,
        options: [
          { value: "Drinks", label: "Drinks" },
          { value: "Bakery", label: "Bakery" },
          { value: "Food", label: "Food" },
        ],
      },
    },
    {
      key: "price",
      label: "Price",
      align: "end",
      cell: (row) => `€${row.price.toFixed(2)}`,
      sortValue: (row) => row.price,
    },
  ];

  const DEMO_TAGS = [
    { value: "dairy-free", label: "Dairy-free" },
    { value: "gluten-free", label: "Gluten-free" },
    { value: "halal", label: "Halal" },
    { value: "kosher", label: "Kosher" },
    { value: "nut-free", label: "Nut-free" },
    { value: "vegan", label: "Vegan" },
    { value: "vegetarian", label: "Vegetarian" },
  ];
  const single = el.querySelector<HTMLElementTagNameMap["wt-combobox"]>(".demo-combobox")!;
  single.options = DEMO_TAGS;
  // A property, not a `search-placeholder` attribute: only `allowAdd` declares a kebab-case
  // attribute name, so lit would look for `searchplaceholder` and silently keep the default.
  single.searchPlaceholder = "Search or add new";
  single.addEventListener("wt-combobox-add", ((e: CustomEvent<{ text: string }>) => {
    const option = { value: e.detail.text.toLowerCase(), label: e.detail.text };
    single.options = [...single.options, option];
    single.value = option.value;
  }) as EventListener);

  const multi = el.querySelector<HTMLElementTagNameMap["wt-combobox"]>(".demo-multi-combobox")!;
  multi.options = DEMO_TAGS;
  multi.searchPlaceholder = "Search or add new";
  multi.addEventListener("wt-combobox-add", ((e: CustomEvent<{ text: string }>) => {
    const option = { value: e.detail.text.toLowerCase(), label: e.detail.text };
    multi.options = [...multi.options, option];
    multi.values = [...multi.values, option.value];
  }) as EventListener);
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
