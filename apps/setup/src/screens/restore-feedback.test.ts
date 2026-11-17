import { describe, expect, it } from "vitest";
import { FormFeedback } from "@waitron/ui";
import { refusalShown, renewRefusal } from "./restore-feedback.js";

const feedbackWith = (...dismissed: ("refusal" | "field")[]): FormFeedback => {
  const feedback = new FormFeedback({
    addController: () => {},
    removeController: () => {},
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
  });
  feedback.dismiss(...dismissed);
  return feedback;
};

describe("renewRefusal", () => {
  it("a new message shows the refusal again but keeps the field's dismissal", () => {
    const feedback = feedbackWith("refusal", "field");
    renewRefusal(feedback, true, false);
    expect(refusalShown(feedback, "refusal")).toBe(true);
    expect(refusalShown(feedback, "field")).toBe(false);
  });

  it("a new field shows the field again but keeps the refusal's dismissal", () => {
    const feedback = feedbackWith("refusal", "field");
    renewRefusal(feedback, false, true);
    expect(refusalShown(feedback, "refusal")).toBe(false);
    expect(refusalShown(feedback, "field")).toBe(true);
  });

  it("a new message and field show both again", () => {
    const feedback = feedbackWith("refusal", "field");
    renewRefusal(feedback, true, true);
    expect(refusalShown(feedback, "refusal", "field")).toBe(true);
  });

  it("nothing new leaves both dismissals", () => {
    const feedback = feedbackWith("refusal", "field");
    renewRefusal(feedback, false, false);
    expect(refusalShown(feedback, "refusal")).toBe(false);
    expect(refusalShown(feedback, "field")).toBe(false);
  });

  it("keeps nothing that was not dismissed", () => {
    const feedback = feedbackWith();
    renewRefusal(feedback, true, false);
    expect(refusalShown(feedback, "refusal", "field")).toBe(true);
  });
});
