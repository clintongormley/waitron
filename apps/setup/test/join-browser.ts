import { expect, vi, type Mock } from "vitest";
import type { JoinStarted, JoinState, SetupApi } from "../src/api/client.js";
import { JOIN_HANDLE_KEY, JOIN_PRIMARY_KEY, type SetupApp } from "../src/setup-app.js";

export const JOIN_HANDLE = "h1";
export const MAIN = "https://waitron.local";
export const STARTED: JoinStarted = {
  code: "482913",
  timeLeftMs: 14 * 60_000,
  handle: JOIN_HANDLE,
};
export const WAITING: JoinState & { state: "waiting" } = {
  state: "waiting",
  code: "482913",
  primaryUrl: MAIN,
  timeLeftMs: STARTED.timeLeftMs,
  confirmed: false,
};
export const APPROVED: JoinState = { state: "approved" };

/** The join requests a stub `SetupApi` needs: a tab holding a handle reads an approved join. */
export const joinStubs = (): {
  [K in "startJoin" | "joinState" | "cancelJoin" | "confirmJoin" | "finishJoin"]: Mock<SetupApi[K]>;
} => ({
  startJoin: vi.fn().mockResolvedValue(STARTED),
  joinState: vi.fn(async (handle?: string): Promise<JoinState> =>
    handle === undefined ? { state: "none" } : APPROVED,
  ),
  cancelJoin: vi.fn().mockResolvedValue(undefined),
  confirmJoin: vi.fn().mockResolvedValue(undefined),
  finishJoin: vi.fn().mockResolvedValue({ adopted: true, restarting: true }),
});

/** This tab as it is once Join answered for `primaryUrl`. */
export function holdJoin(primaryUrl: string = MAIN): void {
  sessionStorage.setItem(JOIN_HANDLE_KEY, JOIN_HANDLE);
  sessionStorage.setItem(JOIN_PRIMARY_KEY, primaryUrl);
}

export function forgetJoin(): void {
  sessionStorage.removeItem(JOIN_HANDLE_KEY);
  sessionStorage.removeItem(JOIN_PRIMARY_KEY);
}

/** The join screen of `app`, once its first read has answered. */
export async function joinScreen(app: SetupApp): Promise<HTMLElement> {
  let screen: (HTMLElement & { updateComplete: Promise<unknown> }) | null = null;
  await vi.waitFor(() => {
    screen = app.shadowRoot!.querySelector("setup-connect-screen");
    expect(screen?.shadowRoot).toBeTruthy();
    expect(screen!.shadowRoot!.querySelector("[data-test=reading]")).toBeNull();
  });
  await screen!.updateComplete;
  return screen!;
}

/** Resolves when the join screen next hands Finish joining to `app`. */
export function finishRequested(app: SetupApp): Promise<void> {
  return new Promise((resolve) =>
    app.shadowRoot!.addEventListener("join-finish-requested", () => resolve(), {
      once: true,
      capture: true,
    }),
  );
}

async function settle(app: SetupApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
}

/**
 * Opens the join screen on a join `holdJoin` holds, which the main box has approved, and waits for
 * the screen to hand Finish joining to the shell.
 */
export async function finishJoining(app: SetupApp, primaryUrl: string = MAIN): Promise<void> {
  holdJoin(primaryUrl);
  const requested = finishRequested(app);
  app.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-goto", {
      detail: { screen: "connect" },
      bubbles: true,
      composed: true,
    }),
  );
  await requested;
  await settle(app);
}

/** Chooses Try again on the join screen showing, once a refused Finish joining draws it. */
export async function chooseTryAgain(app: SetupApp): Promise<void> {
  let finish: HTMLElement | null | undefined;
  await vi.waitFor(() => {
    finish = app
      .shadowRoot!.querySelector("setup-connect-screen")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-test=finish]");
    expect(finish).toBeTruthy();
  });
  finish!.click();
  await settle(app);
}
