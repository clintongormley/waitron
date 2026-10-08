import type { UrlPathConfig } from "@waitron/ui";

export const dashboardPath: UrlPathConfig = {
  basePath: "/manage",
  primary: "dashboard",
  children: {
    "*": { view: "view" },
    catalogue: { product: "product", category: "category" },
    "prep-stations": { view: "view", test: "test" },
    hours: { view: "view", department: "department", station: "station" },
    "menu-timetable": { department: "department" },
    menus: { menu: "menu", view: "view", "price-filter": "filter" },
    modifiers: { view: "view", list: "list" },
    orders: {
      status: "status",
      from: "from",
      to: "to",
      dates: "dates",
      credited: "credited",
      staff: "staff",
      table: "table",
      q: "q",
    },
    printers: { view: "view", printer: "printer" },
    floor: { "floor-view": "view", "floor-zone": "zone" },
    "canvas-editor": { canvas: "canvas", "canvas-tab": "tab" },
  },
};

/** A held modifier key or another button keeps the browser's own handling of a link, such as
 * opening a new tab. */
export function leftToBrowser(event: MouseEvent): boolean {
  return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}
