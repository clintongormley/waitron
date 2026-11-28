import { expect, it } from "vitest";
import { customerMenuPublicUrl } from "./customer-menu-link.js";

it("combines the ready Cloud origin with the saved menu address", () => {
  const cloud = { status: "ready", origin: "https://menu.example.test" } as const;
  expect(customerMenuPublicUrl(cloud, "lunch")).toBe("https://menu.example.test/lunch");
  expect(customerMenuPublicUrl(cloud, null)).toBeUndefined();
  expect(customerMenuPublicUrl({ status: "remote_off" }, "lunch")).toBeUndefined();
});
