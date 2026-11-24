import { encodePathSegment, type UrlPathConfig } from "@waitron/ui";

export { leftToBrowser } from "@waitron/ui";

export function setMenuAddress(id: string): string {
  return `/set-menus/menu/${encodePathSegment(id)}`;
}

export const dashboardPath: UrlPathConfig = {
  basePath: "",
  primary: "dashboard",
  children: {
    "*": { view: "view" },
    products: { product: "product", category: "category" },
    "opening-hours": {
      view: "view",
      season: "season",
      department: "department",
      zone: "zone",
      "special-day": "special-day",
      date: "date",
      year: "year",
      month: "month",
    },
    "venue-operations": { department: "department", view: "view", zone: "zone" },
    menus: { menu: "menu", view: "view", section: "section", "price-filter": "filter" },
    "set-menus": { setMenu: "menu" },
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
    invoices: {
      from: "from",
      to: "to",
      q: "q",
      rate: "rate",
      amount: "amount",
      operationFrom: "operation-from",
      operationTo: "operation-to",
      kind: "kind",
    },
    modules: { view: "view", state: "state", returnTo: "return-to" },
    printers: { view: "view", printer: "printer", editor: "editor", step: "step" },
    devices: { device: "device" },
    payments: { view: "view", reader: "reader" },
    "device-profiles": { profile: "profile", view: "view" },
    "floor-plan": { set: "set", zone: "zone" },
  },
  // A Calendar view a module adds names its own address words, which no list here can know.
  keepUnlisted: ["opening-hours"],
};
