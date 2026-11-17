import { expect } from "vitest";
import type { ReaderRow } from "../api/client.js";
import { deep, mountReceiptApp } from "./department-receipt-app-fixture.js";
export const reader: ReaderRow = {
  id: "r1",
  provider: "test",
  name: "Counter",
  active: true,
  canEnable: true,
  printsOwnSlipAutomatically: false,
  deviceCount: 0,
  deviceNames: [],
};
export function readerResponses(readers: ReaderRow[] = [reader]): Record<string, unknown> {
  return {
    "/management-api/payments/providers": [
      { providerId: "test", state: "connected", canUnpair: true },
    ],
    "/management-api/payments/readers": readers,
    "/management-api/payments/reader-holders": [],
  };
}
export function mountReaderApp(
  options: Parameters<typeof mountReceiptApp>[0] & { readers?: ReaderRow[] } = {},
) {
  const answers = readerResponses(options.readers);
  return mountReceiptApp({
    path: "/payments",
    permissions: ["hardware.manage"],
    modules: [],
    ...options,
    respond(path, init) {
      return (
        options.respond?.(path, init) ??
        (path in answers || path.endsWith("/status")
          ? Promise.resolve(
              new Response(
                JSON.stringify(answers[path] ?? { online: true, pairingStatus: "paired" }),
              ),
            )
          : undefined)
      );
    },
  });
}
export const readerScreen = (app: Awaited<ReturnType<typeof mountReaderApp>>["app"]) =>
  deep(
    app.shadowRoot!,
    "dashboard-payments-screen",
  ) as HTMLElementTagNameMap["dashboard-payments-screen"];
export async function readyReaderEditor(app: Awaited<ReturnType<typeof mountReaderApp>>["app"]) {
  const screen = readerScreen(app);
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=reader-name]")).toBeTruthy();
  await expect
    .poll(() =>
      screen.shadowRoot!.querySelector("[data-test=refresh-readers]")?.hasAttribute("disabled"),
    )
    .toBe(false);
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "[data-test=reader-editor]",
  )!;
}
