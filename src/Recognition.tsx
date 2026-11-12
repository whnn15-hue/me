import type { Career } from "./types";
import { careerSection, recognitionOutcomes } from "../shared/career-organization.mjs";
import { displayText } from "./display";

/** Scope and result belong together; never repeat a combined scope heading. */
export default function Recognition({ career }: { career: Career }) {
  const category = careerSection(career);
  if (!["연구대회", "공모전 수상"].includes(category)) return null;
  const outcomes = recognitionOutcomes(career);
  if (!outcomes.length) return null;
  return <span className="recognition-badges" aria-label={`${category} 결과`}>
    {outcomes.map(({level,stage,grade}, index) => <span className={`recognition-outcome ${level === "전국" ? "national" : ""}`} key={`${level}-${stage}-${grade}-${index}`}>
      {(level || stage) && <span className="recognition-scope">{[level,stage].filter(Boolean).map(displayText).join(" ")}</span>}
      {grade && <strong>{displayText(grade)}</strong>}
    </span>)}
  </span>;
}
