import { Fragment } from "react";
import { StatusMark } from "@/components/status-mark";
import { barRatio, formatSpan, isSuccessStatus } from "@/lib/attempts";
import type { AttemptDetail, AttemptSequence } from "@/lib/event-detail";
import { formatEventTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Since = { at: Date; label: "anterior" | "reenvio" };

function Station({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("absolute left-0 bg-card", className)}>{children}</span>;
}

function AttemptRow({
  attempt,
  number,
  since,
  longestMs,
  showDay,
}: {
  attempt: AttemptDetail;
  number: number;
  since: Since | null;
  longestMs: number;
  showDay: boolean;
}) {
  const succeeded = isSuccessStatus(attempt.httpStatus);
  const time = formatEventTime(attempt.startedAt);
  const detail = attempt.error ?? attempt.responseSnippet;

  return (
    <li className="relative py-3 pl-8">
      <Station className="top-[1.1rem]">
        <StatusMark status={succeeded ? "succeeded" : "dead"} />
      </Station>
      <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 md:grid-cols-[6.5rem_6rem_minmax(0,1fr)]">
        <div className="text-sm tabular-nums">
          <span className="sr-only">Tentativa {number}: </span>
          <time dateTime={attempt.startedAt.toISOString()} title={time.full}>
            {showDay ? `${time.dayMonth} ` : ""}
            {time.clock}
          </time>
          {since && (
            <span
              className="block text-xs text-muted-foreground"
              title={`${formatSpan(attempt.startedAt.getTime() - since.at.getTime())} depois d${since.label === "reenvio" ? "o reenvio" : "a tentativa anterior"}`}
            >
              +{formatSpan(attempt.startedAt.getTime() - since.at.getTime())}
            </span>
          )}
        </div>
        <div className="text-sm font-medium tabular-nums">
          {attempt.httpStatus ?? (
            <span className="font-normal text-muted-foreground">sem resposta</span>
          )}
        </div>
        <div className="col-span-2 flex items-center gap-3 md:col-span-1">
          <span className="h-2 flex-1 rounded-full bg-muted" aria-hidden="true">
            <span
              className={cn(
                "block h-full rounded-full",
                succeeded ? "bg-state-succeeded" : "bg-state-dead",
              )}
              style={{ width: `${String(barRatio(attempt.durationMs, longestMs) * 100)}%` }}
            />
          </span>
          <span className="w-16 text-right text-xs tabular-nums">
            <span className="sr-only">Duração: </span>
            {formatSpan(attempt.durationMs)}
          </span>
        </div>
      </div>
      {detail && (
        <p className="mt-2 max-h-24 overflow-auto rounded-sm bg-muted px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap">
          <span className="sr-only">{attempt.error ? "Erro: " : "Resposta: "}</span>
          {detail}
        </p>
      )}
    </li>
  );
}

export function AttemptTimeline({
  sequences,
  receivedAt,
}: {
  sequences: AttemptSequence[];
  receivedAt: Date;
}) {
  const longestMs = Math.max(
    0,
    ...sequences.flatMap((sequence) => sequence.attempts.map((attempt) => attempt.durationMs)),
  );
  const receivedDay = formatEventTime(receivedAt).dayMonth;

  return (
    <ol
      aria-label="Tentativas de envio"
      className="relative before:absolute before:top-5 before:bottom-5 before:left-[5.5px] before:w-px before:bg-border"
    >
      {sequences.map((sequence) => {
        const resentAt = sequence.resentAt;
        return (
          <Fragment key={sequence.number}>
            {resentAt && (
              <li className="relative py-2 pl-8 text-sm">
                <Station className="top-1/2 -translate-y-1/2">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </Station>
                Reenviada em{" "}
                <time dateTime={resentAt.toISOString()} className="tabular-nums">
                  {formatEventTime(resentAt).dayMonth} {formatEventTime(resentAt).clock}
                </time>
              </li>
            )}
            {sequence.attempts.length === 0 ? (
              <li className="relative py-3 pl-8 text-sm text-muted-foreground">
                <Station className="top-[1.1rem]">
                  <StatusMark status="pending" />
                </Station>
                Aguardando a primeira tentativa
              </li>
            ) : (
              sequence.attempts.map((attempt, index) => {
                const previous = sequence.attempts[index - 1];
                const since: Since | null = previous
                  ? { at: previous.startedAt, label: "anterior" }
                  : resentAt
                    ? { at: resentAt, label: "reenvio" }
                    : null;
                return (
                  <AttemptRow
                    key={attempt.id}
                    attempt={attempt}
                    number={index + 1}
                    since={since}
                    longestMs={longestMs}
                    showDay={formatEventTime(attempt.startedAt).dayMonth !== receivedDay}
                  />
                );
              })
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
