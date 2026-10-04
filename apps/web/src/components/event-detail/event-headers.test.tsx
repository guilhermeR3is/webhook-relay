// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EventHeaders } from "./event-headers";

afterEach(cleanup);

describe("EventHeaders", () => {
  it("lists each header with its value", () => {
    render(
      <EventHeaders headers={{ "content-type": "application/json", "x-event-type": "push" }} />,
    );

    expect(screen.getByText("content-type").nextElementSibling?.textContent).toBe(
      "application/json",
    );
    expect(screen.getByText("x-event-type").nextElementSibling?.textContent).toBe("push");
  });

  it("says none was kept when there are no headers", () => {
    render(<EventHeaders headers={{}} />);

    expect(screen.getByText("Nenhum cabeçalho foi guardado para este evento.")).not.toBeNull();
    expect(screen.queryByRole("term")).toBeNull();
  });
});
