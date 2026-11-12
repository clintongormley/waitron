import { LitElement, html, nothing, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { afterEach, expect, it } from "vitest";
import * as ui from "./index.js";
import { cleanup, mount } from "./test-helpers.js";

class FeedbackHost extends LitElement {
  feedback?: ui.FormFeedback;
  @property({ attribute: false }) errors: Record<string, string> = {};
  @property({ type: Boolean }) showInvalid = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errors")) this.feedback?.newRefusal();
  }

  override render() {
    return html`<output>${this.feedback?.attempted ? "attempted" : "quiet"}</output>
      <p>${Object.values(this.feedback?.remaining(this.errors) ?? this.errors).join(" | ")}</p>
      ${this.showInvalid ? html`<input aria-invalid="true" />` : nothing}`;
  }
}
customElements.define("test-form-feedback", FeedbackHost);
afterEach(cleanup);

async function mountFeedback(): Promise<FeedbackHost & { feedback: ui.FormFeedback }> {
  const host = (await mount("<test-form-feedback></test-form-feedback>")) as FeedbackHost & {
    feedback: ui.FormFeedback;
  };
  host.feedback = new ui.FormFeedback(host);
  return host;
}

it("repaints attempts and selectively clears refusals on edits, retries and reset", async () => {
  const host = await mountFeedback();
  host.errors = { name: "Taken name", email: "Taken email", _form: "Try again" };
  await host.updateComplete;
  const root = host.shadowRoot!;
  expect(root.querySelector("output")!.textContent).toBe("quiet");
  expect(root.querySelector("p")!.textContent).toBe("Taken name | Taken email | Try again");

  host.feedback.dismiss("name");
  await host.updateComplete;
  expect(root.querySelector("p")!.textContent).toBe("Taken email | Try again");
  host.feedback.press("_form");
  await host.updateComplete;
  expect(root.querySelector("output")!.textContent).toBe("attempted");
  expect(root.querySelector("p")!.textContent).toBe("Taken email");

  host.feedback.newRefusal();
  await host.updateComplete;
  expect(root.querySelector("output")!.textContent).toBe("attempted");
  expect(root.querySelector("p")!.textContent).toBe("Taken name | Taken email | Try again");
  host.feedback.dismiss("email");
  host.feedback.reset();
  await host.updateComplete;
  expect(root.querySelector("output")!.textContent).toBe("quiet");
  expect(root.querySelector("p")!.textContent).toBe("Taken name | Taken email | Try again");
  expect(host.feedback.remaining({ name: "", email: undefined })).toEqual({
    name: "",
    email: undefined,
  });
});

it("revives an identical refusal only when the caller receives a new object", async () => {
  const host = await mountFeedback();
  const errors = { name: "Taken name" };
  host.errors = errors;
  await host.updateComplete;
  host.feedback.dismiss("name");
  await host.updateComplete;
  expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("");
  host.errors = errors;
  host.requestUpdate();
  await host.updateComplete;
  expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("");
  host.errors = { name: "Taken name" };
  await host.updateComplete;
  expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("Taken name");
});

it("waits for the host render before resolving the focus root and returns the focused field", async () => {
  const host = await mountFeedback();
  host.showInvalid = true;
  const focused = await host.feedback.focus(() => host.shadowRoot!);
  const input = host.shadowRoot!.querySelector("input")!;
  expect(input).not.toBeNull();
  expect(focused).toBe(input);
  expect(host.shadowRoot!.activeElement).toBe(input);
});

it("joins nonempty message parts in the caller's order", () => {
  expect(ui.bottomMessage(null, "", "Request refused.", "Correct the fields.", "")).toBe(
    "Request refused. Correct the fields.",
  );
});
