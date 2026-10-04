// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("pulses, and stays still for people who asked for less motion", () => {
    const { container } = render(<Skeleton />);

    const block = container.firstElementChild;
    expect(block?.classList).toContain("animate-pulse");
    expect(block?.classList).toContain("motion-reduce:animate-none");
  });
});
