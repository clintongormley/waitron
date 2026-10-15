import type { CalendarViewEntry, DashboardSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { NavSearchDestination } from "./nav-search.js";

const coreDestinations: readonly DashboardSearchDestination[] = [
  ...[
    ["extras", "extras.title"],
    ["options", "options.title"],
  ].map(([view, labelKey]) => ({
    id: `modifiers:${view}`,
    screen: "modifiers",
    labelKey: labelKey!,
    path: `/manage/modifiers/view/${view}`,
  })),
  ...[
    ["queue", "printers.jobs_title"],
    ["printers", "printers.list_title"],
    ["agents", "printers.agents_tab"],
  ].map(([view, labelKey]) => ({
    id: `printers:${view}`,
    screen: "printers",
    labelKey: labelKey!,
    path: `/manage/printers/view/${view}`,
  })),
  ...[
    ["providers", "payments.providers_heading"],
    ["readers", "payments.readers_heading"],
  ].map(([view, labelKey]) => ({
    id: `payments:${view}`,
    screen: "payments",
    labelKey: labelKey!,
    path: `/manage/payments/view/${view}`,
  })),
];

export function collectSearchDestinations(input: {
  pages: readonly { screen: string; label: string; heading: string }[];
  declarations: readonly DashboardSearchDestination[];
  calendarViews: readonly CalendarViewEntry[];
  settingsTabs: readonly { id: string; label: string }[];
  permissions: readonly string[];
  label: (key: string) => string;
  knownScreens: readonly string[];
}): NavSearchDestination[] {
  const pages = new Map(input.pages.map((page) => [page.screen, page]));
  const destinations: NavSearchDestination[] = [];
  const ids = new Set<string>();
  const add = (id: string, screen: string, label: string, href: string) => {
    if (ids.has(id)) throw new Error(`dashboard repeats search destination "${id}"`);
    ids.add(id);
    const page = pages.get(screen);
    if (page)
      destinations.push({ id, screen, label, pageLabel: page.label, heading: page.heading, href });
  };
  for (const item of input.declarations) {
    const prefix = `/manage/${encodePathSegment(item.screen)}`;
    const parsed = new URL(item.path, "https://dashboard.invalid");
    if (
      !input.knownScreens.includes(item.screen) ||
      parsed.origin !== "https://dashboard.invalid" ||
      parsed.pathname !== item.path ||
      (item.path !== prefix && !item.path.startsWith(`${prefix}/`))
    )
      throw new Error(`dashboard search destination "${item.id}" has an invalid screen or path`);
    if (ids.has(item.id)) throw new Error(`dashboard repeats search destination "${item.id}"`);
    const allowed =
      item.requiresPermission === undefined ||
      input.permissions.includes(item.requiresPermission) ||
      (item.readPermission !== undefined && input.permissions.includes(item.readPermission));
    if (allowed) add(item.id, item.screen, input.label(item.labelKey), item.path);
    else ids.add(item.id);
  }
  for (const item of coreDestinations)
    if (pages.has(item.screen)) add(item.id, item.screen, input.label(item.labelKey), item.path);
  for (const { view } of input.calendarViews) {
    const path = `/manage/opening-hours/view/${encodePathSegment(view.id)}`;
    add(`calendar:${view.id}`, "opening-hours", input.label(view.labelKey), path);
    for (const child of view.searchDestinations ?? []) {
      const suffix = Object.entries(child.params)
        .flatMap(([key, value]) => [encodePathSegment(key), encodePathSegment(value)])
        .join("/");
      add(
        `calendar:${view.id}:${child.id}`,
        "opening-hours",
        input.label(child.labelKey),
        `${path}/${suffix}`,
      );
    }
  }
  for (const tab of input.settingsTabs)
    add(
      `settings:${tab.id}`,
      "venue-settings",
      tab.label,
      `/manage/venue-settings/view/${encodePathSegment(tab.id)}`,
    );
  return destinations;
}
