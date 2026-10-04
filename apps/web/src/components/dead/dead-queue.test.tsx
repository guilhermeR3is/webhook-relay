// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeadDelivery } from "@/lib/dead-deliveries";
import type { BatchResendResult } from "@/lib/resend";
import { DeadQueue } from "./dead-queue";
import { resendBatchAction } from "./resend-batch-action";

vi.mock("./resend-batch-action", () => ({ resendBatchAction: vi.fn() }));

const actionMock = vi.mocked(resendBatchAction);

afterEach(() => {
  cleanup();
  actionMock.mockReset();
});

const now = new Date("2026-10-04T15:00:00Z");

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <p>tela de erro</p> : this.props.children;
  }
}

function delivery(id: string, eventType = `evento.${id}`): DeadDelivery {
  return {
    id,
    eventId: `e-${id}`,
    eventType,
    destination: { id: `x-${id}`, displayUrl: `https://${id}.example.com/hook` },
    attemptCount: 8,
    lastError: "destination answered 503, gave up after 8 attempts",
    createdAt: new Date("2026-10-04T14:50:00Z"),
    lastAttempt: { startedAt: new Date("2026-10-04T14:59:00Z"), durationMs: 120, httpStatus: 503 },
  };
}

const three = [delivery("a"), delivery("b"), delivery("c")];

function queue(deliveries: DeadDelivery[], firstPage = true) {
  return <DeadQueue deliveries={deliveries} now={now} firstPage={firstPage} />;
}

function done(resent: string[]): BatchResendResult {
  return { kind: "done", resent, skipped: [] };
}

const rowBox = (eventType: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^Selecionar ${eventType} `) });
const headerBox = () => screen.getByRole("checkbox", { name: /Selecionar todas desta página/ });
const resendButton = () => screen.getByRole("button", { name: /^Reenviar( \d+)?$/ });

function deferred() {
  let settle: (result: BatchResendResult) => void = () => undefined;
  const promise = new Promise<BatchResendResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("DeadQueue, the empty states", () => {
  it("says the queue is empty on the first page, without the toolbar", () => {
    render(queue([]));

    expect(screen.getByRole("heading", { name: "Nenhuma entrega morta" })).not.toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reenviar/ })).toBeNull();
  });

  it("says there are no more on a later page", () => {
    render(queue([], false));

    expect(
      screen.getByRole("heading", { name: "Não há mais entregas mortas nesta página" }),
    ).not.toBeNull();
  });
});

describe("DeadQueue, the selection", () => {
  it("starts with nothing selected and the resend button disabled", () => {
    render(queue(three));

    expect(screen.getByText("Nenhuma selecionada")).not.toBeNull();
    expect((resendButton() as HTMLButtonElement).disabled).toBe(true);
    expect(headerBox().getAttribute("aria-checked")).toBe("false");
  });

  it("counts what is selected, in the singular and the plural, and puts the number on the button", async () => {
    const user = userEvent.setup();
    render(queue(three));

    await user.click(rowBox("evento.a"));
    expect(screen.getByText("1 selecionada")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reenviar 1" })).not.toBeNull();

    await user.click(rowBox("evento.c"));
    expect(screen.getByText("2 selecionadas")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reenviar 2" })).not.toBeNull();
  });

  it("marks the header as mixed while part of the page is selected, and checked when all are", async () => {
    const user = userEvent.setup();
    render(queue(three));

    await user.click(rowBox("evento.a"));
    expect(headerBox().getAttribute("aria-checked")).toBe("mixed");

    await user.click(rowBox("evento.b"));
    await user.click(rowBox("evento.c"));
    expect(headerBox().getAttribute("aria-checked")).toBe("true");
  });

  it("selects the whole page from the header, and clears it on the second click", async () => {
    const user = userEvent.setup();
    render(queue(three));

    await user.click(headerBox());
    expect(screen.getByText("3 selecionadas")).not.toBeNull();

    await user.click(headerBox());
    expect(screen.getByText("Nenhuma selecionada")).not.toBeNull();
  });

  it("selects all from the header even when only part was selected", async () => {
    const user = userEvent.setup();
    render(queue(three));
    await user.click(rowBox("evento.b"));

    await user.click(headerBox());

    expect(screen.getByText("3 selecionadas")).not.toBeNull();
  });

  it("drops from the selection a delivery that left the list", async () => {
    const user = userEvent.setup();
    const { rerender } = render(queue(three));
    await user.click(rowBox("evento.a"));
    await user.click(rowBox("evento.b"));

    rerender(queue([delivery("b"), delivery("c")]));

    expect(screen.getByText("1 selecionada")).not.toBeNull();
  });
});

describe("DeadQueue, the confirmation", () => {
  async function selectAndOpen(user: ReturnType<typeof userEvent.setup>, eventTypes: string[]) {
    for (const eventType of eventTypes) await user.click(rowBox(eventType));
    await user.click(resendButton());
    return screen.findByRole("alertdialog");
  }

  it("asks before sending and says what each destination will receive", async () => {
    const user = userEvent.setup();
    render(queue(three));

    const dialog = await selectAndOpen(user, ["evento.a", "evento.b"]);

    expect(dialog.textContent).toContain("Reenviar 2 entregas?");
    expect(dialog.textContent).toContain(
      "Cada destino vai receber o mesmo corpo e o mesmo webhook-id",
    );
    expect(dialog.textContent).toContain("assinatura e horário novos");
    expect(dialog.textContent).toContain(
      "As entregas voltam para a fila e cada uma começa uma nova sequência",
    );
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("uses the singular for one delivery", async () => {
    const user = userEvent.setup();
    render(queue(three));

    const dialog = await selectAndOpen(user, ["evento.a"]);

    expect(dialog.textContent).toContain("Reenviar 1 entrega?");
    expect(dialog.textContent).toContain("O destino vai receber o mesmo corpo");
    expect(dialog.textContent).toContain("A entrega volta para a fila e começa uma nova sequência");
  });

  it("puts the focus on Cancelar and sends nothing when cancelled", async () => {
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a"]);
    expect(document.activeElement?.textContent).toBe("Cancelar");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(actionMock).not.toHaveBeenCalled();
    expect(screen.getByText("1 selecionada")).not.toBeNull();
  });

  it("sends the selected ids in the order of the list, not of the clicks", async () => {
    actionMock.mockResolvedValue(done(["a", "c"]));
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.c", "evento.a"]);

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 2" }),
    );
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledTimes(1);
    });

    expect(actionMock).toHaveBeenCalledWith(["a", "c"]);
  });

  it("shows the summary, closes the dialog and clears the selection after the batch", async () => {
    actionMock.mockResolvedValue(done(["a", "b"]));
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a", "evento.b"]);

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 2" }),
    );

    expect(await screen.findByRole("heading", { name: "2 entregas reenviadas" })).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(screen.getByText("Nenhuma selecionada")).not.toBeNull();
  });

  it("names each skipped delivery with its reason, using the rows that were on screen", async () => {
    actionMock.mockResolvedValue({
      kind: "done",
      resent: ["a"],
      skipped: [{ id: "b", reason: "destination_inactive" }],
    });
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a", "evento.b"]);

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 2" }),
    );

    const heading = await screen.findByRole("heading", { name: "1 reenviada, 1 não reenviada" });
    const summary = heading.closest("section");
    expect(summary?.textContent).toContain("evento.b");
    expect(summary?.textContent).toContain("https://b.example.com/hook");
    expect(summary?.textContent).toContain("O destino está desativado");
  });

  it("keeps the summary when the list becomes empty after the batch", async () => {
    actionMock.mockResolvedValue(done(["a"]));
    const user = userEvent.setup();
    const { rerender } = render(queue([delivery("a")]));
    await selectAndOpen(user, ["evento.a"]);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );
    await screen.findByRole("heading", { name: "1 entrega reenviada" });

    rerender(queue([]));

    expect(screen.getByRole("heading", { name: "1 entrega reenviada" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Nenhuma entrega morta" })).not.toBeNull();
  });

  it("lets the person close the summary", async () => {
    actionMock.mockResolvedValue(done(["a"]));
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a"]);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );
    await screen.findByRole("heading", { name: "1 entrega reenviada" });

    await user.click(screen.getByRole("button", { name: "Fechar resumo" }));

    expect(screen.queryByRole("heading", { name: "1 entrega reenviada" })).toBeNull();
  });

  it("holds the dialog open and blocks a second click while it sends", async () => {
    const pending = deferred();
    actionMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a"]);

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );
    const sending = await screen.findByRole<HTMLButtonElement>("button", { name: "Reenviando…" });
    await user.click(sending);
    await user.keyboard("{Escape}");

    expect(sending.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancelar" }).disabled).toBe(true);
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    expect(actionMock).toHaveBeenCalledTimes(1);

    pending.settle(done(["a"]));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("says the API did not answer and lets the person try again", async () => {
    actionMock.mockResolvedValueOnce({ kind: "unavailable" }).mockResolvedValueOnce(done(["a"]));
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a"]);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("A API não respondeu");
    expect(screen.getByText("1 selecionada")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByRole("heading", { name: "1 entrega reenviada" })).not.toBeNull();
    expect(actionMock).toHaveBeenCalledTimes(2);
  });

  it("forgets the failure when the dialog is opened again", async () => {
    actionMock.mockResolvedValue({ kind: "unavailable" });
    const user = userEvent.setup();
    render(queue(three));
    await selectAndOpen(user, ["evento.a"]);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );
    await user.click(await screen.findByRole("button", { name: "Fechar" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    await user.click(resendButton());

    expect(await screen.findByRole("alertdialog")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets an unexpected error reach the error boundary instead of hiding it", async () => {
    actionMock.mockRejectedValue(new Error("boom"));
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<Boundary>{queue(three)}</Boundary>);
    await selectAndOpen(user, ["evento.a"]);

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reenviar 1" }),
    );

    expect(await screen.findByText("tela de erro")).not.toBeNull();
    noise.mockRestore();
  });
});
