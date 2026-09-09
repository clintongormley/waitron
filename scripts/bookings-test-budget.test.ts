import { expect, it } from "vitest";
import config from "../packages/bookings/vitest.config.js";

it("runs Bookings browser files one at a time, after its database project", () => {
  const projects = config.test!.projects as Array<{
    test: {
      name: string;
      sequence?: { groupOrder?: number };
      browser?: { fileParallelism?: boolean };
    };
  }>;
  const node = projects.find((project) => project.test.name === "node")!.test;
  const browser = projects.find((project) => project.test.name === "browser")!.test;
  expect(node.sequence?.groupOrder).toBe(0);
  expect(browser.sequence?.groupOrder).toBe(1);
  expect(browser.browser?.fileParallelism).toBe(false);
});
