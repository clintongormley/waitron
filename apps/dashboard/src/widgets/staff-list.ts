import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t } from "../i18n/t.js";
import { roleName, statusName } from "../i18n/domain.js";
import type { PersonSummary } from "../api/client.js";

@customElement("dashboard-staff-list")
export class StaffList extends LitElement {
  @property({ attribute: false }) people: PersonSummary[] = [];

  @property({ attribute: false }) currentPersonId: string | null = null;
  /** What the table says with no rows; the screen filters before the table, so it names its own. */
  @property() emptyMessage?: string;

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
    return [
      {
        key: "displayName",
        label: t("staff.field_display_name"),
        cell: (person) => person.displayName,
        sortValue: (person) => person.displayName,
      },
      {
        key: "legalName",
        choosable: "shown",
        label: t("staff.field_legal_name"),
        cell: (person) =>
          person.lastNames || person.firstNames
            ? [person.lastNames, person.firstNames].filter(Boolean).join(", ")
            : "—",
        sortValue: (person) => `${person.lastNames ?? ""}, ${person.firstNames ?? ""}`,
      },
      {
        key: "role",
        choosable: "shown",
        label: t("staff.field_role"),
        cell: (person) => roleName(person.role),
        sortValue: (person) => roleName(person.role),
      },
      {
        key: "email",
        choosable: "shown",
        label: t("staff.field_email"),
        cell: (person) => person.email ?? "—",
        sortValue: (person) => person.email ?? "",
      },
      {
        key: "telephone",
        choosable: "shown",
        label: t("staff.field_telephone"),
        cell: (person) => person.telephone ?? "—",
        sortValue: (person) => person.telephone ?? "",
      },
      {
        key: "status",
        choosable: "shown",
        label: t("staff.field_status"),
        cell: (person) => statusName(person.status),
        sortValue: (person) => statusName(person.status),
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        pinned: "end",
        cell: (person) => html`
          <wt-row-actions label=${`${t("staff.actions")}: ${person.displayName}`}>
            <wt-button
              variant="ghost"
              align="start"
              data-test="edit-${person.personId}"
              @click=${(event: Event) => this.#edit(event, person.personId)}
              >${t("action.edit")}</wt-button
            >
            ${this.#action(person, "reset-login", t("person.reset_login"))}
            ${this.#action(person, "reset-pin", t("person.reset_pin"))}
            ${
              person.status === "suspended"
                ? this.#action(person, "reactivate", t("person.reactivate_and_invite"))
                : this.#action(person, "disable", t("person.mark_inactive"))
            }
            ${person.status === "pending" ? this.#action(person, "resend-invitation", t("person.resend_invitation")) : nothing}
          </wt-row-actions>
        `,
      },
    ];
  }

  #action(person: PersonSummary, action: string, label: string) {
    return html`<wt-button
      variant="ghost"
      align="start"
      data-test=${`${action}-${person.personId}`}
      ?disabled=${action === "disable" && person.personId === this.currentPersonId}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("person-action", {
            detail: { personId: person.personId, action },
            bubbles: true,
            composed: true,
          }),
        );
      }}
      >${label}</wt-button
    >`;
  }

  override render() {
    return html`
      <wt-data-table
        noMatchesMessage=${tableNoMatches()}
        aria-label=${t("staff.title")}
        viewKey="waitron.staff.table"
        customiseColumnsLabel=${t("table.customise_columns")}
        customiseLabel=${t("table.customise")}
        restoreColumnsLabel=${t("table.restore_columns")}
        doneLabel=${t("table.done")}
        moveColumnLabel=${t("table.move_column")}
        showColumnLabel=${t("table.show_column")}
        hideColumnLabel=${t("table.hide_column")}
        columnPositionLabel=${t("table.column_position")}
        .rows=${this.people}
        .columns=${this.#columns()}
        .rowKey=${(person: PersonSummary) => person.personId}
        .emptyMessage=${this.emptyMessage ?? t("staff.empty")}
        ><slot name="empty-action" slot="empty-action"></slot
      ></wt-data-table>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-list": StaffList;
  }
}
