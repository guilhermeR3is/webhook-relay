// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_MARKS, StationStrip } from "./station-strip";

afterEach(cleanup);

const none = { dead: 0, pending: 0, in_progress: 0, succeeded: 0 };

function markStatuses(container: HTMLElement) {
  return [...container.querySelectorAll("svg[data-status]")].map((mark) =>
    mark.getAttribute("data-status"),
  );
}

describe("StationStrip", () => {
  it("says so in words when the event has no deliveries", () => {
    render(<StationStrip counts={none} />);

    expect(screen.getByText("sem entregas")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("describes the deliveries to a screen reader", () => {
    render(<StationStrip counts={{ ...none, dead: 1, succeeded: 2 }} />);

    expect(screen.getByRole("img", { name: "1 morta, 2 entregues" })).not.toBeNull();
  });

  it("draws one mark per delivery, worst state first", () => {
    const { container } = render(
      <StationStrip counts={{ dead: 1, pending: 1, in_progress: 1, succeeded: 2 }} />,
    );

    expect(markStatuses(container)).toEqual([
      "dead",
      "pending",
      "in_progress",
      "succeeded",
      "succeeded",
    ]);
  });

  it("stops at the limit and counts the rest, keeping the worst states visible", () => {
    const { container } = render(
      <StationStrip counts={{ ...none, dead: 2, succeeded: MAX_MARKS + 4 }} />,
    );

    const statuses = markStatuses(container);
    expect(statuses).toHaveLength(MAX_MARKS);
    expect(statuses.filter((status) => status === "dead")).toHaveLength(2);
    expect(screen.getByText("+6")).not.toBeNull();
  });

  it("does not draw thousands of marks for thousands of deliveries", () => {
    const { container } = render(<StationStrip counts={{ ...none, succeeded: 5000 }} />);

    expect(markStatuses(container)).toHaveLength(MAX_MARKS);
    expect(screen.getByText("+4.992")).not.toBeNull();
  });

  it("shows no counter when every delivery fits", () => {
    render(<StationStrip counts={{ ...none, succeeded: MAX_MARKS }} />);

    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
