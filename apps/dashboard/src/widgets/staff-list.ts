import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { registerIcons, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-icon.js";
import { t } from "../i18n/t.js";
import { roleName, statusName } from "../i18n/domain.js";
import type { PersonSummary } from "../api/client.js";

registerIcons({ edit: "M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L6 13l-4 1 1-4z" });

/** Presents the staff roster and emits the selected person id; the screen owns data and actions. */
@customElement("dashboard-staff-list")
export class StaffList extends LitElement {
  @property({ attribute: false }) people: PersonSummary[] = [];

  #edit(event: Event, personId: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ personId: string }>("edit-person", {
        detail: { personId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #columns(): DataTableColumn<PersonSummary>[] {
    const editLabel = t("action.edit");
    return [
      {
        key: "displayName",
        label: t("staff.field_display_name"),
        cell: (person) => person.displayName,
        sortValue: (person) => person.displayName,
      },
      {
        key: "legalName",
        label: t("staff.field_legal_name"),
        cell: (person) =>
          person.lastNames || person.firstNames
            ? [person.lastNames, person.firstNames].filter(Boolean).join(", ")
            : "—",
        sortValue: (person) => `${person.lastNames ?? ""}, ${person.firstNames ?? ""}`,
      },
      {
        key: "role",
        label: t("staff.field_role"),
        cell: (person) => roleName(person.role),
        sortValue: (person) => roleName(person.role),
      },
      {
        key: "email",
        label: t("staff.field_email"),
        cell: (person) => person.email ?? "—",
        sortValue: (person) => person.email ?? "",
      },
      {
        key: "telephone",
        label: t("staff.field_telephone"),
        cell: (person) => person.telephone ?? "—",
        sortValue: (person) => person.telephone ?? "",
      },
      {
        key: "status",
        label: t("staff.field_status"),
        cell: (person) => statusName(person.status),
        sortValue: (person) => statusName(person.status),
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        cell: (person) => html`
          <wt-button
            variant="ghost"
            data-test="edit-${person.personId}"
            aria-label=${`${editLabel} ${person.displayName}`}
            @click=${(event: Event) => this.#edit(event, person.personId)}
          >
            <wt-icon name="edit"></wt-icon>
          </wt-button>
        `,
      },
    ];
  }

  override render() {
    return html`
      <wt-data-table
        aria-label=${t("staff.title")}
        .rows=${this.people}
        .columns=${this.#columns()}
        .rowKey=${(person: PersonSummary) => person.personId}
        .emptyMessage=${t("staff.empty")}
      ></wt-data-table>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-list": StaffList;
  }
}
