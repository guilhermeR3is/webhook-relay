export type AttemptSequence<Attempt> = {
  number: number;
  resentAt: Date | null;
  attempts: Attempt[];
};

type ResendMarker = { requestedAt: Date; attemptsBefore: number };

// as tentativas chegam em ordem de início; cada reenvio diz quantas já existiam quando foi pedido
export function groupAttemptSequences<Attempt>(
  attempts: Attempt[],
  resends: ResendMarker[],
): AttemptSequence<Attempt>[] {
  if (attempts.length === 0 && resends.length === 0) return [];

  const starts = [
    { resentAt: null, from: 0 },
    ...resends.map((resend) => ({ resentAt: resend.requestedAt, from: resend.attemptsBefore })),
  ];
  return starts.map((start, index) => ({
    number: index + 1,
    resentAt: start.resentAt,
    attempts: attempts.slice(start.from, starts[index + 1]?.from),
  }));
}
