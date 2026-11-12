import { materialLibrary, resourceType, videoResourceTypes, type MaterialLibrary } from "../../shared/resources.mjs";
import type { MaterialItem, WorkspaceItem } from "./types";

export function placeUploadedMaterial(item: MaterialItem, library: MaterialLibrary): MaterialItem {
  const inferred = resourceType(item);
  // Lesson videos belong with learning; clearly named audio and templates belong
  // with video assets even when dropped on the learning screen.
  const type = item.purpose === "classroom" ? "lecture"
    : library === "video" ? videoResourceTypes.some(value => value.id === inferred) ? inferred : "template"
    : ["sound", "music", "template"].includes(inferred) ? inferred : "lecture";
  return { ...item, resourceType: type };
}

export function materialDestination(item: MaterialItem) {
  return item.purpose === "classroom" ? "projects" : item.purpose === "research" ? "research" : materialLibrary(item) === "video" ? "video" : "materials";
}

export function uploadedMaterialFocus(items: WorkspaceItem[], incomingIds: string[], knownIds: string[]) {
  const candidates = incomingIds.map(id => items.find(item => item.id === id && item.kind === "material")).filter((item): item is MaterialItem => item?.kind === "material");
  return candidates.find(item => !knownIds.includes(item.id)) ?? candidates[0];
}
