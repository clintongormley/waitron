import { describe, expect, it, vi } from "vitest";
import type { AllergyDish, AllergyPatch, PartyAllergyRead } from "@waitron/module";
import { prepareAllergySend } from "./party-allergy-flow.js";

const dish: AllergyDish = {
  line: { kind: "draft", id: "saved-1" },
  billId: "bill",
  name: "Toast",
  quantity: "2",
  allergens: { gluten: { kinds: ["wheat"] } },
  extras: [],
  sentAt: null,
  offeredBefore: false,
};
const view = (
  answer: null | "none" | "allergies",
  dishes: AllergyDish[] = [dish],
): PartyAllergyRead => ({
  partyId: "party",
  snapshot: { answer, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 8 },
  dishes,
});
const target = { kind: "draft" as const, draftId: "draft", lineIds: ["saved-1"] };
const opening = { key: "session/party/bill/visit/api/dialog", isCurrent: () => true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("A669 send preparation", () => {
  it.each([null, "allergies"] as const)(
    "asks for %s only after reading the full target",
    async (answer) => {
      const preview = deferred<PartyAllergyRead>();
      const api = { previewPartyAllergy: vi.fn().mockReturnValue(preview.promise) };
      const patch: AllergyPatch = { party: { answer: "none", guests: [] }, ticks: [] };
      const show = vi.fn().mockResolvedValue({ kind: "ready", patch });
      const result = prepareAllergySend(api, "party", target, opening, show);
      expect(show).not.toHaveBeenCalled();
      const read = view(answer);
      preview.resolve(read);
      expect(await result).toEqual({ kind: "ready", patch });
      expect(api.previewPartyAllergy).toHaveBeenCalledWith("party", target);
      expect(show).toHaveBeenCalledWith(read, opening.key);
    },
  );
  it.each([
    { answer: "none" as const, dishes: [dish] },
    { answer: "allergies" as const, dishes: [{ ...dish, offeredBefore: true }] },
    { answer: null, dishes: [] },
  ])("skips unnecessary questions for %j", async ({ answer, dishes }) => {
    const api = { previewPartyAllergy: vi.fn().mockResolvedValue(view(answer, dishes)) };
    const show = vi.fn();
    expect(await prepareAllergySend(api, "party", target, opening, show)).toEqual({
      kind: "ready",
    });
    expect(show).not.toHaveBeenCalled();
  });
  it("distinguishes a failed authoritative read from an unchanged ready answer", async () => {
    const show = vi.fn();
    expect(
      await prepareAllergySend(
        { previewPartyAllergy: vi.fn().mockRejectedValue({ code: "party.not_found" }) },
        "party",
        target,
        opening,
        show,
      ),
    ).toEqual({ kind: "unread" });
    expect(show).not.toHaveBeenCalled();
  });
  it("does no work for an expired opening", async () => {
    const api = { previewPartyAllergy: vi.fn() };
    const show = vi.fn();
    expect(
      await prepareAllergySend(api, "party", target, { ...opening, isCurrent: () => false }, show),
    ).toEqual({ kind: "cancelled" });
    expect(api.previewPartyAllergy).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
  it.each([false, true])("drops late preview success or failure (failure=%s)", async (failure) => {
    const pending = deferred<PartyAllergyRead>();
    let current = true;
    const show = vi.fn();
    const api = {
      previewPartyAllergy: vi.fn().mockImplementation(async () => {
        const answer = await pending.promise;
        if (failure) throw { code: "party.not_found" };
        return answer;
      }),
    };
    const result = prepareAllergySend(
      api,
      "party",
      target,
      { ...opening, isCurrent: () => current },
      show,
    );
    current = false;
    pending.resolve(view(null));
    expect(await result).toEqual({ kind: "cancelled" });
    expect(show).not.toHaveBeenCalled();
  });
  it("never forwards an old dialog confirmation to a new opening", async () => {
    const pending = deferred<{ kind: "ready"; patch: AllergyPatch }>();
    let current = true;
    const result = prepareAllergySend(
      { previewPartyAllergy: vi.fn().mockResolvedValue(view(null)) },
      "party",
      target,
      { ...opening, isCurrent: () => current },
      async () => {
        current = false;
        return pending.promise;
      },
    );
    pending.resolve({ kind: "ready", patch: { ticks: [] } });
    expect(await result).toEqual({ kind: "cancelled" });
  });
  it("preserves an explicit cancellation", async () => {
    expect(
      await prepareAllergySend(
        { previewPartyAllergy: vi.fn().mockResolvedValue(view(null)) },
        "party",
        target,
        opening,
        async () => ({ kind: "cancelled" }),
      ),
    ).toEqual({ kind: "cancelled" });
  });
});

it("does not use an ancestor party's replacement answer as authority for the old opening", async () => {
  const show = vi.fn();
  const changed = { ...view("none"), partyId: "surviving-party" };
  expect(
    await prepareAllergySend(
      { previewPartyAllergy: vi.fn().mockResolvedValue(changed) },
      "party",
      target,
      opening,
      show,
    ),
  ).toEqual({ kind: "unread" });
  expect(show).not.toHaveBeenCalled();
});
it("never sends a dialog failure as an unchanged successful answer", async () => {
  expect(
    await prepareAllergySend(
      { previewPartyAllergy: vi.fn().mockResolvedValue(view(null)) },
      "party",
      target,
      opening,
      async () => {
        throw new Error("dialog removed");
      },
    ),
  ).toEqual({ kind: "unread" });
});
it("cancels a dialog failure from an expired screen", async () => {
  let current = true;
  expect(
    await prepareAllergySend(
      { previewPartyAllergy: vi.fn().mockResolvedValue(view(null)) },
      "party",
      target,
      { ...opening, isCurrent: () => current },
      async () => {
        current = false;
        throw new Error("screen removed");
      },
    ),
  ).toEqual({ kind: "cancelled" });
});
