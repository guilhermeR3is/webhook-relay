import { Fragment } from "react";

// quebra a URL só depois das barras, para "destino-1" não ser cortado no meio
export function BreakableUrl({ url }: { url: string }) {
  const parts = url.split("/");
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}
