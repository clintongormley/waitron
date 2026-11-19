import { formatMoney } from "@waitron/shared";
import { css, html, nothing } from "lit";
import { currentLocale, t } from "../i18n/t.js";

export function setMenuPrice(price: string, zero: "set_menu.included" | "set_menu.tag"): string {
  return Number(price) === 0 ? t(zero) : `+${formatMoney(price, currentLocale())}`;
}

export function setMenuCourseName(
  courseIds: readonly string[],
  courseNames: Readonly<Record<string, string>>,
): string {
  return new Intl.ListFormat(currentLocale(), { type: "disjunction" }).format(
    courseIds.map((id) => courseNames[id] ?? t("table.course_none")),
  );
}

export const setMenuTagStyles = css`
  .set-menu-tag {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    white-space: nowrap;
  }
`;

export function setMenuTag(price: string | undefined) {
  return price === undefined
    ? nothing
    : html` <span class="set-menu-tag">${setMenuPrice(price, "set_menu.tag")}</span>`;
}
