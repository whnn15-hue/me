// File IDs stored in records are either Google Drive file IDs or Microsoft
// OneDrive driveItem IDs (personal accounts use forms such as
// "0123456789ABCDEF!1234"). Ownership is always verified with the provider,
// so this check only bounds the value before it is placed in a URL path.
const GOOGLE_DRIVE_ID = /^[A-Za-z0-9_-]{8,200}$/;
const ONEDRIVE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9!._-]{7,249}$/;
export const validGoogleDriveId = value => typeof value === 'string' && GOOGLE_DRIVE_ID.test(value);
export const validOneDriveItemId = value => typeof value === 'string' && ONEDRIVE_ITEM_ID.test(value) && !value.includes('..');
export const validStorageFileId = value => validGoogleDriveId(value) || validOneDriveItemId(value);

// OneDrive Personal returns item descriptions HTML-entity encoded
// ("{" → "&#123;", '"' → "&quot;", ":" → "&#58;"). Decode before parsing.
const NAMED_ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
export const decodeHtmlEntities = value => String(value ?? '').replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(quot|amp|lt|gt|apos));/gi, (match, decimal, hex, named) => {
  if (named) return NAMED_ENTITIES[named.toLowerCase()];
  const code = decimal ? Number(decimal) : parseInt(hex, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
});
