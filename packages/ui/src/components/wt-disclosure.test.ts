import { expect, test, afterEach } from "vitest";
import { commands } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-disclosure.js";

afterEach(cleanup);

test("the section chevron is large enough to read beside its heading", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  const chevron = el.shadowRoot!.querySelector<HTMLElement>(".chevron")!;
  expect(chevron.getBoundingClientRect().width).toBeGreaterThanOrEqual(18);
});

test("collapsed by default; body hidden", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  // aria-expanded is the accessible signal; the body element carrying `hidden` is what actually
  // keeps the collapsed content out of the layout and off the a11y tree, so assert it directly.
  expect((el.shadowRoot!.querySelector(".body") as HTMLElement).hidden).toBe(true);
});

test("clicking the header opens it and emits wt-toggle", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  let opened: boolean | undefined;
  el.addEventListener("wt-toggle", (e) => {
    opened = (e as CustomEvent).detail.open;
  });
  el.shadowRoot!.querySelector("button")!.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(opened).toBe(true);
  expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
});

test("the body moves through intermediate heights while opening and closing", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen"><div style="height: 200px">body</div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;

  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(body.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(body.getBoundingClientRect().height).toBeLessThan(200);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(body.getBoundingClientRect().height).toBe(200);

  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(body.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(body.getBoundingClientRect().height).toBeLessThan(200);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(body.hidden).toBe(true);
});

test("rapid toggles settle at the last state and keep closed content out of focus", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen"><button>Inside</button><div style="height: 200px"></div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 150));
  header.click();
  await disclosure.updateComplete;
  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect(body.hidden).toBe(false);
  expect(body.getBoundingClientRect().height).toBeGreaterThan(200);

  header.click();
  await disclosure.updateComplete;
  expect(body.inert).toBe(true);
  expect(body.getAttribute("aria-hidden")).toBe("true");
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect(body.hidden).toBe(true);
});

test("reopening during collapse continues from the current height", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" open><div style="height: 200px">body</div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const pauseHeightTransition = (previous?: Animation): Promise<Animation> =>
    new Promise((resolve, reject) => {
      const pause = () => {
        if (!body.isConnected) {
          reject(new Error("Disclosure removed before its height transition started"));
          return;
        }
        const animation = body
          .getAnimations()
          .find(
            (candidate) =>
              candidate !== previous &&
              candidate instanceof CSSTransition &&
              candidate.transitionProperty === "height",
          );
        if (!animation) {
          requestAnimationFrame(pause);
          return;
        }
        // Pause in the frame that finds the transition, before an awaited observer can miss it.
        animation.pause();
        animation.currentTime = 0;
        resolve(animation);
      };
      requestAnimationFrame(pause);
    });

  header.click();
  await disclosure.updateComplete;
  const closing = await pauseHeightTransition();
  closing.currentTime = Number(closing.effect!.getTiming().duration) / 2;
  const heightWhileClosing = body.getBoundingClientRect().height;
  expect(heightWhileClosing).toBeGreaterThan(0);
  expect(heightWhileClosing).toBeLessThan(200);
  header.click();
  await disclosure.updateComplete;
  const reopening = await pauseHeightTransition(closing);
  expect(body.getBoundingClientRect().height).toBeCloseTo(heightWhileClosing, 0);
  reopening.currentTime = Number(reopening.effect!.getTiming().duration) / 2;
  expect(body.getBoundingClientRect().height).toBeGreaterThanOrEqual(heightWhileClosing - 1);
  expect(body.getBoundingClientRect().height).toBeLessThan(200);
  reopening.finish();
  await expect.poll(() => body.classList.contains("animating")).toBe(false);
  expect(body.hidden).toBe(false);
  expect(body.getBoundingClientRect().height).toBe(200);
});

test("an empty body opened before content arrives grows with its content", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen"><div class="late"></div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  el.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  (el.querySelector(".late") as HTMLElement).style.height = "150px";
  expect(body.getBoundingClientRect().height).toBe(150);
});

test("a same-frame close and reopen leaves the body free to grow", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" open><div class="growing" style="height: 200px"></div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  header.click();
  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  (el.querySelector(".growing") as HTMLElement).style.height = "400px";
  expect(body.getBoundingClientRect().height).toBe(400);
});

test("idle open content can paint and receive a pointer beyond the body box", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" open><div style="position:relative;height:60px"><button class="pop" style="position:absolute;top:40px;height:60px">Outside</button></div></wt-disclosure>',
  );
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const pop = el.querySelector<HTMLElement>(".pop")!;
  const rect = pop.getBoundingClientRect();
  expect(document.elementFromPoint(rect.left + 5, rect.bottom - 5)).toBe(pop);
  expect(getComputedStyle(body).overflow).toBe("visible");
});

test("a validation error interrupts closing and exposes its fields immediately", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" open><div style="height: 200px">body</div></wt-disclosure>',
  );
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  header.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 150));
  disclosure.hasError = true;
  await disclosure.updateComplete;
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(body.hidden).toBe(false);
  expect(body.inert).toBe(false);
  expect(body.getBoundingClientRect().height).toBe(200);
});

test("a body with no height still becomes hidden after closing", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" open></wt-disclosure>');
  const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  el.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
  await disclosure.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(body.hidden).toBe(true);
});

test("reduced motion opens and closes without waiting for the height animation", async () => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    query === "(prefers-reduced-motion: reduce)"
      ? ({ matches: true, media: query } as MediaQueryList)
      : original(query)) as typeof window.matchMedia;
  try {
    const el = await mount(
      '<wt-disclosure heading="Kitchen"><div style="height: 200px">body</div></wt-disclosure>',
    );
    const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
    const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    header.click();
    await disclosure.updateComplete;
    expect(body.getBoundingClientRect().height).toBe(200);
    header.click();
    await disclosure.updateComplete;
    expect(body.hidden).toBe(true);
  } finally {
    window.matchMedia = original;
  }
});

test("switching on reduced motion during a close hides the body immediately", async () => {
  await commands.emulateReducedMotion("no-preference");
  try {
    const el = await mount(
      '<wt-disclosure heading="Kitchen" open><div style="height: 200px">body</div></wt-disclosure>',
    );
    const disclosure = el as import("./wt-disclosure.js").WtDisclosure;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    el.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
    await disclosure.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(body.hidden).toBe(false);
    await commands.emulateReducedMotion("reduce");
    await expect.poll(() => body.hidden, { timeout: 450, interval: 25 }).toBe(true);
  } finally {
    await commands.emulateReducedMotion(null);
  }
});

test("wt-toggle bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = await mountInShadowRoot(
    '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
  );
  let received: CustomEvent<{ open: boolean }> | undefined;
  document.addEventListener(
    "wt-toggle",
    (e) => {
      received = e as CustomEvent<{ open: boolean }>;
    },
    { once: true },
  );

  el.shadowRoot!.querySelector("button")!.click();

  expect(received?.detail.open).toBe(true);
});

test("has-error forces open and blocks collapse", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" has-error><p>body</p></wt-disclosure>');
  const btn = el.shadowRoot!.querySelector("button")!;
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  let toggles = 0;
  el.addEventListener("wt-toggle", () => toggles++);
  btn.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(btn.getAttribute("aria-expanded")).toBe("true"); // still open
  // The inert header must not fire wt-toggle at all — a consumer listening for it should see
  // nothing, not a toggle that reports the section stayed open.
  expect(toggles).toBe(0);
});

test("summary paints from the muted-text token", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen" summary="Bar"><p>b</p></wt-disclosure>');
  host.style.setProperty("--wt-color-text-muted", "rgb(9, 9, 9)");
  const s = el.shadowRoot!.querySelector(".summary")!;
  expect(getComputedStyle(s).color).toBe("rgb(9, 9, 9)");
});

async function settle(el: HTMLElement): Promise<void> {
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  await Promise.all(el.shadowRoot!.getAnimations().map((a) => a.finished));
}

function layout(el: HTMLElement) {
  const box = (selector: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
  const heading = box(".heading");
  const chevron = box(".chevron");
  const headingText = document.createRange();
  headingText.selectNodeContents(el.shadowRoot!.querySelector(".heading")!);
  return {
    headingLeft: heading.left,
    headingRight: headingText.getBoundingClientRect().right,
    headingTop: heading.top,
    chevronLeft: chevron.left,
    chevronRight: chevron.right,
    chevronTop: chevron.top,
    rowRight: box("button.header").right,
  };
}

test("the chevron follows the heading at desktop and phone widths", async () => {
  const el = await mount(
    '<wt-disclosure heading="Customer-facing names" summary="ES label"><p>body</p></wt-disclosure>',
  );
  for (const width of [600, 320]) {
    host.style.width = `${width}px`;
    const closed = layout(el);
    expect(closed.chevronLeft).toBeGreaterThanOrEqual(closed.headingRight);
    expect(closed.chevronLeft - closed.headingRight).toBeLessThanOrEqual(24);
    expect(closed.rowRight).toBe(el.getBoundingClientRect().right);
  }
});

test("a long heading wraps before its chevron leaves a phone-width row", async () => {
  const el = await mount(
    '<wt-disclosure heading="Catalán · Idioma predeterminado · Obligatorio" summary="Nada sin traducir"><p>body</p></wt-disclosure>',
  );
  host.style.width = "320px";
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  const chevron = el.shadowRoot!.querySelector<HTMLElement>(".chevron")!;
  expect(header.scrollWidth).toBe(header.clientWidth);
  expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(
    el.getBoundingClientRect().right,
  );
});

test("the heading and chevron stay where they are when the section opens, the header spans the host", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" summary="BAR · Starters"><p>body</p></wt-disclosure>',
  );
  const closed = layout(el);
  el.shadowRoot!.querySelector("button")!.click();
  await settle(el);
  const open = layout(el);
  expect(open).toEqual(closed);
  expect(closed.chevronLeft).toBeGreaterThanOrEqual(closed.headingRight);
  expect(closed.chevronLeft - closed.headingRight).toBeLessThanOrEqual(24);
  expect(closed.rowRight).toBe(el.getBoundingClientRect().right);
});

test("no border is drawn, closed or open", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" summary="BAR"><p>body</p></wt-disclosure>',
  );
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  const widths = () =>
    [".section", "button.header", ".body"].flatMap((selector) => {
      const style = getComputedStyle(el.shadowRoot!.querySelector(selector)!);
      return [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ];
    });
  expect(new Set(widths())).toEqual(new Set(["0px"]));
  (el as import("./wt-disclosure.js").WtDisclosure).open = true;
  await settle(el);
  expect(new Set(widths())).toEqual(new Set(["0px"]));
});

test("closed, the summary sits on its own line under the heading; open, the body shows instead", async () => {
  const el = await mount(
    '<wt-disclosure heading="Kitchen" summary="BAR · Starters"><p>body</p></wt-disclosure>',
  );
  const heading = el.shadowRoot!.querySelector(".heading")!.getBoundingClientRect();
  const summary = el.shadowRoot!.querySelector(".summary")!.getBoundingClientRect();
  expect(summary.top).toBeGreaterThanOrEqual(heading.bottom);
  expect(summary.left).toBe(heading.left);

  (el as import("./wt-disclosure.js").WtDisclosure).open = true;
  await settle(el);
  expect(el.shadowRoot!.querySelector(".summary")).toBeNull();
  expect((el.shadowRoot!.querySelector(".body") as HTMLElement).hidden).toBe(false);
});

test("the space that sets the section apart, and the heading's colour, read tokens", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  host.style.setProperty("--wt-space-3", "17px");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  const section = getComputedStyle(el.shadowRoot!.querySelector(".section")!);
  expect([section.paddingTop, section.paddingBottom]).toEqual(["17px", "17px"]);
  expect(getComputedStyle(el.shadowRoot!.querySelector(".heading")!).color).toBe("rgb(4, 5, 6)");
});

test("focusing the host delegates focus to the header button", async () => {
  // Without delegation the host itself becomes the active element and nothing inside the shadow
  // root is focused, which is the state every other interactive primitive here avoids.
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("button.header"));
});

test("a disclosure given no heading and no summary writes neither into the header", async () => {
  const el = await mount("<wt-disclosure><p>body</p></wt-disclosure>");
  expect(el.shadowRoot!.querySelector(".heading")!.textContent).toBe("");
  expect(el.shadowRoot!.querySelector(".summary")).toBeNull();
});

test("the header points at a body id that names this component, and two disclosures never share one", async () => {
  const first = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  const second = await mount('<wt-disclosure heading="Descriptors"><p>body</p></wt-disclosure>');
  const idOf = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLElement>(".body")!.id;
  for (const el of [first, second]) {
    expect(idOf(el)).toMatch(/^wt-disclosure-body-\d+$/);
    expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-controls")).toBe(idOf(el));
    // A body id has to survive being used as a selector, which not every legal HTML id does.
    expect(el.shadowRoot!.querySelector(`#${idOf(el)}`)).toBe(
      el.shadowRoot!.querySelector(".body"),
    );
  }
  expect(idOf(first)).not.toBe(idOf(second));
});

test("the header click stays inside the disclosure, so a listener above it sees only wt-toggle", async () => {
  const el = await mount('<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>');
  let clicks = 0;
  let toggles = 0;
  host.addEventListener("click", () => clicks++);
  host.addEventListener("wt-toggle", () => toggles++);
  el.shadowRoot!.querySelector("button")!.click();
  await (el as import("./wt-disclosure.js").WtDisclosure).updateComplete;
  expect(toggles).toBe(1);
  expect(clicks).toBe(0);
});

test("summary fields put each value after its bold name, joined with a middot, while closed", async () => {
  const el = (await mount(
    '<wt-disclosure heading="Pricing"><p>body</p></wt-disclosure>',
  )) as import("./wt-disclosure.js").WtDisclosure;
  el.summaryFields = [
    { label: "Base price", value: "€38.00 per kg" },
    { label: "VAT", value: "Reduced (10%)" },
  ];
  await el.updateComplete;
  host.style.setProperty("--wt-font-weight-bold", "800");
  const summary = el.shadowRoot!.querySelector(".summary")!;
  expect(summary.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Base price: €38.00 per kg · VAT: Reduced (10%)",
  );
  const names = [...summary.querySelectorAll(".summary-label")];
  expect(names.map((name) => name.textContent)).toEqual(["Base price:", "VAT:"]);
  expect(names.map((name) => getComputedStyle(name).fontWeight)).toEqual(["800", "800"]);
  // The values stay in the summary's own weight; only the names are bold.
  expect(getComputedStyle(summary).fontWeight).not.toBe("800");
  el.open = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary")).toBeNull();
});

test("summary fields win over a summary string given beside them", async () => {
  const el = (await mount(
    '<wt-disclosure heading="Pricing" summary="plain"><p>body</p></wt-disclosure>',
  )) as import("./wt-disclosure.js").WtDisclosure;
  el.summaryFields = [{ label: "VAT", value: "Reduced (10%)" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary")!.textContent!.trim()).toBe("VAT: Reduced (10%)");
  el.summaryFields = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary")!.textContent!.trim()).toBe("plain");
});

async function withRows(
  rows: readonly (import("./wt-disclosure.js").SummaryField & { lines: number })[],
  attributes = "",
) {
  const el = (await mount(
    `<wt-disclosure heading="Descriptors" ${attributes}><p>body</p></wt-disclosure>`,
  )) as import("./wt-disclosure.js").WtDisclosure;
  el.summaryRows = rows;
  await el.updateComplete;
  return el;
}

test("summary rows put each value after its bold name, one row under another, while closed", async () => {
  const el = await withRows([
    { label: "Name", value: "EN: Beef tenderloin · ES: Solomillo de ternera", lines: 1 },
    { label: "Description", value: "EN: Seared · ES: Sellado", lines: 2 },
  ]);
  host.style.setProperty("--wt-font-weight-bold", "800");
  const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".summary-row")];
  expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Name: EN: Beef tenderloin · ES: Solomillo de ternera",
    "Description: EN: Seared · ES: Sellado",
  ]);
  const names = rows.map((row) => row.querySelector(".summary-label")!);
  expect(names.map((name) => name.textContent)).toEqual(["Name:", "Description:"]);
  expect(names.map((name) => getComputedStyle(name).fontWeight)).toEqual(["800", "800"]);
  expect(getComputedStyle(rows[0]!).fontWeight).not.toBe("800");
  expect(rows[1]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    rows[0]!.getBoundingClientRect().bottom,
  );
  const heading = el.shadowRoot!.querySelector(".heading")!.getBoundingClientRect();
  expect(rows[0]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(heading.bottom);
  expect(rows[0]!.getBoundingClientRect().left).toBe(heading.left);

  el.open = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary-row")).toBeNull();
  expect(el.shadowRoot!.querySelector(".summary")).toBeNull();
});

test("summary rows paint from the muted-text token", async () => {
  const el = await withRows([{ label: "Name", value: "EN: Beef", lines: 1 }]);
  host.style.setProperty("--wt-color-text-muted", "rgb(9, 9, 9)");
  host.style.setProperty("--wt-font-size-sm", "11px");
  const row = el.shadowRoot!.querySelector(".summary-row")!;
  expect(getComputedStyle(row).color).toBe("rgb(9, 9, 9)");
  expect(getComputedStyle(row).fontSize).toBe("11px");
});

test("each summary row is cut with an ellipsis after its own number of lines, never widening the header", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const el = await withRows([
    { label: "Name", value: long, lines: 1 },
    { label: "Description", value: long, lines: 2 },
  ]);
  host.style.width = "320px";
  const [name, description] = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".summary-row")];
  const lineHeight = (row: HTMLElement) => {
    const probe = document.createRange();
    probe.selectNodeContents(row.querySelector(".summary-label")!);
    return probe.getBoundingClientRect().height;
  };
  for (const [row, lines] of [
    [name!, 1],
    [description!, 2],
  ] as const) {
    const style = getComputedStyle(row);
    expect(style.getPropertyValue("-webkit-line-clamp")).toBe(String(lines));
    // The text needs far more lines than the row shows, so a row that is not cut grows past this.
    expect(row.scrollHeight).toBeGreaterThan(row.clientHeight);
    expect(Math.round(row.clientHeight / lineHeight(row))).toBe(lines);
  }
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  expect(header.scrollWidth).toBe(header.clientWidth);
  expect(name!.getBoundingClientRect().right).toBeLessThanOrEqual(el.getBoundingClientRect().right);
});

test("an unbroken value is cut rather than widening a phone-width header", async () => {
  const el = await withRows([{ label: "Name", value: "x".repeat(400), lines: 1 }]);
  host.style.width = "320px";
  const row = el.shadowRoot!.querySelector<HTMLElement>(".summary-row")!;
  // Wrapped onto lines the clamp then cuts, so the ellipsis shows, rather than running off sideways.
  expect(row.scrollHeight).toBeGreaterThan(row.clientHeight);
  expect(row.scrollWidth).toBe(row.clientWidth);
  const header = el.shadowRoot!.querySelector<HTMLElement>("button.header")!;
  expect(header.scrollWidth).toBe(header.clientWidth);
  expect(el.getBoundingClientRect().width).toBe(320);
});

test("summary rows win over summary fields and a summary string given beside them", async () => {
  const el = await withRows([{ label: "Name", value: "EN: Beef", lines: 1 }], 'summary="plain"');
  el.summaryFields = [{ label: "VAT", value: "Reduced (10%)" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Name: EN: Beef",
  );
  el.summaryRows = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".summary")!.textContent!.trim()).toBe("VAT: Reduced (10%)");
});

/** Each shown value's text and whether it is drawn in italic. */
function valueStyles(line: Element): [string, string][] {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const shown: [string, string][] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent!.replace(/\s+/g, " ").trim();
    if (!text || text === "·" || node.parentElement!.classList.contains("summary-label")) continue;
    shown.push([text, getComputedStyle(node.parentElement!).fontStyle]);
  }
  return shown;
}

test("a summary field marked as a placeholder draws its value in italic, its name and the others upright", async () => {
  const el = (await mount(
    '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
  )) as import("./wt-disclosure.js").WtDisclosure;
  el.summaryFields = [
    { label: "Kitchen name", value: "GLS" },
    { label: "Course", value: "Mains", placeholder: true },
  ];
  await el.updateComplete;
  host.style.setProperty("--wt-color-text-muted", "rgb(9, 9, 9)");
  const summary = el.shadowRoot!.querySelector(".summary")!;
  expect(summary.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Kitchen name: GLS · Course: Mains",
  );
  expect(valueStyles(summary)).toEqual([
    ["GLS", "normal"],
    ["Mains", "italic"],
  ]);
  const names = [...summary.querySelectorAll(".summary-label")];
  expect(names.map((name) => getComputedStyle(name).fontStyle)).toEqual(["normal", "normal"]);
  const placeholder = summary.querySelector(".summary-placeholder")!;
  expect(getComputedStyle(placeholder).color).toBe("rgb(9, 9, 9)");
});

test("a summary row marked as a placeholder draws its value in italic, its name upright", async () => {
  const el = await withRows([
    { label: "Name", value: "EN: A glass", lines: 1 },
    { label: "Description", value: "EN: Roasted in house", lines: 2, placeholder: true },
  ]);
  const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".summary-row")];
  expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Name: EN: A glass",
    "Description: EN: Roasted in house",
  ]);
  expect(rows.map(valueStyles)).toEqual([
    [["EN: A glass", "normal"]],
    [["EN: Roasted in house", "italic"]],
  ]);
  expect(getComputedStyle(rows[1]!.querySelector(".summary-label")!).fontStyle).toBe("normal");
});
