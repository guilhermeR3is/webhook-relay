// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";

afterEach(cleanup);

function openDialog() {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Reenviar?</AlertDialogTitle>
        <AlertDialogDescription>Texto</AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>,
  );
  return screen.getByRole("alertdialog");
}

describe("AlertDialog", () => {
  it("enters in 200 ms and leaves faster, in 150 ms, with the strong ease-out", () => {
    const dialog = openDialog();

    expect(dialog.classList).toContain("duration-200");
    expect(dialog.classList).toContain("data-closed:duration-150");
    expect(dialog.classList).toContain("ease-out-strong");
  });

  it("fades and grows from 95%, and keeps the fade but drops the growth for less motion", () => {
    const dialog = openDialog();

    expect(dialog.classList).toContain("data-open:fade-in-0");
    expect(dialog.classList).toContain("motion-safe:data-open:zoom-in-95");
    expect(dialog.classList).toContain("data-closed:fade-out-0");
    expect(dialog.classList).toContain("motion-safe:data-closed:zoom-out-95");
  });
});
