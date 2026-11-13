/** Display shelves are intentionally narrower than the stored legacy types. */
export const RESEARCH_SHELVES = ["보고서", "참고자료"] as const;
export type ResearchShelf = typeof RESEARCH_SHELVES[number];

/** Legacy plans, slides and appendices remain intact inside the reference shelf. */
export const researchShelf = (storedType?: string): ResearchShelf => storedType === "보고서" ? "보고서" : "참고자료";
