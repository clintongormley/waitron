import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
import type { BoxJoinCheck, DashboardApi, ServerListing } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { formatRecentMinute } from "../date-utils.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { LiveData } from "@waitron/dashboard-kit";

const REQUEST = "66666666-6666-4666-8666-666666666666";

const primaryRow = {
  nodeId: "11111111-1111-4111-8111-111111111111",
  contactUrl: "https://till.venue.example",
  standing: "serving-primary",
  isSelf: true,
  removable: false,
  canClear: false,
  requiresRetirementConfirmation: false,
  returnOutstanding: false,
  needsResetStatement: false,
} as const;

const asking = {
  id: REQUEST,
  address: "192.168.1.23",
  askedAt: "2026-11-21T10:00:00.000Z",
  startedAgain: false,
};

const listing = (joinRequests = [asking]): ServerListing => ({
  term: 3,
  nodes: [primaryRow],
  joinRequests,
});

const checked: BoxJoinCheck = {
  choices: ["482913", "105770", "930264"],
};

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listServers: vi.fn().mockResolvedValue(listing()),
    checkBoxJoin: vi.fn().mockResolvedValue(checked),
    approveBoxJoin: vi.fn().mockResolvedValue(undefined),
    dismissBoxJoin: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api = stubApi()): Promise<ServersScreen> {
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", { api });
  await flush(el);
  return el;
}

const find = (el: ServersScreen, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);

const joinDialog = (el: ServersScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "wt-dialog[data-test=join-dialog]",
  )!;

const choiceButtons = (el: ServersScreen) => [
  ...joinDialog(el).querySelectorAll<HTMLElementTagNameMap["wt-button"]>("[data-choice]"),
];

async function message(el: ServersScreen): Promise<string | null> {
  const actions = joinDialog(el).querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? null;
}

async function check(el: ServersScreen): Promise<void> {
  find(el, `join-check-${REQUEST}`)!.click();
  await flush(el);
  await flush(el);
}

afterEach(cleanupWidgets);

describe("a box asking to join, on the Servers screen", () => {
  it("lists the request with its address, and the started-again line only when set", async () => {
    const el = await mount();
    expect(find(el, `join-row-${REQUEST}`)!.textContent).toContain(
      "A box at 192.168.1.23 is asking to join",
    );
    expect(find(el, `join-started-again-${REQUEST}`)).toBeNull();
    expect(find(el, `join-check-${REQUEST}`)!.textContent).toContain("Check");
    expect(find(el, `join-dismiss-${REQUEST}`)!.textContent).toContain("Dismiss");

    const again = await mount(
      stubApi({
        listServers: vi.fn().mockResolvedValue(listing([{ ...asking, startedAgain: true }])),
      }),
    );
    expect(find(again, `join-started-again-${REQUEST}`)!.textContent!.trim()).toBe(
      "This box started again. Tap only a code it showed after that.",
    );
  });

  it("shows no requests section when nobody is asking", async () => {
    const el = await mount(stubApi({ listServers: vi.fn().mockResolvedValue(listing([])) }));
    expect(find(el, "join-requests")).toBeNull();
  });

  it("Check reads the request, then shows its three codes as large buttons in a labelled group", async () => {
    const api = stubApi();
    const el = await mount(api);
    await check(el);
    expect(api.checkBoxJoin).toHaveBeenCalledWith(REQUEST);
    expect(joinDialog(el).open).toBe(true);
    const group = joinDialog(el).querySelector<HTMLElement>('[role="group"]')!;
    const label = joinDialog(el).querySelector(`#${group.getAttribute("aria-labelledby")}`)!;
    expect(label.textContent!.trim()).toBe("Tap the code the new box shows");
    const buttons = choiceButtons(el);
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(["482 913", "105 770", "930 264"]);
    expect(buttons.every((b) => b.size === "lg")).toBe(true);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Code 482 913");
    expect(find(el, "join-dialog-address")!.textContent).toContain("192.168.1.23");
  });

  it("a right tap approves with that code and says to finish joining on the new box", async () => {
    const api = stubApi();
    const el = await mount(api);
    await check(el);
    choiceButtons(el)[0]!.click();
    await flush(el);
    await flush(el);
    expect(api.approveBoxJoin).toHaveBeenCalledWith(REQUEST, "482913");
    expect(find(el, "join-approved")!.textContent!.trim()).toBe(
      "Approved. On the new box, choose Finish joining.",
    );
    expect(choiceButtons(el)).toEqual([]);
    expect(api.listServers).toHaveBeenCalledTimes(2);
  });

  it("keeps the codes dialog open while a tap is being sent, so its answer is shown", async () => {
    let answer!: () => void;
    const api = stubApi({
      approveBoxJoin: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const el = await mount(api);
    await check(el);
    choiceButtons(el)[0]!.click();
    await flush(el);
    const close =
      joinDialog(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=join-close]")!;
    expect(close.disabled, "close while sending").toBe(true);
    expect(joinDialog(el).dismissible, "dismissible while sending").toBe(false);
    close.click();
    expect(await joinDialog(el).requestClose("cancel")).toBe(false);
    await flush(el);
    expect(joinDialog(el).open, "open after close attempts").toBe(true);
    answer();
    await flush(el);
    await flush(el);
    expect(find(el, "join-approved")).not.toBeNull();
    expect(close.disabled).toBe(false);
    expect(joinDialog(el).dismissible).toBe(true);
  });

  it("a wrong tap shows the refusal and offers no more codes", async () => {
    const api = stubApi({
      approveBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.join_wrong_code", status: 409 }),
    });
    const el = await mount(api);
    await check(el);
    choiceButtons(el)[1]!.click();
    await flush(el);
    await flush(el);
    expect(api.approveBoxJoin).toHaveBeenCalledWith(REQUEST, "105770");
    expect(await message(el)).toBe(
      "That is not the code the new box shows, so this request has ended and nothing was sent. If you are adding a box now, choose Start again on it and check its new code.",
    );
    expect(choiceButtons(el)).toEqual([]);
    expect(find(el, "join-check-again")).toBeNull();
    expect(api.listServers).toHaveBeenCalledTimes(2);
  });

  it("a refusal while building leaves the codes to tap again", async () => {
    const api = stubApi({
      approveBoxJoin: vi
        .fn()
        .mockRejectedValueOnce({ code: "membership.write_contended", status: 503 })
        .mockResolvedValueOnce(undefined),
    });
    const el = await mount(api);
    await check(el);
    choiceButtons(el)[0]!.click();
    await flush(el);
    await flush(el);
    expect(await message(el)).toBe(
      "The list of servers was being changed at the same moment. Try again.",
    );
    expect(choiceButtons(el).every((b) => !b.disabled)).toBe(true);
    choiceButtons(el)[0]!.click();
    await flush(el);
    await flush(el);
    expect(api.approveBoxJoin).toHaveBeenCalledTimes(2);
    expect(find(el, "join-approved")).not.toBeNull();
  });

  it("a refused Check shows its words and offers Check again, which reads again", async () => {
    const api = stubApi({
      checkBoxJoin: vi
        .fn()
        .mockRejectedValueOnce({ code: "management_session.proof_required", status: 400 })
        .mockResolvedValueOnce(checked),
    });
    const el = await mount(api);
    await check(el);
    expect(await message(el)).toBe(
      "Confirm it is you to continue. The action has not been carried out.",
    );
    expect(choiceButtons(el)).toEqual([]);
    find(el, "join-check-again")!.click();
    await flush(el);
    await flush(el);
    expect(api.checkBoxJoin).toHaveBeenCalledTimes(2);
    expect(choiceButtons(el)).toHaveLength(3);
    expect(await message(el)).toBeNull();
  });

  it("Dismiss ends the request and reads the list again", async () => {
    const listServers = vi.fn().mockResolvedValueOnce(listing()).mockResolvedValueOnce(listing([]));
    const api = stubApi({ listServers });
    const el = await mount(api);
    find(el, `join-dismiss-${REQUEST}`)!.click();
    await flush(el);
    await flush(el);
    expect(api.dismissBoxJoin).toHaveBeenCalledWith(REQUEST);
    expect(listServers).toHaveBeenCalledTimes(2);
    expect(find(el, `join-row-${REQUEST}`)).toBeNull();
  });

  it("a refused Dismiss says why beside the requests", async () => {
    const api = stubApi({
      dismissBoxJoin: vi
        .fn()
        .mockRejectedValue({ code: "node.operation_page_required", status: 403 }),
    });
    const el = await mount(api);
    find(el, `join-dismiss-${REQUEST}`)!.click();
    await flush(el);
    expect(find(el, "join-list-error")!.textContent!.trim()).toBe(
      "This operation needs an encrypted connection from this box's own page. Open the box's HTTPS address, then try again.",
    );
  });

  it("reads the list again every 5 seconds while it shows a request", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const background = { listServers: vi.fn().mockResolvedValue(listing([])) };
      const api = stubApi({ background });
      const el = await mount(api);
      vi.advanceTimersByTime(5000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);
      expect(find(el, `join-row-${REQUEST}`)).toBeNull();
      vi.advanceTimersByTime(10000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a request a new box makes while the page is open, without a reload", async () => {
    const liveData = new LiveData();
    const background = { listServers: vi.fn().mockResolvedValue(listing()) };
    const el = await mount(
      stubApi({ liveData, background, listServers: vi.fn().mockResolvedValue(listing([])) }),
    );
    expect(find(el, `join-row-${REQUEST}`)).toBeNull();
    liveData.invalidate([{ type: "box_joins" }]);
    await vi.waitFor(() => expect(find(el, `join-row-${REQUEST}`)).not.toBeNull());
  });

  it("starts no timer while nothing is listed, and stops when the screen is removed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const background = { listServers: vi.fn().mockResolvedValue(listing()) };
      const empty = await mount(
        stubApi({ background, listServers: vi.fn().mockResolvedValue(listing([])) }),
      );
      vi.advanceTimersByTime(15000);
      await flush(empty);
      expect(background.listServers).not.toHaveBeenCalled();

      const el = await mount(stubApi({ background }));
      vi.advanceTimersByTime(5000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);
      el.remove();
      vi.advanceTimersByTime(15000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends no second poll while one is still out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let releasePoll!: (value: ServerListing) => void;
      const background = {
        listServers: vi.fn(
          () =>
            new Promise<ServerListing>((resolve) => {
              releasePoll = resolve;
            }),
        ),
      };
      const el = await mount(stubApi({ background }));
      vi.advanceTimersByTime(10000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);
      releasePoll(listing());
      await flush(el);
      vi.advanceTimersByTime(5000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow poll finishing after the approval's own read does not bring the request back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let releasePoll!: (value: ServerListing) => void;
      const background = {
        listServers: vi.fn(
          () =>
            new Promise<ServerListing>((resolve) => {
              releasePoll = resolve;
            }),
        ),
      };
      const listServers = vi.fn().mockResolvedValueOnce(listing()).mockResolvedValue(listing([]));
      const el = await mount(stubApi({ background, listServers }));
      vi.advanceTimersByTime(5000);
      await flush(el);
      expect(background.listServers).toHaveBeenCalledTimes(1);

      await check(el);
      choiceButtons(el)[0]!.click();
      await flush(el);
      await flush(el);
      expect(listServers).toHaveBeenCalledTimes(2);
      expect(find(el, `join-row-${REQUEST}`)).toBeNull();

      releasePoll(listing());
      await flush(el);
      expect(find(el, `join-row-${REQUEST}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll begun before an approval is not applied, even when it lands before the approval's read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let releasePoll!: (value: ServerListing) => void;
      let releaseReread!: (value: ServerListing) => void;
      const background = {
        listServers: vi.fn(
          () =>
            new Promise<ServerListing>((resolve) => {
              releasePoll = resolve;
            }),
        ),
      };
      const listServers = vi
        .fn()
        .mockResolvedValueOnce(listing())
        .mockImplementationOnce(
          () =>
            new Promise<ServerListing>((resolve) => {
              releaseReread = resolve;
            }),
        );
      const el = await mount(stubApi({ background, listServers }));
      vi.advanceTimersByTime(5000);
      await flush(el);

      await check(el);
      choiceButtons(el)[0]!.click();
      await flush(el);
      expect(listServers).toHaveBeenCalledTimes(2);
      releasePoll(listing([{ ...asking, startedAgain: true }]));
      await flush(el);
      expect(find(el, `join-started-again-${REQUEST}`)).toBeNull();

      releaseReread(listing([]));
      await flush(el);
      expect(find(el, `join-row-${REQUEST}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Check refused because the request has gone reads the list again and offers no Check again", async () => {
    const listServers = vi.fn().mockResolvedValueOnce(listing()).mockResolvedValue(listing([]));
    const api = stubApi({
      listServers,
      checkBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.join_not_found", status: 404 }),
    });
    const el = await mount(api);
    await check(el);
    expect(listServers).toHaveBeenCalledTimes(2);
    expect(find(el, `join-row-${REQUEST}`)).toBeNull();
    expect(find(el, "join-check-again")).toBeNull();
  });

  it("Dismiss waits while another join action is out, and closes the codes dialog for that request", async () => {
    let releaseCheck!: (value: BoxJoinCheck) => void;
    const checkBoxJoin = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<BoxJoinCheck>((resolve) => {
            releaseCheck = resolve;
          }),
      )
      .mockResolvedValue(checked);
    const listServers = vi.fn().mockResolvedValueOnce(listing()).mockResolvedValue(listing([]));
    const api = stubApi({ checkBoxJoin, listServers });
    const el = await mount(api);
    find(el, `join-check-${REQUEST}`)!.click();
    await flush(el);
    const dismiss = find(el, `join-dismiss-${REQUEST}`) as HTMLElementTagNameMap["wt-button"];
    expect(dismiss.disabled).toBe(true);
    dismiss.click();
    await flush(el);
    expect(api.dismissBoxJoin).not.toHaveBeenCalled();
    releaseCheck(checked);
    await flush(el);
    expect(choiceButtons(el)).toHaveLength(3);

    find(el, `join-dismiss-${REQUEST}`)!.click();
    await flush(el);
    await flush(el);
    expect(api.dismissBoxJoin).toHaveBeenCalledWith(REQUEST);
    expect(joinDialog(el).open).toBe(false);
    expect(choiceButtons(el)).toEqual([]);
  });

  it("words a module's unreadable settings for the join here, while the shared words stay general", async () => {
    const api = stubApi({
      approveBoxJoin: vi
        .fn()
        .mockRejectedValue({ code: "module.config_invalid", status: 500, params: { reason: "x" } }),
    });
    const el = await mount(api);
    await check(el);
    choiceButtons(el)[0]!.click();
    await flush(el);
    await flush(el);
    expect(await message(el)).toBe(
      "A module's settings on this box could not be read, so the new box's copy was not prepared and nothing was sent.",
    );
    expect(codeMessage("module.config_invalid", "en")).not.toContain("new box");
    expect(codeMessage("module.config_invalid", "es")).not.toContain("servidor nuevo");
  });

  it("a rejection with no value still shows words rather than throwing", async () => {
    const api = stubApi({ checkBoxJoin: vi.fn().mockRejectedValue(undefined) });
    const el = await mount(api);
    await check(el);
    expect(await message(el)).toBe(codeMessage(codeOf(undefined)));
  });

  it("speaks Spanish on a Spanish dashboard", async () => {
    const before = currentLocale();
    setLocale("es");
    try {
      const el = await mount(
        stubApi({
          listServers: vi.fn().mockResolvedValue(listing([{ ...asking, startedAgain: true }])),
        }),
      );
      expect(find(el, `join-row-${REQUEST}`)!.textContent).toContain(
        es["servers.join_asking"].replace("{address}", "192.168.1.23"),
      );
      expect(find(el, `join-started-again-${REQUEST}`)!.textContent!.trim()).toBe(
        es["servers.join_started_again"],
      );
      const api = stubApi({
        approveBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.join_wrong_code", status: 409 }),
      });
      const tapped = await mount(api);
      await check(tapped);
      choiceButtons(tapped)[0]!.click();
      await flush(tapped);
      await flush(tapped);
      expect(await message(tapped)).toBe(codeMessage("mirror.join_wrong_code", "es"));
    } finally {
      setLocale(before);
    }
  });
});

// Words the plan gives are pinned verbatim; the rest were written for this screen.
const REFUSALS: [route: "check" | "approve", error: object, words: string][] = [
  [
    "check",
    { code: "mirror.join_not_found" },
    "This box is no longer asking to join: it ran out of time, or someone chose Start again on it.",
  ],
  [
    "check",
    { code: "mirror.spare_already_joined" },
    "This venue already has a spare box. Remove it on this page before adding another.",
  ],
  [
    "check",
    { code: "mirror.bucket_stream_active" },
    "Continuous copy to your bucket is on. Turn it off under Backups to add a spare; your bucket then stops receiving the venue's changes.",
  ],
  [
    "check",
    { code: "backup.recovery_key_missing" },
    "This box has no backup encryption key, which a spare needs. Choose Turn on backups under Backups, then choose Check again.",
  ],
  [
    "check",
    {
      code: "mirror.clocks_apart",
      params: { primaryAt: "2026-11-21T10:00:00.000Z", standbyAt: "2026-11-21T10:30:00.000Z" },
    },
    "The two boxes' clocks are more than 10 minutes apart (this box {primaryAt}, the new box {standbyAt}). Correct the new box's time, then choose Start again on it.",
  ],
  [
    "check",
    { code: "mirror.standby_name_taken" },
    "Another box here has the same short name as the new box. Choose Start again on the new box; it picks a new name.",
  ],
  [
    "check",
    { code: "mirror.membership_full", params: { limit: 8 } },
    "This venue's list of servers already holds 8 boxes, the most it can hold. Clear a removed box from the list on this page before adding another.",
  ],
  [
    "check",
    { code: "mirror.standby_removed" },
    "The new box asked under the name of a box removed from this venue. Choose Start again on the new box; it picks a new name.",
  ],
  [
    "check",
    { code: "membership.held_untrusted", params: { reason: "untrusted" } },
    "This box cannot check its own list of servers, so it cannot add a box. Nothing was changed.",
  ],
  [
    "check",
    { code: "mirror.not_provisioned" },
    "This box does not record whether this venue is a preparation venue or the real one, so it cannot be copied to a spare. Nothing was changed. This is a fault in Waitron.",
  ],
  [
    "approve",
    { code: "mirror.join_wrong_code" },
    "That is not the code the new box shows, so this request has ended and nothing was sent. If you are adding a box now, choose Start again on it and check its new code.",
  ],
  [
    "approve",
    { code: "mirror.join_in_progress" },
    "This box's copy is already being prepared. Wait a moment.",
  ],
  [
    "approve",
    { code: "mirror.join_other_approved" },
    "Another box was approved to join a moment ago. Choose Finish joining on that box first. If it will not finish, try this one again in a few minutes.",
  ],
  [
    "approve",
    { code: "mirror.join_stopped_after_listing" },
    "The new box stopped asking to join while its copy was being prepared, so nothing was sent. Remove it from the list on this page, then choose Start again on the new box.",
  ],
  [
    "approve",
    { code: "mirror.standby_invalid" },
    "The new box's request could not be read, so nothing was sent. Choose Start again on the new box.",
  ],
  [
    "approve",
    { code: "module.config_invalid", params: { reason: "x" } },
    "A module's settings on this box could not be read, so the new box's copy was not prepared and nothing was sent.",
  ],
];

describe("each refusal's words", () => {
  it.each(REFUSALS)("%s refused with %o", async (route, error, words) => {
    const api =
      route === "check"
        ? stubApi({ checkBoxJoin: vi.fn().mockRejectedValue({ status: 409, ...error }) })
        : stubApi({ approveBoxJoin: vi.fn().mockRejectedValue({ status: 409, ...error }) });
    const el = await mount(api);
    await check(el);
    if (route === "approve") {
      choiceButtons(el)[0]!.click();
      await flush(el);
      await flush(el);
    }
    const params = (error as { params?: Record<string, string> }).params ?? {};
    const expected = words
      .replace("{primaryAt}", params.primaryAt ? formatRecentMinute(params.primaryAt) : "")
      .replace("{standbyAt}", params.standbyAt ? formatRecentMinute(params.standbyAt) : "");
    expect(await message(el)).toBe(expected);
    const code = (error as { code: string }).code;
    if (route === "check")
      expect(find(el, "join-check-again") === null, code).toBe(code === "mirror.join_not_found");
  });
});
