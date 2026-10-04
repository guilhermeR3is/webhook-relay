// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTestEvent, type TestEventResult } from "@/lib/test-event";
import { SendTestEvent } from "./send-test-event";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/test-event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/test-event")>()),
  sendTestEvent: vi.fn(),
}));

const sendMock = vi.mocked(sendTestEvent);

afterEach(() => {
  cleanup();
  sendMock.mockReset();
  push.mockReset();
});

function show() {
  render(<SendTestEvent apiUrl="https://api.example.com" />);
}

function deferred() {
  let settle: (result: TestEventResult) => void = () => undefined;
  const promise = new Promise<TestEventResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

const button = () => screen.getByRole("button", { name: /Enviar evento de teste|Enviando/ });

describe("SendTestEvent", () => {
  it("offers the button and says the limits of the test, before anything is clicked", () => {
    show();

    expect(screen.getByRole("button", { name: "Enviar evento de teste" })).not.toBeNull();
    expect(
      screen.getByText("Limite: 5 por hora por visitante e 200 por dia no total."),
    ).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends to the API address it was given, once, and goes to the event it created", async () => {
    sendMock.mockResolvedValue({ kind: "sent", eventId: "0199a3b4" });
    const user = userEvent.setup();
    show();

    await user.click(button());

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/events/0199a3b4");
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("https://api.example.com");
  });

  it("blocks a second click while it sends, and stays blocked once it is going to the event", async () => {
    const pending = deferred();
    sendMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    show();

    await user.click(button());
    const sending = screen.getByRole<HTMLButtonElement>("button", { name: "Enviando…" });
    await user.click(sending);
    expect(sending.disabled).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    pending.settle({ kind: "sent", eventId: "e1" });
    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Enviando…" }).disabled).toBe(
      true,
    );
  });

  it("says the visitor quota is over and when to try again, and lets the person click again", async () => {
    sendMock.mockResolvedValue({
      kind: "quota",
      scope: "ip",
      limit: 5,
      retryAt: new Date("2026-10-03T17:00:00Z"),
    });
    const user = userEvent.setup();
    show();

    await user.click(button());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Você já enviou 5 eventos de teste nesta hora. Tente de novo às 14:00.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Enviar evento de teste" }).disabled,
    ).toBe(false);
  });

  it("says the quota of the day is over", async () => {
    sendMock.mockResolvedValue({
      kind: "quota",
      scope: "global",
      limit: 200,
      retryAt: new Date("2026-10-04T00:00:00Z"),
    });
    const user = userEvent.setup();
    show();

    await user.click(button());

    expect((await screen.findByRole("alert")).textContent).toContain(
      "O limite de 200 eventos de teste por dia",
    );
  });

  it("says the API did not answer, and any other failure with its code", async () => {
    sendMock
      .mockResolvedValueOnce({ kind: "unavailable" })
      .mockResolvedValueOnce({ kind: "failed", status: 500 });
    const user = userEvent.setup();
    show();

    await user.click(button());
    expect((await screen.findByRole("alert")).textContent).toContain("A API não respondeu");
    await user.click(button());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("código 500");
    });
  });

  it("clears the old problem as soon as a new attempt starts", async () => {
    const second = deferred();
    sendMock.mockResolvedValueOnce({ kind: "unavailable" }).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    show();
    await user.click(button());
    await screen.findByRole("alert");

    await user.click(button());

    expect(screen.queryByRole("alert")).toBeNull();
    second.settle({ kind: "sent", eventId: "e1" });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/events/e1");
    });
  });
});
