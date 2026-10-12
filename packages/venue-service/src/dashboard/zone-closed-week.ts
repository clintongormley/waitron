import { nothing } from "lit";
import { currentLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { format } from "./hours-view.js";
import { seasonWeek } from "./season-choice.js";
import { t } from "./strings.js";
export function zoneClosedWeek(
  hours: OpeningHoursModel | undefined,
  departmentId: string,
  zoneId: string,
) {
  const zone = hours?.departments
    ?.find((d) => d.id === departmentId)
    ?.zones.find((z) => z.id === zoneId);
  if (!zone) return nothing;
  const season = hours!.seasons.find((s) => s.id === hours!.currentSeasonId) ?? hours!.seasons[0];
  const week = seasonWeek(zone.seasonWeeks, season?.id ?? "");
  const say = (
    unnamed: Parameters<typeof t>[0],
    seasonal: Parameters<typeof t>[0],
    values: Record<string, string> = {},
  ) => format(season ? seasonal : unnamed, { ...values, season: season?.name ?? "" });
  const groups = new Map<
    string,
    { ranges: readonly { startsAt: string; endsAt: string }[]; days: number[] }
  >();
  const cutover = hours!.dayCutover;
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const rank = (time: string) => (minute(time) - minute(cutover) + 1440) % 1440;
  for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
    const ranges = [...(week.find((d) => d.weekday === weekday)?.ranges ?? [])].sort(
      (a, b) => rank(a.startsAt) - rank(b.startsAt),
    );
    if (!ranges.length) continue;
    const key = ranges.map((r) => `${r.startsAt}/${r.endsAt}`).join(",");
    const group = groups.get(key) ?? { ranges, days: [] };
    group.days.push(weekday);
    groups.set(key, group);
  }
  if (!groups.size)
    return say("venue.zone_open_with_department", "venue.zone_season_open_with_department");
  if (groups.size > 2)
    return say("venue.zone_closed_days", "venue.zone_season_closed_days", {
      count: String([...groups.values()].reduce((sum, g) => sum + g.days.length, 0)),
    });
  const list = new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" });
  const day = (n: number) => t(`hours.day_in_sentence.${n}` as Parameters<typeof t>[0]);
  const days = (values: number[]) => {
    const labels: string[] = [];
    for (let start = 0; start < values.length;) {
      let end = start;
      while (end + 1 < values.length && values[end + 1] === (values[end]! + 1) % 7) end++;
      if (end - start >= 2)
        labels.push(
          t("venue.zone_day_range")
            .replace("{start}", day(values[start]!))
            .replace("{end}", day(values[end]!)),
        );
      else for (let i = start; i <= end; i++) labels.push(day(values[i]!));
      start = end + 1;
    }
    return list.format(labels);
  };
  return say("venue.zone_closed_summary", "venue.zone_season_closed_summary", {
    groups: [...groups.values()]
      .map(
        (g) =>
          `${list.format(g.ranges.map((r) => (r.endsAt === cutover ? t("venue.zone_closed_from").replace("{time}", r.startsAt) : `${r.startsAt}–${r.endsAt}`)))} ${days(g.days)}`,
      )
      .join("; "),
  });
}
