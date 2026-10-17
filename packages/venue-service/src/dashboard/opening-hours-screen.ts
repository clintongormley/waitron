import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  t as tKit,
  type CalendarViewEntry,
  type CalendarViewHost,
  type DashboardModuleContext,
  type DashboardScreenHandle,
} from "@waitron/dashboard-kit";
import {
  baseStyles,
  decodePathSegment,
  leaveCoordinatorFor,
  UrlStateController,
  navigationGuardFor,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-modal.js";
import "./season-chips.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./season-painter.js";
import type { PainterNavigation } from "./season-painter.js";
import "./opening-hours-year.js";
import "./opening-hours-month.js";
import type { CalendarDayOpen, CalendarDaysOpen } from "./opening-hours-month.js";
import "./opening-hours-week.js";
import { weekDates, weekInRange, weekMonth } from "./week-rows.js";
import "./calendar-day-box.js";
import { openingHoursDay } from "./opening-hours-day.js";
import {
  calendarViewPath,
  calendarWindowPath,
  hoursPath,
  openingHoursPath,
  seasonPainterPath,
  specialDayPainterPath,
} from "./opening-hours-paths.js";
import { segmentedStyles } from "./segmented-styles.js";
import "./special-day-painter.js";
import type { OpeningHoursMonth, OpeningHoursYear } from "../opening-hours-calendar.js";
import { HOURS_RANGE_MAX_DAYS, type HolidayFact, type LocalDate } from "../hours-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { businessDateToday } from "./business-date.js";
import { daysBetween, isLocalDate, parseCalendarMonth, parseCalendarYear } from "../hours-rules.js";
import { browserToday, format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import { chosenSeasonId } from "./season-choice.js";
import type { PrepStation } from "./routing-client.js";
import {
  monthWeeks,
  stationShowModel,
  type StationShow,
  type TimesPeriod,
} from "./station-show.js";
import type { StationServiceTimes } from "../station-service-times.js";

type View = "year" | "month" | "week";
const NO_STATIONS: readonly PrepStation[] = [];
/** What a painter address names, as written; `painterTarget` resolves it against the model. */
type PainterAddress = { seasonId: string; departmentId: string; zoneId: string };
/** A special-day painter address: a stored day, with a date to add to it, or a new day on `date`,
 *  through `to` when it opens on a run. */
type SpecialAddress = {
  specialDayId: string | null;
  date: LocalDate | null;
  to?: LocalDate | null;
};
const painterEntryKey = "openingHoursPainter";
const focusLost = () => !document.activeElement || document.activeElement === document.body;
/** The other modules' views the Calendar offers beside Opening hours, as the app worked them out. */
export type CalendarViews = {
  ctx: DashboardModuleContext;
  views: readonly CalendarViewEntry[];
};
/** The module view an address names: its id and the `<key>/<value>` pairs after it. */
type ModuleAddress = { id: string; params: Readonly<Record<string, string>> };

/** One month read followed at a time; `month` is the one followed, or "" for none. */
class MonthWatch {
  month = "";
  #detach?: () => void;
  /** On a month other than the followed one, stops following that and calls `start`, which
   *  returns the new read's detach, if it starts one. */
  follow(month: string, start: (month: string) => (() => void) | undefined): void {
    if (month === this.month) return;
    this.stop();
    this.month = month;
    this.#detach = start(month);
  }
  stop(): void {
    this.#detach?.();
    this.#detach = undefined;
    this.month = "";
  }
}

@customElement("dashboard-opening-hours-screen")
export class OpeningHoursScreen extends LitElement {
  static override styles = [
    baseStyles,
    segmentedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .month-back {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        min-height: var(--wt-tap-min);
        text-transform: capitalize;
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-4);
        margin-block-end: var(--wt-space-4);
      }
      .title h1 {
        margin: 0;
      }
      .month-back:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @property({ attribute: false }) calendar?: CalendarViews;
  /** Set while the address names one of `calendar`'s views. */
  @state() private moduleView?: ModuleAddress;
  @state() private windowId = "";
  private contentKey = "";
  private readonly windowDraftRoot = {};
  /** Each view's handle, created the first time it is shown and kept for this screen's life. */
  private readonly viewHandles = new Map<string, DashboardScreenHandle>();
  @state() private model?: OpeningHoursModel;
  @state() private departmentId = "";
  @state() private view: View = "year";
  /** The address's year, or 0 for the venue's current one. */
  @state() private requestedYear = 0;
  @state() private yearModel?: OpeningHoursYear;
  @state() private yearReadError = "";
  @state() private knownSpecialDays: readonly { id: string; name: string }[] = [];
  private yearDetach?: () => void;
  private watchedYear = 0;
  private knownSpecialDaysRead = {};
  /** The address's month, or "" for the venue's current one. */
  @state() private requestedMonth = "";
  /** The address's `week` date, or "" for the venue's today. */
  @state() private requestedWeekDate = "";
  @state() private monthModel?: OpeningHoursMonth;
  @state() private monthReadError = "";
  private readonly monthWatch = new MonthWatch();
  /** The address's station, or "" for none. */
  @state() private stationId = "";
  /** The venue's active stations, in Show's order; undefined until the list first answers. */
  @state() private stations?: readonly PrepStation[];
  private stationsDetach?: () => void;
  /** Follows `<station id> <from> <to>` rather than a month. */
  private readonly stationTimesWatch = new MonthWatch();
  @state() private stationTimes?: { key: string; value: StationServiceTimes };
  @state() private stationReadError = "";
  #stationShow?: { inputs: readonly unknown[]; show: StationShow };
  @state() private dayBox?: CalendarDayOpen;
  /** The month read behind the Year's day box, held while that box is open. */
  @state() private boxMonth?: OpeningHoursMonth;
  private readonly boxMonthWatch = new MonthWatch();
  @state() private boxMonthError = "";
  /** The `YYYY-MM` whose name in the Year takes focus once drawn: the Month's or the Week's year
   *  link held focus as it opened the Year, and the Year draws its month names only once its read
   *  arrives. Only the address change numbered `navigation` keeps it; `armed` once that change has
   *  been followed. */
  private focusHandOff?: { month: string; navigation: number; armed: boolean };
  private readonly endFocusHandOff = () => {
    this.focusHandOff = undefined;
    document.removeEventListener("focusin", this.endFocusHandOff, true);
  };
  private weekFocus?: { date: LocalDate; navigation: number };
  private readonly endWeekFocus = () => {
    this.weekFocus = undefined;
    document.removeEventListener("focusin", this.endWeekFocus, true);
  };
  /** Counts the addresses followed, so a hand-off can tell its own navigation from any other. */
  private navigations = 0;
  private followedHref = "";
  /** The open request the box was last shown for: once that box is hidden, a content change
   *  while its close is on the way must not show it again. */
  private dayBoxPlaced?: CalendarDayOpen;
  /** What a box button does once the box has closed. */
  private afterDayBox?: () => unknown;
  @state() private readError = "";
  @state() private specialReadError = "";
  private detach?: () => void;
  private generation = {};
  /** Set while the address is the season painter's; the view underneath stays as it was. */
  @state() private painter?: PainterAddress;
  /** Set while the address is the special-day painter's, over the view underneath as above. */
  @state() private special?: SpecialAddress;
  /** The public holidays the view that opened the special-day painter sent with its date. */
  private sentHolidays?: { date: LocalDate; holidays: readonly HolidayFact[] };
  /** The month read for a new special day's date when no other read covers it. */
  @state() private holidayRead?: { month: string; holidays: readonly HolidayFact[] };
  private readonly holidayWatch = new MonthWatch();
  /** The address of the view the painter opened over, or none on a direct load. */
  private baseHref?: string;
  /** The history entry this screen pushed the painter into over `base`: only from that entry
   *  does closing go back, because only there is the entry below known to be the base view. */
  private pushedPainter?: { entry: string; base: string | undefined };
  private readonly url = new UrlStateController(this, () => this.followUrl(), {
    basePath: "/manage",
    primary: "dashboard",
    children: {
      "opening-hours": {
        view: "view",
        season: "season",
        department: "department",
        station: "station",
        zone: "zone",
        "special-day": "special-day",
        date: "date",
        to: "to",
        year: "year",
        month: "month",
        week: "week",
        window: "window",
      },
    },
  });
  private followUrl() {
    const current = new URL(navigationGuardFor(window)?.href ?? location.href);
    if (current.href !== this.followedHref) {
      this.followedHref = current.href;
      this.navigations++;
      if (this.focusHandOff?.navigation !== this.navigations) this.endFocusHandOff();
    }
    if (this.url.read("dashboard") !== "opening-hours") return;
    const windowId = this.url.read("window");
    const requestedView = this.url.read("view");
    if (
      current.searchParams.has("station") &&
      (windowId === "seasons" ||
        requestedView === "year" ||
        requestedView === "month" ||
        requestedView === "week" ||
        this.calendarView(requestedView))
    ) {
      this.replaceAddress(this.calendarUrl(current.pathname));
      return;
    }
    if (windowId !== null && windowId !== "seasons") {
      this.replaceAddress(this.calendarUrl(calendarWindowPath(current.pathname, null)));
      return;
    }
    this.windowId = windowId ?? "";
    const contentPath = calendarWindowPath(current.pathname, null);
    const contentKey = contentPath + current.search + current.hash;
    if (contentKey === this.contentKey) return;
    this.contentKey = contentKey;
    const view = this.url.read("view");
    if (this.calendarView(view)) {
      this.painter = undefined;
      this.special = undefined;
      this.moduleView = { id: view!, params: this.moduleParams() };
      return;
    }
    this.moduleView = undefined;
    const named = {
      seasonId: this.url.read("season") ?? "",
      departmentId: this.url.read("department") ?? "",
      zoneId: this.url.read("zone") ?? "",
    };
    const date = this.url.read("date") ?? "";
    if (view === "season") {
      this.special = undefined;
      this.painter = named;
      if (this.baseHref === undefined) this.view = "year";
      this.namePainterTarget();
      return;
    }
    if (view === "special-day") {
      const specialDayId = this.url.read("special-day") || null;
      const to = this.url.read("to") ?? "";
      this.painter = undefined;
      this.special = {
        specialDayId,
        date: isLocalDate(date) ? date : null,
        to:
          specialDayId === null &&
          isLocalDate(date) &&
          isLocalDate(to) &&
          to > date &&
          daysBetween(date, to) < HOURS_RANGE_MAX_DAYS
            ? to
            : null,
      };
      if (this.baseHref === undefined) this.view = "year";
      return;
    }
    if (view === "date") {
      void Promise.resolve(
        this.url.write(
          {
            dashboard: "opening-hours",
            view: "month",
            month: isLocalDate(date) ? date.slice(0, 7) : null,
            date: null,
            to: null,
          },
          true,
        ),
      ).then(() => this.followUrl());
      return;
    }
    const underlying = new URL(current);
    underlying.pathname = contentPath;
    const href = underlying.href;
    const shown: View | undefined =
      view === "year" || view === "month" || view === "week"
        ? view
        : view === "calendar" || (view === null && !this.namesWeek(new URL(href)))
          ? "year"
          : undefined;
    if (!shown) {
      this.replaceAddress(this.painterUrl(named));
      return;
    }
    this.painter = undefined;
    this.special = undefined;
    this.baseHref = href;
    if (shown !== this.view) this.specialReadError = "";
    this.view = shown;
    this.departmentId = named.departmentId;
    this.stationId = this.url.read("station") ?? "";
    this.requestedYear = parseCalendarYear(this.url.read("year")) ?? 0;
    this.requestedMonth = parseCalendarMonth(this.url.read("month")) ?? "";
    const week = this.url.read("week");
    this.requestedWeekDate = isLocalDate(week) && weekInRange(week) ? week : "";
  }
  private calendarView(id: string | null) {
    return this.calendar?.views.find(({ view }) => view.id === id);
  }
  /** Every `<key>/<value>` pair of the address but `view`, read from the path itself because the
   *  URL controller reads only the keys it is configured with. */
  private moduleParams() {
    const path = new URL(navigationGuardFor(window)?.href ?? location.href).pathname;
    const parts = path.slice(openingHoursPath.length + 1).split("/");
    const params: Record<string, string> = {};
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (parts[i] === "view" || parts[i] === "window") continue;
      try {
        params[decodePathSegment(parts[i]!)] = decodePathSegment(parts[i + 1]!);
      } catch {
        // A malformed escape leaves that pair out, as the URL controller does with the address.
      }
    }
    return params;
  }
  /** Read only by a view's host, which exists only once the model has loaded. */
  private moduleMonth() {
    return (
      parseCalendarMonth(this.moduleView?.params["month"]) ??
      (businessDateToday(this.model!) || browserToday()).slice(0, 7)
    );
  }
  /** Moves the Calendar to a module view, or with `"hours"` back to Opening hours (its month when
   *  `params.month` names one, else its year). A view it was not given is ignored. */
  navigationScopes(destination: URL): readonly object[] | undefined {
    const current = new URL(navigationGuardFor(window)?.href ?? location.href);
    if (
      destination.origin !== current.origin ||
      destination.search !== current.search ||
      destination.hash !== current.hash ||
      calendarWindowPath(destination.pathname, null) !== calendarWindowPath(current.pathname, null)
    )
      return undefined;
    return this.windowId === "seasons" ? [this.windowDraftRoot] : [];
  }
  private readonly beforeWindowClose = async () => {
    await this.closeWindow();
    return false;
  };
  private async closeWindow() {
    const path = new URL(navigationGuardFor(window)?.href ?? location.href).pathname;
    await this.writeAddress(this.calendarUrl(calendarWindowPath(path, null)));
  }
  private seasonsWindow() {
    if (this.windowId !== "seasons" || !this.model) return nothing;
    return html`<wt-modal
      data-test="calendar-window"
      size="compact"
      .open=${true}
      heading=${t("season.seasons")}
      .beforeClose=${this.beforeWindowClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (
          event.target === event.currentTarget &&
          event.currentTarget === this.shadowRoot?.querySelector("[data-test=calendar-window]")
        )
          void this.closeWindow();
      }}
      ><season-chips
        .draftParent=${this.windowDraftRoot}
        .seasons=${this.yearModel?.seasons ?? this.monthModel?.seasons ?? []}
        .clockRevision=${this.model.clockRevision}
        .api=${this.api}
        .specialDays=${this.knownSpecialDays}
        .readOnly=${this.readOnly}
        @season-week-open=${this.openSeasonWeek}
        @season-changed=${(event: Event) => {
          event.stopPropagation();
          this.api.rereadWithSpecialDays();
        }}
      ></season-chips
      ><wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="close-calendar-window"
          variant="secondary"
          @click=${() => void this.closeWindow()}
          >${t("calendar.window.close")}</wt-button
        ></wt-form-actions
      ></wt-modal
    >`;
  }
  private openCalendarView(view: string, params: Record<string, string>) {
    if (!this.isConnected) return;
    if (view === "hours") return void this.writeAddress(this.hoursUrl(params));
    if (!this.calendarView(view)) return;
    void this.writeAddress(this.calendarUrl(calendarViewPath(view, params)));
  }
  private calendarUrl(pathname: string) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.searchParams.delete("station");
    url.pathname = pathname;
    return url;
  }
  private hoursUrl(params: Readonly<Record<string, string>>) {
    return this.calendarUrl(hoursPath(parseCalendarMonth(params["month"])));
  }
  /** The Calendar switch beside the title carries the month the page shows, when it shows one. */
  private chooseCalendarView(id: string) {
    const month = this.moduleView ? this.moduleView.params["month"] : this.switchMonth();
    this.openCalendarView(id, month ? { month } : {});
  }
  /** The month the page shows: a phone's Week shows one day, whose month may not be its Monday's. */
  private switchMonth() {
    const month = this.readMonth();
    if (!month || this.view !== "week") return month;
    return this.shadowRoot?.querySelector("opening-hours-week")?.shownMonth ?? month;
  }
  private static readonly ViewHost = class implements CalendarViewHost {
    constructor(
      private readonly screen: OpeningHoursScreen,
      private readonly id: string,
    ) {}
    get month() {
      return this.screen.moduleMonth();
    }
    get params() {
      const shown = this.screen.moduleView;
      return shown?.id === this.id ? shown.params : {};
    }
    get canWrite() {
      return this.screen.calendarView(this.id)?.canWrite ?? false;
    }
    /** A field, so a view may hand `host.open` on alone. */
    readonly open = (view: string, params: Record<string, string>) =>
      this.screen.openCalendarView(view, params);
  };
  private viewHandle({ view }: CalendarViewEntry) {
    let handle = this.viewHandles.get(view.id);
    if (!handle) {
      handle = view.create(this.calendar!.ctx, new OpeningHoursScreen.ViewHost(this, view.id));
      this.viewHandles.set(view.id, handle);
    }
    return handle;
  }
  private calendarHeading() {
    const views = this.calendar?.views ?? [];
    const heading = html`<h1>${t("nav.calendar")}</h1>`;
    if (views.length === 0) return heading;
    const chosen = this.moduleView?.id ?? "hours";
    const option = (value: string, label: string) =>
      html`<label
        ><input
          type="radio"
          name="calendarView"
          value=${value}
          .checked=${live(chosen === value)}
          @change=${() => this.chooseCalendarView(value)}
        /><span>${label}</span></label
      >`;
    return html`<div class="title">
      ${heading}
      <div
        class="segmented"
        role="radiogroup"
        aria-label=${t("nav.calendar")}
        data-test="calendar-switch"
      >
        ${option("hours", t("opening.title"))}
        ${views.map(({ view }) => option(view.id, tKit(view.labelKey)))}
      </div>
    </div>`;
  }
  private moduleContent(address: ModuleAddress) {
    const entry = this.calendarView(address.id)!;
    return this.viewHandle(entry).render(!entry.canWrite);
  }
  /** Whether an address with no view names a department, zone, season or an old `?station=`, which
   *  opens the season painter rather than the Year (ruling R3). */
  private namesWeek(url: URL) {
    return (
      ["department", "zone", "season"].some((key) => this.url.read(key) !== null) ||
      url.searchParams.has("station")
    );
  }
  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        const first = !this.model;
        this.model = model;
        if (first) this.namePainterTarget();
        this.readError = "";
      },
      () => {
        this.readError = t("opening.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    this.monthWatch.stop();
    this.stationsDetach?.();
    this.stationsDetach = undefined;
    this.stationTimesWatch.stop();
    this.yearDetach?.();
    this.watchedYear = 0;
    this.holidayWatch.stop();
    this.boxMonthWatch.stop();
    this.afterDayBox = undefined;
    this.endFocusHandOff();
    this.endWeekFocus();
    this.generation = {};
    super.disconnectedCallback();
  }
  private department() {
    const departments = this.model?.departments ?? [];
    return (
      departments.find((d) => d.id === this.departmentId) ??
      departments.find((d) => d.active) ??
      departments[0]
    );
  }
  protected override updated(changed: PropertyValues) {
    if (
      this.dayBox &&
      (changed.has("dayBox") ||
        changed.has("monthModel") ||
        changed.has("yearModel") ||
        changed.has("boxMonth") ||
        changed.has("boxMonthError") ||
        changed.has("monthReadError") ||
        changed.has("departmentId"))
    )
      void this.placeDayBox();
    if (this.focusHandOff?.armed) void this.focusPendingMonth();
    if (this.weekFocus) void this.focusPendingWeekDay();
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    // A new list without the shown view returns to Opening hours, replacing the address naming it.
    if (changed.has("calendar") && this.moduleView && !this.calendarView(this.moduleView.id)) {
      const { params } = this.moduleView;
      this.moduleView = undefined;
      this.replaceAddress(this.hoursUrl(params));
    }
    if (!this.model) return;
    this.watchYear();
    this.watchMonth();
    this.watchStations();
    this.watchStationTimes();
    this.watchHolidays();
    this.watchBoxMonth();
  }
  private shownYear() {
    if (this.view !== "year" || !this.model) return 0;
    return (
      this.requestedYear ||
      Number((businessDateToday(this.model) || String(new Date().getFullYear())).slice(0, 4))
    );
  }
  private watchYear() {
    const year = this.shownYear();
    if (year === this.watchedYear) return;
    this.yearDetach?.();
    this.yearDetach = undefined;
    this.watchedYear = year;
    this.yearReadError = "";
    // The last year stays drawn until the next one arrives, so the pressed ‹ or › keeps focus.
    if (!year) {
      this.yearModel = undefined;
      return;
    }
    const current = () => this.isConnected && this.watchedYear === year;
    this.yearDetach = this.api.watchYear(
      year,
      (model) => {
        if (!current()) return;
        this.yearModel = model;
        this.yearReadError = "";
      },
      () => {
        if (!current()) return;
        this.yearReadError = t("opening.load_error");
        if (this.yearModel?.year !== year) this.yearModel = undefined;
      },
      () => {
        if (current()) this.yearReadError = "";
      },
    );
  }
  private shownMonth() {
    if (!this.model || this.view !== "month") return "";
    if (this.requestedMonth) return this.requestedMonth;
    const today = businessDateToday(this.model);
    return (today || browserToday()).slice(0, 7);
  }
  private shownWeekDate() {
    if (!this.model || this.view !== "week") return "";
    return this.requestedWeekDate || businessDateToday(this.model) || browserToday();
  }
  /** The month read the shown view draws from: the Month's month, or the Week's Monday's. */
  private readMonth() {
    if (this.view === "week") {
      const date = this.shownWeekDate();
      return date ? weekMonth(date) : "";
    }
    return this.shownMonth();
  }
  private watchMonth() {
    this.monthWatch.follow(this.readMonth(), (month) => {
      this.monthReadError = "";
      if (!month) {
        this.monthModel = undefined;
        return undefined;
      }
      return this.api.watchMonth(
        month,
        (model) => {
          this.monthModel = model;
          this.monthReadError = "";
        },
        () => {
          this.monthReadError = t("opening.load_error");
          if (this.monthModel?.month !== month) this.monthModel = undefined;
        },
        () => {
          this.monthReadError = "";
        },
      );
    });
  }
  /** Decision 12: a read-only Calendar offers and reads no station. */
  private stationsWanted() {
    return !this.readOnly && !this.moduleView && (this.view === "month" || this.view === "week");
  }
  private watchStations() {
    if (!this.stationsWanted()) {
      this.stationsDetach?.();
      this.stationsDetach = undefined;
      return;
    }
    if (this.stationsDetach) return;
    this.stationsDetach = this.api.watchStations(
      (stations) => {
        this.stations = stations
          .filter((station) => station.active)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
      },
      // Show keeps its departments; the station list is a choice the page works without.
      () => {
        this.stations ??= [];
      },
      () => {},
    );
  }
  /** The station the address names, if the screen may show stations and the list holds it. */
  private shownStation() {
    if (!this.stationId || !this.stationsWanted()) return undefined;
    return this.stations?.find((station) => station.id === this.stationId);
  }
  /** Whether the address names a station the list, not yet read, may hold. */
  private stationListPending() {
    return this.stationId !== "" && this.stationsWanted() && this.stations === undefined;
  }
  private watchStationTimes() {
    const station = this.shownStation();
    const month = this.readMonth();
    const key = station && month ? `${station.id} ${monthWeeks(month).join(" ")}` : "";
    this.stationTimesWatch.follow(key, () => {
      this.stationReadError = "";
      if (!station) return undefined;
      const [from, to] = monthWeeks(month);
      const current = () => this.stationTimesWatch.month === key;
      return this.api.watchStationTimes(
        station.id,
        from,
        to,
        (value) => {
          if (!current()) return;
          this.stationTimes = { key, value };
          this.stationReadError = "";
        },
        () => {
          if (current()) this.stationReadError = t("opening.load_error");
        },
        () => {
          if (current()) this.stationReadError = "";
        },
      );
    });
  }
  /** What the Month and the Week draw for the shown station: the same object while nothing it is
   *  built from changes, so a view does not take it for a new station. */
  private stationShow(): StationShow | undefined {
    const station = this.shownStation();
    if (!station && !this.stationListPending()) return undefined;
    const times =
      this.stationTimes?.key === this.stationTimesWatch.month ? this.stationTimes.value : undefined;
    const meta = this.monthModel;
    const inputs = [this.stationId, station, times, meta, this.readMonth(), this.model];
    const held = this.#stationShow;
    if (held && held.inputs.every((input, index) => input === inputs[index])) return held.show;
    const show: StationShow = station
      ? this.composeStation(station, times, meta)
      : { id: this.stationId, state: "loading" };
    this.#stationShow = { inputs, show };
    return show;
  }
  private composeStation(
    station: PrepStation,
    times: StationServiceTimes | undefined,
    meta: OpeningHoursMonth | undefined,
  ): StationShow {
    const { id } = station;
    if (times?.always) return { id, state: "always" };
    if (!times || meta?.month !== this.readMonth()) return { id, state: "loading" };
    const periods: TimesPeriod[] = this.model!.departments.flatMap((department) =>
      department.periods.map(({ id, name, colour }) => ({
        id,
        name,
        colour,
        departmentId: department.id,
        departmentName: department.name,
      })),
    );
    const shown = stationShowModel(meta, times, station, periods, "department");
    return shown ? { id, state: "ready", ...shown } : { id, state: "loading" };
  }
  private boxMonthNeeded() {
    if (this.view !== "year" || this.moduleView || !this.dayBox) return "";
    return this.dayBox.date.slice(0, 7);
  }
  private watchBoxMonth() {
    this.boxMonthWatch.follow(this.boxMonthNeeded(), (month) => {
      this.boxMonth = undefined;
      this.boxMonthError = "";
      if (!month) return undefined;
      return this.api.watchMonth(
        month,
        (model) => {
          this.boxMonth = model;
          this.boxMonthError = "";
        },
        () => {
          this.boxMonthError = t("opening.load_error");
        },
        () => {
          this.boxMonthError = "";
        },
      );
    });
  }
  /** The public holidays this screen already holds for `date`'s month, or none when it holds no
   *  read covering it. */
  private heldHolidays(date: LocalDate): readonly HolidayFact[] | undefined {
    const month = date.slice(0, 7);
    if (this.sentHolidays?.date === date) return this.sentHolidays.holidays;
    if (this.monthModel?.month === month)
      return this.monthModel.days.flatMap((day) => day.holidays);
    if (this.yearModel?.year === Number(date.slice(0, 4)))
      return this.yearModel.days.flatMap((day) => day.holidays);
    if (this.holidayRead?.month === month) return this.holidayRead.holidays;
    return undefined;
  }
  /** A new special day on a date opens pre-filled only if its holidays are known as it opens, so
   *  on an address alone (a reload, Back or Forward) the date's month is read for them. */
  private holidayMonthNeeded() {
    const date = this.special?.specialDayId === null ? this.special.date : null;
    if (!date || this.sentHolidays?.date === date) return "";
    const month = date.slice(0, 7);
    if (this.monthWatch.month === month && !this.monthReadError) return "";
    if (this.watchedYear === Number(date.slice(0, 4)) && !this.yearReadError) return "";
    return month;
  }
  private watchHolidays() {
    this.holidayWatch.follow(this.holidayMonthNeeded(), (month) => {
      if (!month) return undefined;
      const settled = (holidays: readonly HolidayFact[]) => {
        if (this.holidayWatch.month === month) this.holidayRead = { month, holidays };
      };
      return this.api.watchMonth(
        month,
        (model) => settled(model.days.flatMap((day) => day.holidays)),
        // A failed read opens the day unfilled rather than not at all.
        () => {
          if (this.holidayRead?.month !== month) settled([]);
        },
        () => {},
      );
    });
  }
  /** Feeds only the season dialog's naming of a refusal, so a failed read keeps the last list. */
  private readKnownSpecialDays() {
    const read = (this.knownSpecialDaysRead = {});
    void this.api.specialDays.listSpecialDays({ passive: true }).then(
      (days) => {
        if (this.isConnected && this.knownSpecialDaysRead === read)
          this.knownSpecialDays = days.map(({ id, name }) => ({ id, name }));
      },
      () => {},
    );
  }
  private readonly areaWrites = {
    saveHolidayArea: (areaKey: string) => this.api.specialDays.saveHolidayArea(areaKey),
    rereadWatches: () => this.api.rereadWithSpecialDays(),
  };
  private openMonth(month: string) {
    return Promise.resolve(
      this.url.write({
        dashboard: "opening-hours",
        view: "month",
        month,
        year: null,
        week: null,
      }),
    ).then(() => this.followUrl());
  }
  private openYear(year: string) {
    return Promise.resolve(
      this.url.write({
        dashboard: "opening-hours",
        view: "year",
        year: year.padStart(4, "0"),
        month: null,
        week: null,
        date: null,
        to: null,
      }),
    ).then(() => this.followUrl());
  }
  private async writeAddress(url: URL, replace = false) {
    const generation = this.generation;
    const view = this.view;
    const painter = this.painter;
    const special = this.special;
    const guard = navigationGuardFor(window);
    if (guard) {
      await guard.write(url, replace);
      if (this.isConnected && generation === this.generation) this.followUrl();
      return;
    }
    const proceed = () => {
      if (
        !this.isConnected ||
        generation !== this.generation ||
        this.view !== view ||
        this.painter !== painter ||
        this.special !== special
      )
        return;
      if (replace) history.replaceState(history.state, "", url);
      else history.pushState(history.state, "", url);
      this.followUrl();
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator)
      await coordinator.request({
        scopes: this.navigationScopes(url) ?? "all",
        reason: "navigation",
        proceed,
      });
    else proceed();
  }
  /** Rewrites the address in place without the leave question: the painter keeps its draft across
   *  a department switch, and a guarded write would offer to discard it. */
  private replaceAddress(url: URL) {
    const guard = navigationGuardFor(window);
    if (guard) {
      if (leaveCoordinatorFor(this)?.isDirty()) guard.rewrite(url);
      else void guard.write(url, true);
      return;
    }
    history.replaceState(history.state, "", url);
    this.followUrl();
  }
  private painterUrl({ seasonId, departmentId, zoneId }: PainterAddress) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.pathname = seasonPainterPath({ seasonId, departmentId, zoneId });
    url.searchParams.delete("station");
    return url;
  }
  /** Opens the painter on `seasonId` for the department the screen shows, over the current view. */
  private async openPainter(seasonId: string) {
    const department = this.department();
    const wasOpen = this.overlaid();
    await this.writeAddress(
      this.painterUrl({
        seasonId,
        departmentId: department?.active ? department.id : "",
        zoneId: "",
      }),
    );
    this.markPushedPainter(wasOpen);
  }
  /** Whether a painter, of a season or of a special day, is drawn over the view. */
  private overlaid() {
    return this.painter !== undefined || this.special !== undefined;
  }
  private specialUrl({ specialDayId, date, to }: SpecialAddress) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.pathname = specialDayPainterPath({ specialDayId, date, to });
    url.searchParams.delete("station");
    return url;
  }
  /** Opens the special-day painter over the current view; `holidays` are the ones the view sent. */
  private async openSpecialPainter(address: SpecialAddress, holidays: readonly HolidayFact[] = []) {
    if (!this.isConnected || this.readOnly || this.overlaid()) return;
    this.specialReadError = "";
    this.sentHolidays = address.date ? { date: address.date, holidays } : undefined;
    await this.writeAddress(this.specialUrl(address));
    this.markPushedPainter(false);
  }
  private markPushedPainter(wasOpen: boolean) {
    if (wasOpen || !this.isConnected || !this.overlaid()) return;
    const guard = navigationGuardFor(window);
    let entry: string;
    if (guard) {
      const { epoch, index } = guard.position;
      entry = `${epoch}:${index}`;
    } else {
      entry = crypto.randomUUID();
      history.replaceState(
        { ...Object(history.state), [painterEntryKey]: entry },
        "",
        location.href,
      );
    }
    this.pushedPainter = { entry, base: this.baseHref };
  }
  private atPushedPainter() {
    const pushed = this.pushedPainter;
    if (!pushed || pushed.base !== this.baseHref) return false;
    const guard = navigationGuardFor(window);
    if (!guard) return Object(history.state)[painterEntryKey] === pushed.entry;
    const { epoch, index } = guard.position;
    return `${epoch}:${index}` === pushed.entry;
  }
  private painterTarget(model: OpeningHoursModel, named: PainterAddress) {
    const active = model.departments.filter((department) => department.active);
    const department = active.find((candidate) => candidate.id === named.departmentId) ?? active[0];
    return {
      seasonId: chosenSeasonId(model.seasons, model.currentSeasonId, named.seasonId),
      departmentId: department?.id ?? "",
      zoneId: department?.zones.find((zone) => zone.id === named.zoneId)?.id ?? "",
    };
  }
  /** Puts what the painter shows in the address when it names a season, department or zone it
   *  cannot show. Only on arrival: a refresh that removes the shown season is the painter's to tell. */
  private namePainterTarget() {
    const named = this.painter;
    if (!named || !this.model) return;
    const target = this.painterTarget(this.model, named);
    if (
      target.seasonId !== named.seasonId ||
      target.departmentId !== named.departmentId ||
      target.zoneId !== named.zoneId
    )
      this.replaceAddress(this.painterUrl(target));
  }
  /** A painter the screen has already let go of may still finish an update and announce it. */
  private currentPainter(event: Event) {
    return (
      this.isConnected &&
      this.overlaid() &&
      event.currentTarget ===
        this.shadowRoot?.querySelector(this.painter ? "season-painter" : "special-day-painter")
    );
  }
  /** Closes either painter: back to the entry it was pushed over, else to the view it drew over. */
  private closePainter() {
    const pushed = this.atPushedPainter();
    this.pushedPainter = undefined;
    if (pushed) history.back();
    else this.replaceAddress(new URL(this.baseHref ?? hoursPath(), location.href));
  }
  /** The painter is given what the address names, not what that resolves to, so that when a
   *  refresh removes it the painter sees it go and tells (ruling R11). */
  private seasonPainter() {
    const named = this.painter;
    if (!named || !this.model) return nothing;
    return html`<season-painter
      .open=${true}
      .api=${this.api}
      .model=${this.model}
      .seasonId=${named.seasonId}
      .departmentId=${named.departmentId}
      .zoneId=${named.zoneId}
      .readOnly=${this.readOnly}
      @painter-navigate=${(event: CustomEvent<PainterNavigation>) => {
        event.stopPropagation();
        if (!this.currentPainter(event)) return;
        const { seasonId, departmentId, zoneId } = event.detail;
        this.replaceAddress(this.painterUrl({ seasonId, departmentId, zoneId: zoneId ?? "" }));
      }}
      @painter-close=${(event: Event) => {
        event.stopPropagation();
        if (this.currentPainter(event)) this.closePainter();
      }}
      @click=${(event: MouseEvent) => {
        const link = event
          .composedPath()
          .find(
            (node): node is HTMLAnchorElement =>
              node instanceof HTMLAnchorElement && node.dataset["test"] === "periods-link",
          );
        if (
          !link ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        void this.writeAddress(new URL(link.href));
      }}
    ></season-painter>`;
  }
  private specialPainter() {
    const address = this.special;
    if (!address || !this.model) return nothing;
    const { specialDayId, date } = address;
    const held = date ? this.heldHolidays(date) : [];
    // Only a new day's opening depends on them: they decide its pre-filled name.
    if (held === undefined && specialDayId === null) return nothing;
    const holidays = [
      ...(held ?? []),
      ...(this.monthModel?.days.flatMap((day) => day.holidays) ?? []),
      ...(this.yearModel?.days.flatMap((day) => day.holidays) ?? []),
    ];
    return html`<special-day-painter
      .open=${true}
      .api=${this.api}
      .model=${this.model}
      .specialDayId=${specialDayId}
      .date=${specialDayId === null ? date : null}
      .lastDate=${specialDayId === null ? (address.to ?? null) : null}
      .addDate=${specialDayId === null ? null : date}
      .holidays=${holidays}
      .readOnly=${this.readOnly}
      @special-day-saved=${(event: CustomEvent<{ detail: SpecialDayDetail }>) => {
        event.stopPropagation();
        if (this.currentPainter(event) && this.special?.specialDayId === null)
          this.replaceAddress(
            this.specialUrl({ specialDayId: event.detail.detail.id, date: null }),
          );
      }}
      @special-day-navigate=${(event: CustomEvent<{ specialDayId: string }>) => {
        event.stopPropagation();
        if (this.currentPainter(event))
          this.replaceAddress(
            this.specialUrl({ specialDayId: event.detail.specialDayId, date: null }),
          );
      }}
      @special-day-deleted=${(event: Event) => {
        // The painter closes itself next, and its painter-close closes the address.
        event.stopPropagation();
      }}
      @painter-close=${(event: Event) => {
        event.stopPropagation();
        if (this.currentPainter(event)) this.closePainter();
      }}
    ></special-day-painter>`;
  }
  private openSeasonWeek(event: CustomEvent<{ seasonId: string }>) {
    event.stopPropagation();
    if (!this.isConnected || this.painter) return;
    void this.openPainter(event.detail.seasonId);
  }
  /** A date a special day holds opens that day; any other opens a new day on the run. */
  private openDays(event: CustomEvent<CalendarDaysOpen>) {
    event.stopPropagation();
    const { date, from, to } = event.detail;
    const read = this.view === "year" ? this.yearModel : this.monthModel;
    const days = read?.days ?? [];
    const specialDayId = days.find((day) => day.date === date)?.specialDay?.id ?? null;
    const holidays = days.flatMap((day) => day.holidays);
    const open = () =>
      specialDayId
        ? this.openSpecialPainter({ specialDayId, date: null })
        : this.openSpecialPainter({ specialDayId: null, date: from, to }, holidays);
    const box = this.shadowRoot?.querySelector("calendar-day-box");
    if (this.dayBox && this.dayBoxPlaced === this.dayBox && box?.shown) {
      this.afterDayBox = open;
      box.hide();
      return;
    }
    this.dayBox = undefined;
    this.dayBoxPlaced = undefined;
    this.afterDayBox = undefined;
    void open();
  }
  private openDayBox(event: CustomEvent<CalendarDayOpen>) {
    event.stopPropagation();
    this.afterDayBox = undefined;
    this.dayBox = event.detail;
  }
  private async placeDayBox() {
    const open = this.dayBox;
    await this.shadowRoot?.querySelector<LitElement>(
      "opening-hours-month, opening-hours-year, opening-hours-week",
    )?.updateComplete;
    const drawn = this.shadowRoot?.querySelector("calendar-day-box");
    await Promise.all(
      [drawn, ...(drawn?.children ?? [])].map(
        (node) => (node as LitElement | null)?.updateComplete,
      ),
    );
    if (!this.isConnected || this.dayBox !== open || !open) return;
    const anchor = open.returnTo();
    const box = this.shadowRoot?.querySelector("calendar-day-box");
    if (!anchor || !box) {
      this.dayBox = undefined;
      return;
    }
    if (this.dayBoxPlaced === open && !box.shown) return;
    box.show(anchor);
    this.dayBoxPlaced = open;
  }
  private dayBoxClosed(event: Event) {
    event.stopPropagation();
    // A close sent while another date's box waits to be shown belongs to the old box.
    if (!this.dayBox || this.dayBox.date !== this.dayBoxPlaced?.date) return;
    this.dayBox = undefined;
    this.dayBoxPlaced = undefined;
    const act = this.afterDayBox;
    this.afterDayBox = undefined;
    if (this.isConnected) act?.();
  }
  /** What the day box says of `date`: from the month read holding its row, else, over the Year
   *  while that read is pending, from the year read alone. */
  private dayBoxContent(date: LocalDate) {
    const year = this.view === "year" ? this.yearModel : undefined;
    const read = year ? this.boxMonth : this.monthModel;
    // Over the Month and the Week, the screen's month-read-error alert already announces a failed
    // reread.
    const error = year ? this.boxMonthError : "";
    const day = read?.days.find((row) => row.date === date);
    if (day && read) {
      // The Month and the Week pick a department unless they show a station; the Year lists
      // every one.
      const departmentId = year || this.shownStation() ? "" : this.departmentId;
      return {
        shown: openingHoursDay(day, read.seasons, this.model!.departments, departmentId),
        message: "",
        error,
        day,
        seasons: read.seasons,
        holidays: read.days.flatMap((row) => row.holidays),
      };
    }
    if (!year || year.year !== Number(date.slice(0, 4))) return undefined;
    return {
      shown: undefined,
      message: error ? "" : t("day.loading"),
      error,
      day: year.days.find((row) => row.date === date),
      seasons: year.seasons,
      holidays: year.days.flatMap((row) => row.holidays),
    };
  }
  private dayBoxTemplate() {
    const open = this.dayBox;
    const content = open && !this.moduleView ? this.dayBoxContent(open.date) : undefined;
    if (!open || !content) return nothing;
    const { shown, day, holidays } = content;
    const specialDayId = day?.specialDay?.id ?? null;
    const season = content.seasons.find(({ id }) => id === day?.seasonId);
    const act = (run: () => unknown) => () => {
      this.afterDayBox = run;
      this.shadowRoot?.querySelector("calendar-day-box")?.hide();
    };
    return html`<calendar-day-box
      .heading=${formatDate(open.date)}
      .name=${shown?.name ?? ""}
      .nameKind=${shown?.nameKind ?? ""}
      .line=${shown?.line ?? ""}
      .rows=${shown?.rows ?? []}
      .message=${content.message}
      .error=${content.error}
      @calendar-day-box-close=${this.dayBoxClosed}
    >
      ${
        this.readOnly
          ? nothing
          : specialDayId
            ? html`<wt-button
                variant="secondary"
                data-test="special-edit"
                @click=${act(() => this.openSpecialPainter({ specialDayId, date: null }))}
                >${t("special.edit")}</wt-button
              >`
            : html`<wt-button
                variant="secondary"
                data-test="special-add"
                @click=${act(() =>
                  this.openSpecialPainter({ specialDayId: null, date: open.date }, holidays),
                )}
                >${t("day.make_special")}</wt-button
              >`
      }
      ${
        season
          ? html`<wt-button
              variant="secondary"
              data-test="edit-week"
              @click=${act(() => this.openPainter(season.id))}
              >${format(this.readOnly ? "day.show_week" : "day.edit_week", {
                season: season.name,
              })}</wt-button
            >`
          : nothing
      }
      ${
        this.view === "year" || this.view === "month"
          ? html`<wt-button
              variant="secondary"
              data-test="open-week"
              @click=${act(() => this.openWeekFromBox(open.date))}
              >${t("day.open_week")}</wt-button
            >`
          : nothing
      }
    </calendar-day-box>`;
  }
  /** Focus left on the page by the box's Open this week goes to the date's name in the Week, which
   *  draws its names only once its month read arrives. */
  private openWeekFromBox(date: LocalDate) {
    this.endWeekFocus();
    const pending = { date, navigation: this.navigations + 1 };
    this.weekFocus = pending;
    document.addEventListener("focusin", this.endWeekFocus, true);
    void Promise.resolve(
      this.url.write({
        dashboard: "opening-hours",
        view: "week",
        week: date,
        month: null,
        year: null,
        date: null,
        to: null,
      }),
    ).then(() => {
      this.followUrl();
      if (this.weekFocus === pending && this.navigations !== pending.navigation)
        this.endWeekFocus();
      else void this.focusPendingWeekDay();
    });
  }
  private async focusPendingWeekDay() {
    const pending = this.weekFocus;
    if (!pending || this.navigations < pending.navigation) return;
    // The view the box sat over still holds focus until the Week replaces it.
    await this.updateComplete;
    if (this.weekFocus !== pending) return;
    if (
      this.navigations !== pending.navigation ||
      !focusLost() ||
      this.view !== "week" ||
      this.moduleView ||
      this.overlaid()
    ) {
      this.endWeekFocus();
      return;
    }
    const week = this.shadowRoot?.querySelector("opening-hours-week");
    await week?.updateComplete;
    const name = week?.shadowRoot?.querySelector<HTMLElement>(
      `[data-test=day-name][data-date="${pending.date}"]`,
    );
    if (this.weekFocus !== pending || !name) return;
    this.endWeekFocus();
    if (this.isConnected && focusLost()) name.focus();
  }
  private heldFocus(view: EventTarget | null, selector: string) {
    if (!(view instanceof LitElement) || this.shadowRoot?.activeElement !== view) return null;
    const held = view.shadowRoot?.activeElement;
    return held?.matches(selector) ? held : null;
  }
  /** A month name pressed while it held focus leaves focus on the Month's year link, since the
   *  name goes with the Year it sat in. */
  private openMonthFromYear(event: CustomEvent<{ date: string }>) {
    this.openMonthHolding(event, "[data-test=month-name]", event.detail.date.slice(0, 7));
  }
  private openMonthHolding(event: Event, selector: string, monthToOpen: string) {
    event.stopPropagation();
    const held = this.heldFocus(event.currentTarget, selector);
    const opened = this.openMonth(monthToOpen);
    if (!held) return;
    void opened.then(async () => {
      await this.updateComplete;
      const month = this.shadowRoot?.querySelector("opening-hours-month");
      await month?.updateComplete;
      if (!this.isConnected || held.isConnected || !focusLost()) return;
      month?.shadowRoot?.querySelector<HTMLElement>("[data-test=month-year]")?.focus();
    });
  }
  private openYearFromMonth(event: CustomEvent<{ year: number }>) {
    this.openYearHolding(event, "[data-test=month-year]", this.shownMonth());
  }
  /** `month` is the one whose name in the Year takes focus; it must lie in the year opened. */
  private openYearHolding(event: CustomEvent<{ year: number }>, selector: string, month: string) {
    event.stopPropagation();
    const held = this.heldFocus(event.currentTarget, selector);
    this.endFocusHandOff();
    const handOff = held && {
      month,
      navigation: this.navigations + 1,
      armed: false,
    };
    // Listens from the press, not from the arming: focus that moves away and falls back to the
    // page before the Year's read arrives has still moved.
    if (handOff) {
      this.focusHandOff = handOff;
      document.addEventListener("focusin", this.endFocusHandOff, true);
    }
    void this.openYear(String(event.detail.year)).then(() => {
      if (!handOff || this.focusHandOff !== handOff) return;
      if (this.navigations !== handOff.navigation) {
        this.endFocusHandOff();
        return;
      }
      handOff.armed = true;
      void this.focusPendingMonth();
    });
  }
  private async focusPendingMonth() {
    const handOff = this.focusHandOff;
    if (!handOff?.armed) return;
    const { month } = handOff;
    if (
      !focusLost() ||
      this.view !== "year" ||
      this.moduleView ||
      this.overlaid() ||
      this.shownYear() !== Number(month.slice(0, 4))
    ) {
      this.endFocusHandOff();
      return;
    }
    const year = this.shadowRoot?.querySelector("opening-hours-year");
    await year?.updateComplete;
    const name = year?.shadowRoot?.querySelector<HTMLElement>(
      `[data-month="${month}"] [data-test=month-name]`,
    );
    if (this.focusHandOff !== handOff || !name) return;
    this.endFocusHandOff();
    if (this.isConnected && focusLost()) name.focus();
  }
  private writeChanges(changes: Record<string, string | null>) {
    void Promise.resolve(this.url.write({ dashboard: "opening-hours", ...changes })).then(() =>
      this.followUrl(),
    );
  }
  /** Above the Month or the Week: a failed month read, else a failed station read. */
  private readErrors() {
    if (this.monthReadError)
      return html`<p role="alert" data-test="month-read-error">${this.monthReadError}</p>`;
    if (this.stationReadError && this.shownStation())
      return html`<p role="alert" data-test="station-read-error">${this.stationReadError}</p>`;
    return nothing;
  }
  private showStations() {
    return (this.stationsWanted() && this.stations) || NO_STATIONS;
  }
  private stationChanged = (event: CustomEvent<{ stationId: string }>) => {
    event.stopPropagation();
    this.writeChanges({ station: event.detail.stationId || null, department: null, zone: null });
  };
  private departmentChanged = (event: CustomEvent<{ departmentId: string }>) => {
    event.stopPropagation();
    this.writeChanges({ department: event.detail.departmentId || null, zone: null, station: null });
  };
  private month() {
    return html`${this.readErrors()}
      <opening-hours-month
        .model=${this.monthModel}
        .month=${this.shownMonth()}
        .departmentId=${this.departmentId}
        .departments=${this.model!.departments}
        .stations=${this.showStations()}
        .station=${this.stationShow()}
        .readOnly=${this.readOnly}
        .linkYear=${true}
        @calendar-day-open=${this.openDayBox}
        @calendar-days-open=${this.openDays}
        @month-year-open=${this.openYearFromMonth}
        @month-change=${(event: CustomEvent<{ month: string }>) => {
          event.stopPropagation();
          this.writeChanges({ view: "month", month: event.detail.month, date: null, to: null });
        }}
        @month-department-change=${this.departmentChanged}
        @month-station-change=${this.stationChanged}
      ></opening-hours-month>`;
  }
  /** A drawn day box would otherwise be shown again over the view a title link opens. */
  private dropDayBox() {
    const box = this.dayBox;
    this.dayBox = undefined;
    this.dayBoxPlaced = undefined;
    this.afterDayBox = undefined;
    if (box) this.shadowRoot?.querySelector("calendar-day-box")?.hide();
  }
  private week() {
    return html`${this.readErrors()}
      <opening-hours-week
        .model=${this.monthModel}
        .date=${this.shownWeekDate()}
        .departmentId=${this.departmentId}
        .departments=${this.model!.departments}
        .stations=${this.showStations()}
        .station=${this.stationShow()}
        @calendar-day-open=${this.openDayBox}
        @week-month-open=${(event: CustomEvent<{ month: string }>) => {
          this.dropDayBox();
          this.openMonthHolding(event, "[data-test=week-month]", event.detail.month);
        }}
        @week-year-open=${(event: CustomEvent<{ year: number }>) => {
          this.dropDayBox();
          const year = String(event.detail.year).padStart(4, "0");
          const first =
            weekDates(this.shownWeekDate()).find((date) => date.startsWith(year)) ?? `${year}-01`;
          this.openYearHolding(event, "[data-test=week-year]", first.slice(0, 7));
        }}
        @week-change=${(event: CustomEvent<{ date: string }>) => {
          event.stopPropagation();
          this.writeChanges({ view: "week", week: event.detail.date });
        }}
        @week-department-change=${this.departmentChanged}
        @week-station-change=${this.stationChanged}
      ></opening-hours-week>`;
  }
  override render() {
    return html`${this.calendarHeading()}
    ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}${
      !this.model
        ? nothing
        : this.moduleView
          ? this.moduleContent(this.moduleView)
          : this.view === "year"
            ? html`${this.yearReadError ? html`<p role="alert" data-test="year-read-error">${this.yearReadError}</p>` : nothing}
                <opening-hours-year
                  .model=${this.yearModel}
                  .year=${this.shownYear()}
                  .readFailed=${this.yearReadError !== ""}
                  .api=${this.api}
                  .areaApi=${this.areaWrites}
                  .specialDays=${this.knownSpecialDays}
                  .readOnly=${this.readOnly}
                  @calendar-day-open=${this.openDayBox}
                  @calendar-days-open=${this.openDays}
                  @season-dialog-open=${() => this.readKnownSpecialDays()}
                  @season-week-open=${this.openSeasonWeek}
                  @season-changed=${(event: Event) => {
                    event.stopPropagation();
                    this.api.rereadWithSpecialDays();
                  }}
                  @year-change=${(event: CustomEvent<{ year: number }>) => {
                    event.stopPropagation();
                    void Promise.resolve(
                      this.url.write({
                        dashboard: "opening-hours",
                        view: "year",
                        year: String(event.detail.year).padStart(4, "0"),
                      }),
                    ).then(() => this.followUrl());
                  }}
                  @year-month-open=${this.openMonthFromYear}
                ></opening-hours-year>`
            : this.view === "week"
              ? this.shownWeekDate()
                ? this.week()
                : nothing
              : this.shownMonth()
                ? this.month()
                : nothing
    }
    ${this.dayBoxTemplate()}
    ${this.specialReadError ? html`<p role="alert" data-test="special-read-error">${this.specialReadError}</p>` : nothing}
    ${this.seasonPainter()} ${this.specialPainter()} ${this.seasonsWindow()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-opening-hours-screen": OpeningHoursScreen;
  }
}
