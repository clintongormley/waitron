import { css, html } from "lit";
import { formatMoney } from "@waitron/shared";
import type { DepartmentTakingsDto } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";

export function renderDepartmentTakings(rows: DepartmentTakingsDto[]) {
  const money = (value: string) => formatMoney(value, currentLocale());
  return html` <h2>${t("reports.by_department")}</h2>
    <p class="muted" data-test="department-note">${t("reports.department_note")}</p>
    <div
      class="department-takings"
      role="region"
      aria-label=${t("reports.by_department")}
      tabindex="0"
    >
      <table data-test="department-table">
        <thead>
          <tr>
            <th scope="col">${t("reports.department")}</th>
            <th scope="col" class="num">${t("reports.cash")}</th>
            <th scope="col" class="num">${t("reports.card")}</th>
            <th scope="col" class="num">${t("sales.to_be_paid_by_transfer")}</th>
            <th scope="col" class="num">${t("sales.bills_closed")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const amount = (method: string) =>
              money(row.byMethod.find((line) => line.method === method)?.amount ?? "0.00");
            return html`<tr data-test=${`department-row-${row.departmentId ?? "unallocated"}`}>
              <th scope="row">
                ${row.departmentName ?? t("reports.unallocated")}${row.active === false ? html` · ${t("reports.inactive")}` : ""}
              </th>
              <td class="num">${amount("cash")}</td>
              <td class="num">${amount("card")}</td>
              <td class="num">${amount("transfer")}</td>
              <td class="num">${row.billsClosed.count} · ${money(row.billsClosed.total)}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

export const departmentTakingsStyles = css`
  .department-takings {
    overflow-x: auto;
    max-width: 100%;
  }
  .department-takings .num {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
`;
