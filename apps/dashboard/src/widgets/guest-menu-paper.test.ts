import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./guest-menu-preview.js";
afterEach(cleanupWidgets);
it("previews captured paper choices and saves only local appearance, without enabling sharing", async () => {
  const writes: Record<string, unknown>[] = [];
  const api = new DashboardApi("", async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "PUT") {
      writes.push(body);
      return new Response(JSON.stringify({ ...body, revision: 1, available: false }));
    }
    if (String(input).endsWith("guest-paper")) {
      writes.push(body);
      return new Response(JSON.stringify({ html: "<!doctype html><h1>Captured wine</h1>" }));
    }
    return new Response(JSON.stringify({ enabled: false, revision: 0, available: false }));
  });
  const { el } = await mountWidget("dashboard-guest-menu-paper", {
    api,
    settings: { enabled: false, available: false, revision: 0 },
    menuId: "menu",
    versionId: "v1",
    language: "en",
    members: [
      { name: "Lunch", section: true },
      { name: "Wine", section: true },
      { name: "Special dish", section: false },
    ],
  } as never);
  await expect.poll(() => el.shadowRoot?.querySelector('[name="paper-preset"]')).toBeTruthy();
  const root = el.shadowRoot!;
  expect(root.querySelectorAll(".member wt-switch").length).toBe(2);
  const save = () => root.querySelector<HTMLElementTagNameMap["wt-button"]>("#save-paper")!;
  await expect
    .poll(() => root.querySelector<HTMLElementTagNameMap["wt-button"]>("#preview-paper")!.disabled)
    .toBe(false);
  expect(save().disabled).toBe(true);
  root
    .querySelector('[name="paper-preset"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "lunch-wine" } }));
  await expect.poll(() => save().disabled).toBe(false);
  root
    .querySelectorAll(".member wt-switch")[1]!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  await page.elementLocator(root.querySelectorAll(".member wt-button")[1]!).click();
  await expect
    .poll(
      () => root.querySelector<HTMLElementTagNameMap["wt-switch"]>(".member wt-switch")!.checked,
    )
    .toBe(false);
  root
    .querySelectorAll(".member wt-switch")[1]!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  root
    .querySelector("dashboard-image-upload")!
    .dispatchEvent(new CustomEvent("image-changed", { detail: { image: "logo.webp" } }));
  await page.elementLocator(root.querySelector("#preview-paper")!).click();
  await expect
    .poll(() => root.querySelector("iframe")?.contentDocument?.body.textContent)
    .toContain("Captured wine");
  expect(writes[0]).toMatchObject({
    versionId: "v1",
    language: "en",
    order: [1, 0, 2],
    breaks: [0],
    logo: "logo.webp",
    paper: { preset: "lunch-wine" },
  });
  await page.elementLocator(save()).click();
  await expect.poll(() => save().disabled).toBe(true);
  expect(writes[1]).toMatchObject({
    enabled: false,
    expectedRevision: 0,
    paper: { preset: "lunch-wine" },
  });
  expect(writes[1]).not.toHaveProperty("order");
  root
    .querySelector('[name="paper-preset"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bistro" } }));
  await expect.poll(() => root.querySelector("iframe")).toBeNull();
});
