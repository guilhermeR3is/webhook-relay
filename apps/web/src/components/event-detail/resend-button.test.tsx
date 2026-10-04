// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResendResult } from "@/lib/resend";
import { ResendButton } from "./resend-button";
import { resendDeliveryAction } from "./resend-action";

vi.mock("./resend-action", () => ({ resendDeliveryAction: vi.fn() }));

const actionMock = vi.mocked(resendDeliveryAction);

afterEach(() => {
  cleanup();
  actionMock.mockReset();
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <p>tela de erro</p> : this.props.children;
  }
}

function show() {
  render(<ResendButton deliveryId="d1" destination="https://hooks.example.com/webhook/…" />);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Reenviar para / }));
  return screen.findByRole("alertdialog");
}

function deferred() {
  let settle: (result: ResendResult) => void = () => undefined;
  const promise = new Promise<ResendResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("ResendButton", () => {
  it("starts with only the button, named after the destination", () => {
    show();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reenviar para https://hooks.example.com/webhook/…" }),
    ).not.toBeNull();
  });

  it("asks before sending and says what the destination will receive", async () => {
    const user = userEvent.setup();
    show();

    const dialog = await openDialog(user);

    expect(dialog.textContent).toContain("Reenviar esta entrega?");
    expect(dialog.textContent).toContain("https://hooks.example.com/webhook/…");
    expect(dialog.textContent).toContain("o mesmo corpo e o mesmo webhook-id");
    expect(dialog.textContent).toContain("assinatura e horário novos");
    expect(dialog.textContent).toContain("nova sequência");
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("puts the focus on Cancelar, so the safe answer is the one Enter gives", async () => {
    const user = userEvent.setup();
    show();

    await openDialog(user);

    expect(document.activeElement?.textContent).toBe("Cancelar");
  });

  it("closes without sending when the person cancels", async () => {
    const user = userEvent.setup();
    show();
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("resends the delivery once on confirm and closes", async () => {
    actionMock.mockResolvedValue("resent");
    const user = userEvent.setup();
    show();
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(actionMock).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledWith("d1");
  });

  it("holds the dialog open and blocks a second click while it sends", async () => {
    const pending = deferred();
    actionMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    show();
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Reenviar" }));
    const sending = await screen.findByRole<HTMLButtonElement>("button", { name: "Reenviando…" });
    await user.click(sending);
    await user.keyboard("{Escape}");

    expect(sending.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancelar" }).disabled).toBe(true);
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    expect(actionMock).toHaveBeenCalledTimes(1);

    pending.settle("resent");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("explains a deactivated destination and offers only to close", async () => {
    actionMock.mockResolvedValue("destination_inactive");
    const user = userEvent.setup();
    show();
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("desativado");
    expect(alert.textContent).toContain("410");
    expect(screen.getByRole("button", { name: "Fechar" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reenviar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("says the API did not answer and lets the person try again", async () => {
    actionMock.mockResolvedValueOnce("unavailable").mockResolvedValueOnce("resent");
    const user = userEvent.setup();
    show();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("A API não respondeu");
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(actionMock).toHaveBeenCalledTimes(2);
  });

  it.each(["not_dead", "not_found"] as const)(
    "closes after %s without a message, because the reloaded page shows what happened",
    async (result) => {
      actionMock.mockResolvedValue(result);
      const user = userEvent.setup();
      show();
      await openDialog(user);

      await user.click(screen.getByRole("button", { name: "Reenviar" }));

      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
      });
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("forgets an old failure when the dialog is opened again", async () => {
    actionMock.mockResolvedValue("destination_inactive");
    const user = userEvent.setup();
    show();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Reenviar" }));
    await user.click(await screen.findByRole("button", { name: "Fechar" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    await openDialog(user);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Reenviar" })).not.toBeNull();
  });

  it("lets an unexpected error reach the error boundary instead of hiding it", async () => {
    actionMock.mockRejectedValue(new Error("boom"));
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(
      <Boundary>
        <ResendButton deliveryId="d1" destination="https://hooks.example.com/webhook/…" />
      </Boundary>,
    );
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(await screen.findByText("tela de erro")).not.toBeNull();
    noise.mockRestore();
  });
});
