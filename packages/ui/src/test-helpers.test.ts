import { afterEach, expect, test } from "vitest";
import { chooseOption, cleanup, mountInShadowRoot } from "./test-helpers.js";
import "./components/wt-combobox.js";
import type { WtCombobox } from "./components/wt-combobox.js";

afterEach(cleanup);

test("chooseOption picks a value the way a click on its row does: the value, a composed wt-change, the label on the trigger", async () => {
  const el = (await mountInShadowRoot(
    '<wt-combobox label="Course" search="never"></wt-combobox>',
  )) as WtCombobox;
  el.options = [
    { value: "starter", label: "Starter" },
    { value: "main", label: "Main course" },
  ];
  await el.updateComplete;
  const heard: unknown[] = [];
  const listener = (event: Event) => heard.push((event as CustomEvent).detail);
  document.addEventListener("wt-change", listener);
  try {
    await chooseOption(el, "main");
  } finally {
    document.removeEventListener("wt-change", listener);
  }
  expect(heard).toEqual([{ value: "main" }]);
  expect(el.value).toBe("main");
  expect(el.shadowRoot!.querySelector(".trigger .value")!.textContent).toBe("Main course");
});

test("chooseOption resolves only once the element's update has completed", async () => {
  let finish!: () => void;
  const stub = Object.assign(document.createElement("div"), {
    value: "",
    updateComplete: new Promise<void>((resolve) => (finish = resolve)),
  });
  let done = false;
  const picking = chooseOption(stub, "main").then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stub.value).toBe("main");
  expect(done).toBe(false);
  finish();
  await picking;
  expect(done).toBe(true);
});
