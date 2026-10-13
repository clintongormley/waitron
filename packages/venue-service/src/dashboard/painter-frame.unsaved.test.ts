import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import {
  applyTokens,
  draftScopeFor,
  LeaveController,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PainterFrame } from "./painter-frame.js";
import "./painter-frame.js";

/** A painter stand-in: it owns the draft, and the frame only asks its scope. */
class PainterHost extends LitElement {
  draft = "a";
  scope?: DraftScope<string>;
  coordinator?: LeaveCoordinator;
  override connectedCallback() {
    super.connectedCallback();
    const { scope, coordinator } = draftScopeFor(this, {
      id: {},
      current: () => this.draft,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.draft = value;
      },
    });
    scope.commit(this.draft);
    this.scope = scope;
    this.coordinator = coordinator;
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    super.disconnectedCallback();
  }
  edit(value: string) {
    this.draft = value;
    this.scope!.changed();
    this.requestUpdate();
  }
  override render() {
    return html`<painter-frame
      heading="Winter week"
      .open=${true}
      .scope=${this.scope}
      .dirty=${this.scope?.isDirty() ?? false}
      .coordinator=${this.coordinator}
      ><div>Grid</div></painter-frame
    >`;
  }
}
customElements.define("painter-frame-test-host", PainterHost);

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<button data-test="opener">Edit</button>${
        this.showing ? html`<painter-frame-test-host></painter-frame-test-host>` : null
      }${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
  showing = false;
}
customElements.define("painter-frame-test-app", PainterApp);

let app: PainterApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});

async function mount() {
  app = document.createElement("painter-frame-test-app") as PainterApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const opener = app.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=opener]")!;
  opener.focus();
  app.showing = true;
  app.requestUpdate();
  await app.updateComplete;
  const painter = app.shadowRoot!.querySelector<PainterHost>("painter-frame-test-host")!;
  await painter.updateComplete;
  const frame = painter.shadowRoot!.querySelector<PainterFrame>("painter-frame")!;
  await frame.updateComplete;
  return { painter, frame, opener };
}
const question = () =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>("wt-unsaved-changes")!;
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  await expect.poll(() => question().open).toBe(true);
  await question().updateComplete;
  question().shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question().open).toBe(false);
}
const button = (frame: PainterFrame, test: string) =>
  frame.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`)!;
function closed(frame: PainterFrame) {
  return new Promise<void>((resolve) =>
    frame.addEventListener("painter-close", () => resolve(), { once: true }),
  );
}

it.each([
  ["the close button", (frame: PainterFrame) => button(frame, "dismiss").click()],
  ["Cancel", (frame: PainterFrame) => button(frame, "cancel").click()],
  [
    "Escape",
    async (frame: PainterFrame) => {
      button(frame, "cancel").focus();
      await userEvent.keyboard("{Escape}");
    },
  ],
])("%s asks first when the draft changed; Keep stays, Discard closes", async (_name, act) => {
  const { painter, frame, opener } = await mount();
  painter.edit("b");
  await painter.updateComplete;
  await frame.updateComplete;
  expect(button(frame, "save").variant).toBe("primary");
  await act(frame);
  await choose("keep");
  expect(frame.open).toBe(true);
  expect(painter.draft).toBe("b");
  const close = closed(frame);
  await act(frame);
  await choose("discard");
  await close;
  expect(frame.open).toBe(false);
  expect(painter.draft).toBe("a");
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(opener);
});

it("an unchanged draft closes without asking", async () => {
  const { frame } = await mount();
  const close = closed(frame);
  button(frame, "dismiss").click();
  await close;
  expect(question().open).toBe(false);
  expect(frame.open).toBe(false);
});
