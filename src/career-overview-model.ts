import type { Career, DocumentRecord } from "./types";
import { careerCategoryChoices, careerOrganization, careerSection, recognitionDetails } from "../shared/career-organization.mjs";

export function careerOverview(careers:Career[], documents:DocumentRecord[], query="") {
  const terms = query.normalize("NFC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const documentIds = new Set(documents.map(document=>document.id));
  const rows = careers.map(career => {
    const category = careerSection(career,documents);
    const organization = careerOrganization(career,documents);
    const award = recognitionDetails(career);
    const year = /^(?:19|20|21)\d{2}(?:-|$)/.test(career.startDate) ? career.startDate.slice(0,4) : "연도 미입력";
    return {career,category,organization,award,year,evidence:career.documentIds.filter(id=>documentIds.has(id)).length};
  }).filter(row => {
    const value = [row.career.title,row.organization,row.career.role,row.career.description,row.category,row.year,...row.career.tags,row.award.grade,...row.award.stages].join(" ").normalize("NFC").toLocaleLowerCase();
    return terms.every(term=>value.includes(term));
  }).sort((a,b)=>a.year === b.year ? b.career.startDate.localeCompare(a.career.startDate) || a.career.title.localeCompare(b.career.title,"ko") : a.year === "연도 미입력" ? 1 : b.year === "연도 미입력" ? -1 : b.year.localeCompare(a.year));
  const years = [...new Set(rows.map(row=>row.year))];
  const categories = careerCategoryChoices.filter(category=>rows.some(row=>row.category===category));
  return {rows,years,categories};
}
