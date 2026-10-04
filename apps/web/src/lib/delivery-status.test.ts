import { describe, expect, it } from "vitest";
import {
  deliveryStatuses,
  describeDeliveries,
  isDeliveryStatus,
  totalDeliveries,
  type DeliveryCounts,
} from "./delivery-status";

const none: DeliveryCounts = { dead: 0, pending: 0, in_progress: 0, succeeded: 0 };

describe("describeDeliveries", () => {
  it("says there are no deliveries when every count is zero", () => {
    expect(describeDeliveries(none)).toBe("sem entregas");
  });

  it("uses the singular for one and the plural for the rest", () => {
    expect(describeDeliveries({ ...none, dead: 1, succeeded: 2 })).toBe("1 morta, 2 entregues");
  });

  it("keeps the same order as the strip, worst first, and skips zeros", () => {
    const counts = { dead: 1, pending: 3, in_progress: 1, succeeded: 4 };

    expect(describeDeliveries(counts)).toBe("1 morta, 3 pendentes, 1 em andamento, 4 entregues");
  });
});

describe("totalDeliveries", () => {
  it("adds every status", () => {
    expect(totalDeliveries({ dead: 1, pending: 2, in_progress: 3, succeeded: 4 })).toBe(10);
  });
});

describe("isDeliveryStatus", () => {
  it.each(deliveryStatuses)("accepts %s", (status) => {
    expect(isDeliveryStatus(status)).toBe(true);
  });

  it.each(["archived", "", "DEAD", undefined, 3])("refuses %s", (value) => {
    expect(isDeliveryStatus(value)).toBe(false);
  });
});
