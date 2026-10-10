import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { currentLocale, t } from "../i18n/t.js";
import { roleName, statusName } from "../i18n/domain.js";
import type { PersonSummary } from "../api/client.js";

const personKey = (person: PersonSummary): string => person.personId;

@customElement("dashboard-staff-list")
export class StaffList extends LitElement {
  @property({ attribute: false }) people: PersonSummary[] = [];

  @property({ attribute: false }) currentPersonId: string | null = null;
  @property() searchTerm = "";
  /** What the table says with no rows; the screen filters by role and status before the table, so
   * it names its own. */
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

  #columnsMemo?: { inputs: readonly unknown[]; columns: DataTableColumn<PersonSummary>[] };

  /** The same array while the language and signed-in person are unchanged, so a typed search does
   * not make the table fold every row again. The table redraws its cells only when one of its own
   * properties changes, so `currentPersonId`, which a cell reads, has to be one of the inputs. */
  #columns(): DataTableColumn<PersonSummary>[] {
    const inputs = [currentLocale(), this.currentPersonId];
    if (this.#columnsMemo?.inputs.every((input, index) => input === inputs[index]))
      return this.#columnsMemo.columns;
    const columns: DataTableColumn<PersonSummary>[] = [
      {
        key: "displayName",
        label: t("staff.field_display_name"),
        cell: (person) => person.displayName,
        sortValue: (person) => person.displayName,
        searchValue: (person) =>
          [person.displayName, person.firstNames, person.lastNames].filter(Boolean).join(" "),
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
        searchValue: (person) => person.email ?? "",
      },
      {
        key: "telephone",
        choosable: "shown",
        label: t("staff.field_telephone"),
        cell: (person) => person.telephone ?? "—",
        sortValue: (person) => person.telephone ?? "",
        searchValue: (person) => person.telephone ?? "",
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
                ? this.#action(person, "reactivate", t("person.enable_and_invite"))
                : this.#action(person, "disable", t("person.disable"))
            }
            ${person.status === "pending" ? this.#action(person, "resend-invitation", t("person.resend_invitation")) : nothing}
          </wt-row-actions>
        `,
      },
    ];
    this.#columnsMemo = { inputs, columns };
    return columns;
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
        alwaysShownColumnLabel=${t("table.column_always_shown")}
        lastShownColumnLabel=${t("table.column_last_shown")}
        columnPositionLabel=${t("table.column_position")}
        .rows=${this.people}
        .searchTerm=${this.searchTerm}
        .columns=${this.#columns()}
        .rowKey=${personKey}
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
