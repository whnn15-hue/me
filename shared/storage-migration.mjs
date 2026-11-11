import { validGoogleDriveId, validOneDriveItemId } from './storage-id.mjs';

// Pure planning step for swapping Google Drive file IDs to verified OneDrive
// copies. A record is changed only when it still holds the Google ID that was
// copied and its SHA-256/size match the verified copy.
export function planFileIdSwap(documents, mapping) {
  const updates = [], skipped = [];
  for (const document of documents || []) {
    const target = mapping?.[document?.driveFileId];
    if (!target || !validGoogleDriveId(document.driveFileId)) continue;
    if (!validOneDriveItemId(target.id) || target.sha256 !== document.sha256 || (target.size !== undefined && target.size !== document.size)) { skipped.push(document.id); continue; }
    updates.push({ ...document, driveFileId: target.id });
  }
  return { updates, skipped };
}
