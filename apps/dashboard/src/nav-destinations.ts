import type {
  CalendarViewEntry,
  DashboardSearchDestination,
  DashboardSettingSearchDestination,
} from "@waitron/dashboard-kit";
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
    path: `/modifiers/view/${view}`,
  })),
  ...[
    ["queue", "printers.jobs_title"],
    ["printers", "printers.list_title"],
    ["agents", "printers.agents_tab"],
  ].map(([view, labelKey]) => ({
    id: `printers:${view}`,
    screen: "printers",
    labelKey: labelKey!,
    path: `/printers/view/${view}`,
  })),
  {
    id: "modules:card-providers",
    screen: "modules",
    labelKey: "modules.providers",
    path: "/modules/view/card-providers/state/all",
  },
  {
    id: "payments:readers",
    screen: "payments",
    labelKey: "payments.readers_heading",
    path: "/payments",
  },
];

export function collectSearchDestinations(input: {
  pages: readonly { screen: string; label: string; heading: string }[];
  declarations: readonly (DashboardSearchDestination | DashboardSettingSearchDestination)[];
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
    if (
      !input.knownScreens.includes(item.screen) ||
      (item.kind !== "setting" && !validSearchDestinationPath(item.screen, item.path))
    )
      throw new Error(`dashboard search destination "${item.id}" has an invalid screen or path`);
    if (ids.has(item.id)) throw new Error(`dashboard repeats search destination "${item.id}"`);
    const allowed =
      (item.requiresPermission === undefined && item.readPermission === undefined) ||
      (item.requiresPermission !== undefined &&
        input.permissions.includes(item.requiresPermission)) ||
      (item.readPermission !== undefined && input.permissions.includes(item.readPermission));
    if (allowed && item.kind !== "setting")
      add(item.id, item.screen, input.label(item.labelKey), item.path);
    else {
      ids.add(item.id);
      const page = pages.get(item.screen);
      if (allowed && page && item.kind === "setting")
        destinations.push({
          id: item.id,
          screen: item.screen,
          label: input.label(item.labelKey),
          pageLabel: page.label,
          heading: page.heading,
          location: input.label(item.locationKey),
          setting: item,
        });
    }
  }
  for (const item of coreDestinations)
    if (pages.has(item.screen)) add(item.id, item.screen, input.label(item.labelKey), item.path);
  for (const { view } of input.calendarViews) {
    const path = `/opening-hours/view/${encodePathSegment(view.id)}`;
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
      `/venue-settings/view/${encodePathSegment(tab.id)}`,
    );
  return destinations;
}

export function validSearchDestinationPath(screen: string, path: string): boolean {
  try {
    const prefix = `/${encodePathSegment(screen)}`;
    const parsed = new URL(path, "https://dashboard.invalid");
    return (
      parsed.origin === "https://dashboard.invalid" &&
      parsed.pathname === path &&
      (path === prefix || path.startsWith(`${prefix}/`))
    );
  } catch {
    return false;
  }
}
