import { StatusMark } from "@/components/status-mark";
import type { TrackMark } from "@/lib/circuit";

function EmptyMark() {
  return <span className="size-3 shrink-0 rounded-full border-[1.5px] border-input" />;
}

// o texto ao lado diz o mesmo que o trilho, então ele fica fora do leitor de tela
export function CircuitTrack({ marks }: { marks: readonly TrackMark[] }) {
  return (
    <span aria-hidden="true" data-track className="inline-flex items-center">
      {marks.map((mark, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 && <span className="h-px w-2 bg-border" />}
          {mark === "failure" && <StatusMark status="dead" />}
          {mark === "testing" && <StatusMark status="in_progress" />}
          {mark === "empty" && <EmptyMark />}
        </span>
      ))}
    </span>
  );
}
