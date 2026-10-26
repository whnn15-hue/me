import type { PhotoItem, PhotoSlot, SubmissionItem } from "../workspace/types";

export const sceneGroups = {
  "활동": ["쓰기", "읽기", "발표", "토의", "만들기", "관찰", "실험", "기기 활용", "놀이", "감상"],
  "구성": ["개인", "짝", "모둠", "전체"],
  "도구": ["학습지", "공책", "포스트잇", "칠판", "태블릿", "노트북", "책", "작품"],
  "장소": ["교실", "도서관", "과학실", "체육관", "야외", "온라인"],
};
const aliases: Record<string, RegExp> = {
  "쓰기": /쓰기|글쓰|작성|일기|감상문|기록하기/, "읽기": /읽기|독서|낭독/, "발표": /발표|스피치|말하기/,
  "토의": /토의|토론|의견|협의/, "만들기": /만들기|제작|만들어/, "관찰": /관찰|탐색/, "실험": /실험/,
  "기기 활용": /디지털|태블릿|노트북|코딩|기기/, "놀이": /놀이|게임/, "감상": /감상/,
};
export function suggestSceneTags(text: string): string[] {
  const normalized = text.normalize("NFC");
  return [...new Set([...Object.entries(aliases).filter(([, pattern]) => pattern.test(normalized)).map(([tag]) => tag),
    ...Object.values(sceneGroups).flat().filter(tag => normalized.includes(tag))])].slice(0, 30);
}
/** Text cues are suggestions, never claims about what an image depicts. */
export function slotsFromBrief(text: string): PhotoSlot[] {
  const lines = text.normalize("NFC").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const explicit = lines.filter(line => /사진|장면|이미지|활동 과정/.test(line));
  const candidates = explicit.length ? explicit : lines.filter(line => suggestSceneTags(line).length);
  return [...new Set(candidates)].slice(0, 12).map(line => ({ id: crypto.randomUUID(), title: line.slice(0, 120),
    quote: line.slice(0, 2000), tags: suggestSceneTags(line), photoId: "", caption: "" }));
}
export function rankPhotos(photos: PhotoItem[], slot: PhotoSlot, excluded: string[] = []) {
  const wanted = [...new Set([...slot.tags, ...suggestSceneTags(slot.title)])];
  return photos.filter(photo => !excluded.includes(photo.id)).map(photo => {
    const matched = wanted.filter(tag => photo.tags.includes(tag));
    // A star cannot make an unrelated photo into a match. Usage never penalizes reuse.
    const score = matched.reduce((sum, tag) => sum + (sceneGroups.활동.includes(tag) ? 3 : 1), 0);
    return { photo, score, matched };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || b.photo.star - a.photo.star || a.photo.id.localeCompare(b.photo.id)).slice(0, 6);
}
export const submissionStatus = { preparing: "준비 중", submitted: "제출 완료", result: "결과 기록" };
export function photoUsage(photoId: string, submissions: SubmissionItem[]) {
  return submissions.flatMap(submission => submission.slots.filter(slot => slot.photoId === photoId).map(slot => ({ submission, slot })));
}
export function newSubmission(): SubmissionItem {
  return { id: "", kind: "submission", title: "", competition: "", year: "", tags: [], createdAt: "", updatedAt: "",
    status: "preparing", submittedOn: "", result: "", documentIds: [], brief: "", slots: [] };
}
export function safeFilename(value: string) {
  return value.normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").trim().slice(0, 100) || "사진";
}
