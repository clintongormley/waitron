import axe from "axe-core";
import { commands } from "vitest/browser";
import { beforeEach, expect, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { normaliseDraftLines } from "@waitron/shared";
import type {
  Draft,
  DraftLine,
  DraftSave,
  DraftSubmission,
  GroupLine,
  GroupRelease,
  SubmittedDraft,
  SubmittedGroups,
} from "../api/client.js";
import type { DocumentMember, ServedMenu } from "@waitron/catalogue/src/menu-document-types.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
  }
}

/**
 * Mounts by ASSIGNING PROPERTIES, where `packages/ui/src/test-helpers.ts` parses an HTML string: till
 * widgets take objects as `@property({ attribute: false })`, which cannot travel through markup.
 */

// Standalone widget fixtures use a Spanish venue; app roots replace this with their API configuration.
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

/**
 * Starts every test with the mouse cursor off the page, so nothing inherits a `:hover` that an
 * earlier test's click or hover left behind — the cursor belongs to the shared page, not to the test
 * that moved it, and it outlives the file that moved it. Without this an a11y scan can catch a button
 * dimmed by `wt-button`'s hover rule and report a colour-contrast violation nobody can see in the app.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;

/** The element under test plus the themed host it was mounted into (pass the host to axe). */
export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Mounts a custom element `tag` with `props` assigned before connection, inside a fresh themed
 * host, and waits for its first render. It paints the host's `--wt-color-bg` as a real deployment
 * does. Pass `theme` to pin `data-theme` so a color-contrast a11y check means what it means in the app;
 * omit it to render in whatever theme the environment resolves to.
 */
export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
  theme?: Theme,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  paintCanvas(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/**
 * Paints the page canvas as `index.html` does in the app. The harness themes only `host`, and axe
 * composites any element it cannot trace back to `host` (one pushed off-viewport, say) against the page
 * canvas — white by default, a false contrast failure for the dark theme. `<body>`/`<html>` are not theme
 * roots, so the concrete colour is read off `host` rather than passing the `var()`.
 */
function paintCanvas(host: HTMLElement): void {
  const bg = getComputedStyle(host).backgroundColor;
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

/** Runs the full default axe ruleset against `context` and fails the test on any violation. */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

type ServedFields = Pick<
  ServedMenu,
  "structure" | "homeLayouts" | "defaultHomeLayoutId" | "homeLayoutId" | "layoutFallback"
>;

/** An offer a {@link servedMenus} structure lists; with `section`, inside a section of that name. */
export interface ServedOffer {
  id: string;
  menuId: string;
  productId: string;
  section?: string;
}

/**
 * Gives each menu what a zone-offers body serves beside it: a structure listing that menu's own
 * offers in order, a section placed where its first offer falls, under a default layout with no
 * shortcuts, so a menu browser shows each offer once. With `shortcuts`, each menu also has a layout
 * `<menu id>-shortcuts` whose tiles are its offers; a menu's own `homeLayoutId` picks the layout the
 * device shows, the default otherwise.
 */
export function servedMenus<M extends { id: string; homeLayoutId?: string }>(
  menus: readonly M[],
  offers: readonly ServedOffer[],
  { shortcuts = false }: { shortcuts?: boolean } = {},
): (M & ServedFields)[] {
  return menus.map((menu) => {
    const own = offers.filter((offer) => offer.menuId === menu.id);
    const members: DocumentMember[] = [];
    for (const offer of own) {
      const placed: DocumentMember = {
        kind: "product",
        menuItemId: offer.id,
        productId: offer.productId,
      };
      if (offer.section === undefined) {
        members.push(placed);
        continue;
      }
      const sectionId = `${menu.id}/${offer.section}`;
      let section = members.find(
        (member): member is Extract<DocumentMember, { kind: "section" }> =>
          member.kind === "section" && member.sectionId === sectionId,
      );
      if (section === undefined) {
        section = {
          kind: "section",
          sectionId,
          internalName: offer.section,
          names: { en: offer.section },
          image: null,
          color: null,
          members: [],
        };
        members.push(section);
      }
      section.members.push(placed);
    }
    const home = `${menu.id}-home`;
    return {
      ...menu,
      structure: { members },
      homeLayouts: [
        { id: home, name: "Home", tiles: [] },
        ...(shortcuts
          ? [
              {
                id: `${menu.id}-shortcuts`,
                name: "Shortcuts",
                tiles: own.map((offer) => ({
                  kind: "product" as const,
                  productId: offer.productId,
                })),
              },
            ]
          : []),
      ],
      defaultHomeLayoutId: home,
      homeLayoutId: menu.homeLayoutId ?? home,
      layoutFallback: null,
    };
  });
}

/** A submitted group with its lines read back from the drafts they were saved in, each in the shape
 * a group submission carries: a null or empty field left out. */
export interface SentGroup {
  release: GroupRelease;
  lines: GroupLine[];
}

function asGroupLine(line: DraftLine): GroupLine {
  return {
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    ...(line.variantId === null ? {} : { variantId: line.variantId }),
    ...(line.menuVersionId === null ? {} : { menuVersionId: line.menuVersionId }),
    ...(line.options.length === 0 ? {} : { options: line.options }),
    ...(line.extras.length === 0 ? {} : { extras: line.extras }),
    ...(line.note === null ? {} : { note: line.note }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
  };
}

/**
 * The server's side of drafts for an app test's `TillApi` stub: each person's open draft per party,
 * merged on save with the shared rule and re-identified on every save; a submission takes its lines
 * out, and a repeat of a submission id answers as the first. Requests come from {@link personId}'s
 * session. {@link answer} says what the placed groups were; a test replaces it for another tab or
 * revision, or wraps {@link apply} to refuse or to lose the reply.
 */
export function draftServer(
  answer: (partyId: string) => SubmittedGroups = () => ({
    tabId: "wo-4",
    revision: 4,
    groups: [],
  }),
) {
  let ids = 0;
  const replies = new Map<string, SubmittedDraft>();
  const clone = <T>(value: T): T => structuredClone(value);
  /** Merges as the server does, and gives every line a new id, recorded by that id. */
  const reidentify = (lines: DraftSave["lines"]): DraftLine[] =>
    normaliseDraftLines(lines).map((line) => {
      const saved = { ...line, id: `line-${++ids}`, unavailable: false };
      server.linesById.set(saved.id, saved);
      return saved;
    });
  const server = {
    personId: "p1",
    personName: "Ana",
    drafts: [] as Draft[],
    linesById: new Map<string, DraftLine>(),
    /** The menu items the server reads as unavailable when it answers a line. */
    unavailable: new Set<string>(),
    answer,
    listDrafts: vi.fn(async (partyId: string) =>
      server.flagged(clone(server.drafts.filter((draft) => draft.partyId === partyId))),
    ),
    saveDraft: vi.fn(async (partyId: string, save: DraftSave) =>
      server.flagged(clone(server.save(partyId, save))),
    ),
    submitDraft: vi.fn(async (partyId: string, draftId: string, submission: DraftSubmission) =>
      clone(server.apply(partyId, draftId, submission)),
    ),
    takeOverDraft: vi.fn(async (partyId: string, draftId: string, revision: number) =>
      server.flagged(clone(server.takeOver(partyId, draftId, revision))),
    ),
    /** `unavailable` worked out on each answer, as the server does, never stored. */
    flagged<T extends Draft | Draft[] | null>(answer: T): T {
      for (const draft of answer === null ? [] : Array.isArray(answer) ? answer : [answer])
        for (const line of draft.lines) line.unavailable = server.unavailable.has(line.menuItemId);
      return answer;
    },
    save(partyId: string, save: DraftSave): Draft {
      const own = server.drafts.find(
        (draft) => draft.partyId === partyId && draft.ownerId === server.personId,
      );
      let draft: Draft;
      if (save.draftId === null) {
        if (own !== undefined) throw refusal("draft.out_of_date", own);
        draft = {
          id: `draft-${++ids}`,
          partyId,
          ownerId: server.personId,
          ownerName: server.personName,
          revision: 0,
          lines: [],
          takenOverFrom: null,
        };
        server.drafts.push(draft);
      } else {
        draft = server.open(partyId, save.draftId, save.revision);
      }
      draft.revision += 1;
      draft.lines = reidentify(save.lines);
      return draft;
    },
    /** A take-over as the server does it: the person's own draft answers as it is; another's
     * becomes theirs, or is added into the draft they already hold, which answers. */
    takeOver(partyId: string, draftId: string, revision: number): Draft {
      const draft = server.drafts.find(
        (candidate) => candidate.id === draftId && candidate.partyId === partyId,
      );
      if (draft === undefined) throw { code: "draft.not_found", status: 404, draftId };
      if (draft.ownerId === server.personId) return draft;
      if (draft.revision !== revision) throw refusal("draft.out_of_date", draft);
      const own = server.drafts.find(
        (candidate) => candidate.partyId === partyId && candidate.ownerId === server.personId,
      );
      if (own === undefined) {
        draft.takenOverFrom = { personId: draft.ownerId, name: draft.ownerName };
        draft.ownerId = server.personId;
        draft.ownerName = server.personName;
        draft.revision += 1;
        return draft;
      }
      server.drafts.splice(server.drafts.indexOf(draft), 1);
      own.revision += 1;
      own.lines = reidentify([...own.lines, ...draft.lines]);
      return own;
    },
    /** A submission as the server takes it, whether or not its answer reaches the till. */
    apply(partyId: string, draftId: string, submission: DraftSubmission): SubmittedDraft {
      const replay = replies.get(submission.submissionId);
      if (replay !== undefined) return replay;
      const draft = server.open(partyId, draftId, submission.draftRevision);
      const named = submission.groups.flatMap((group) => group.lineIds);
      if (!named.every((id) => draft.lines.some((line) => line.id === id)))
        throw { code: "management.request_invalid", status: 400, field: "groups" };
      draft.lines = draft.lines.filter((line) => !named.includes(line.id));
      draft.revision += 1;
      if (draft.lines.length === 0) server.drafts.splice(server.drafts.indexOf(draft), 1);
      const reply = {
        ...server.answer(partyId),
        draft: draft.lines.length === 0 ? null : server.flagged(clone(draft)),
      };
      replies.set(submission.submissionId, reply);
      return reply;
    },
    open(partyId: string, draftId: string, revision: number): Draft {
      const draft = server.drafts.find(
        (candidate) => candidate.id === draftId && candidate.partyId === partyId,
      );
      if (draft === undefined) throw { code: "draft.not_found", status: 404 };
      if (draft.ownerId !== server.personId)
        throw {
          code: "draft.taken_over",
          status: 409,
          draftId,
          ownerId: draft.ownerId,
          ownerName: draft.ownerName,
        };
      if (draft.revision !== revision) throw refusal("draft.out_of_date", draft);
      return draft;
    },
    /** The groups a submission sent, their lines read back by id. */
    sentGroups(submission: DraftSubmission): SentGroup[] {
      return submission.groups.map((group) => ({
        release: group.release,
        lines: group.lineIds.map((id) => asGroupLine(server.linesById.get(id)!)),
      }));
    },
  };
  return server;
}

function refusal(code: string, draft: Draft) {
  return { code, status: 409, draftId: draft.id, revision: draft.revision };
}

export type DraftServer = ReturnType<typeof draftServer>;
