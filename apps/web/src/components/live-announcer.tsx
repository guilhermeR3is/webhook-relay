"use client";

import { useState } from "react";

// fica montado mesmo quando a página para de se atualizar: o aviso do estado final não pode sumir junto com o LiveRefresh
export function LiveAnnouncer({ report }: { report: string }) {
  const [seen, setSeen] = useState(report);
  const [message, setMessage] = useState("");

  if (seen !== report) {
    setSeen(report);
    setMessage(`Atualizado: ${report}.`);
  }

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}
