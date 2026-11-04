import { describe, expect, it } from "vitest";
import type { NodeDatabase } from "@waitron/db";
import { promotionTurn, recordOfferInTurn } from "./handover-promotion-turn.js";

const newBox = () => ({}) as unknown as NodeDatabase;
const OFFER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OFFER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const refusedAsRunning = (box: NodeDatabase) =>
  expect(recordOfferInTurn(box, OFFER, async () => "recorded")).rejects.toMatchObject({
    code: "handover.promotion_running",
  });
const recorded = (box: NodeDatabase) =>
  expect(recordOfferInTurn(box, OFFER, async () => "recorded")).resolves.toBe("recorded");

describe("the turn between a promotion and an offer", () => {
  it("an offer is refused from a promotion's claim until its release, without running", async () => {
    const box = newBox();
    const turn = promotionTurn(box);
    await recorded(box);
    turn.claim();
    let ran = false;
    await expect(
      recordOfferInTurn(box, OFFER, async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ code: "handover.promotion_running" });
    expect(ran).toBe(false);
    turn.release();
    await recorded(box);
  });

  it("a release with no claim leaves another promotion's claim standing", async () => {
    const box = newBox();
    const claimed = promotionTurn(box);
    claimed.claim();
    promotionTurn(box).release();
    await refusedAsRunning(box);
    claimed.release();
    await recorded(box);
  });

  it("a second claim by one request counts once, and a second release does nothing", async () => {
    const box = newBox();
    const other = promotionTurn(box);
    other.claim();
    const turn = promotionTurn(box);
    turn.claim();
    turn.claim();
    turn.release();
    turn.release();
    await refusedAsRunning(box);
    other.release();
    await recorded(box);
  });

  it("two promotions overlap: an offer waits for the last to finish", async () => {
    const box = newBox();
    const first = promotionTurn(box);
    const second = promotionTurn(box);
    first.claim();
    second.claim();
    first.release();
    await refusedAsRunning(box);
    second.release();
    await recorded(box);
  });

  it("a claim refused for an offer holds nothing afterwards", async () => {
    const box = newBox();
    let finish = (): void => undefined;
    const held = new Promise<void>((done) => {
      finish = done;
    });
    const recording = recordOfferInTurn(box, OFFER, () => held);
    const turn = promotionTurn(box);
    expect(() => turn.claim()).toThrowError(
      expect.objectContaining({
        code: "handover.operation_in_progress",
        params: { operationId: OFFER },
      }),
    );
    finish();
    await recording;
    turn.release();
    await recorded(box);
  });

  it("a claim names an offer still being recorded, and goes through once the last has finished", async () => {
    const box = newBox();
    const finish: Record<string, () => void> = {};
    const recording = (operationId: string) =>
      recordOfferInTurn(
        box,
        operationId,
        () =>
          new Promise<void>((done) => {
            finish[operationId] = done;
          }),
      );
    const first = recording(OFFER);
    const second = recording(OTHER_OFFER);

    finish[OFFER]!();
    await first;
    expect(() => promotionTurn(box).claim()).toThrowError(
      expect.objectContaining({ params: { operationId: OTHER_OFFER } }),
    );

    finish[OTHER_OFFER]!();
    await second;
    expect(() => promotionTurn(box).claim()).not.toThrow();
  });

  it("an offer that throws gives up its place, and the throw reaches the caller", async () => {
    const box = newBox();
    const failure = new Error("recording failed");
    await expect(
      recordOfferInTurn(box, OFFER, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(() => promotionTurn(box).claim()).not.toThrow();
  });

  it("each box has its own turn", async () => {
    const busy = newBox();
    promotionTurn(busy).claim();
    await refusedAsRunning(busy);
    await recorded(newBox());
  });
});
