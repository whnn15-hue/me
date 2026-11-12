import { careerCategoryChoices, careerOrganization, careerSection } from "../../shared/career-organization.mjs";
import type { Career, DocumentRecord } from "../types";

export const growthColors = ["#3c9a83", "#8198c2", "#b393ca", "#d7a362", "#6d9fa8", "#ad91a1", "#cb8b75", "#8caa76", "#939d9b"];
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function growthModel(careers: Career[], documents: DocumentRecord[], today: string) {
  const entries = careers.map(career => ({ career, section: careerSection(career, documents), year: /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(career.startDate) ? Number(career.startDate.slice(0, 4)) : 0 }));
  const dated = entries.filter(entry => entry.year > 0 && entry.career.startDate <= today);
  const future = entries.filter(entry => entry.year > 0 && entry.career.startDate > today);
  const unknown = entries.filter(entry => !entry.year);
  const currentYear = Number(today.slice(0, 4));
  const recordedYears = [...new Set(dated.map(entry => entry.year))].sort((a, b) => a - b);
  const firstYear = recordedYears[0] ?? currentYear;
  // Extremely old imported years must not expand the interface without bounds.
  const years = currentYear - firstYear <= 150 ? Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i) : [...new Set([...recordedYears, currentYear])];
  let cumulative = 0;
  const series = years.map(year => {
    const records = dated.filter(entry => entry.year === year);
    cumulative += records.length;
    return { year, count: records.length, cumulative, records: records.map(entry => entry.career) };
  });
  const categories = careerCategoryChoices.map((category, index) => ({ category, color: growthColors[index], count: entries.filter(entry => entry.section === category).length })).filter(item => item.count > 0);
  const organizations = new Set(dated.map(entry => careerOrganization(entry.career, documents)).filter(name => name !== "기관 미입력"));
  return { dated, future, unknown, series, categories, organizations: organizations.size, total: dated.length };
}

/** A stable 2020-to-present timeline, including quiet empty years. Older dated
 * activity stays accessible separately and contributes to actual cumulative totals. */
export function growthJourney(model: ReturnType<typeof growthModel>, today: string) {
  const currentYear = Number(today.slice(0, 4));
  const startYear = Math.min(2020, currentYear);
  const earlier = model.series.filter(point => point.year < startYear && point.count > 0);
  let cumulative = earlier.reduce((sum, point) => sum + point.count, 0);
  const points = Array.from({ length: currentYear - startYear + 1 }, (_, index) => {
    const year = startYear + index;
    const records = model.dated.filter(entry => entry.year === year).map(entry => entry.career);
    cumulative += records.length;
    return { year, count: records.length, cumulative, records };
  });
  return { points, earlier, first: model.dated.length ? Math.min(...model.dated.map(entry => entry.year)) : null,
    latest: model.dated.length ? Math.max(...model.dated.map(entry => entry.year)) : null };
}
