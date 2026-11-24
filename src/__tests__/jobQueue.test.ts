import { describe, it, expect, vi } from "vitest";
import { AsyncJobQueue, recoverStuckWishes } from "../services/jobQueue.service";
import Wish from "../models/Wish";

describe("Task 4: Async Job Queue & Recovery", () => {
  it("processes asynchronous jobs sequentially with concurrency 1", async () => {
    const queue = new AsyncJobQueue();
    const order: number[] = [];

    await new Promise<void>((resolve) => {
      queue.push(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      });

      queue.push(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      });

      queue.push(async () => {
        order.push(3);
        resolve();
      });
    });

    expect(order).toEqual([1, 2, 3]);
  });

  it("recovers stuck wishes older than 15 minutes", async () => {
    const updateManySpy = vi.spyOn(Wish, "updateMany").mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 2,
      modifiedCount: 2,
      upsertedCount: 0,
      upsertedId: null,
    } as any);

    const count = await recoverStuckWishes();
    expect(count).toBe(2);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ["image", "video", "queued"] },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "failed",
        }),
      })
    );

    updateManySpy.mockRestore();
  });
});
