import type { ReactNode } from "react";
import { TokenChip } from "./Chips";

/** Renders a redacted log line with each Aran placeholder such as <MOBILE:vec884105dc> as a token chip. Text only, no data is changed. */
export function LogLine({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /<([A-Z_]+):([^>\s]+)>/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<TokenChip key={m.index} title={`${m[1]!.toLowerCase()} token`}>{m[0]}</TokenChip>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
