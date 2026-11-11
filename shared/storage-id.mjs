// File IDs stored in records are either Google Drive file IDs or Microsoft
// OneDrive driveItem IDs (personal accounts use forms such as
// "0123456789ABCDEF!1234"). Ownership is always verified with the provider,
// so this check only bounds the value before it is placed in a URL path.
const GOOGLE_DRIVE_ID = /^[A-Za-z0-9_-]{8,200}$/;
const ONEDRIVE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9!._-]{7,249}$/;
export const validGoogleDriveId = value => typeof value === 'string' && GOOGLE_DRIVE_ID.test(value);
export const validOneDriveItemId = value => typeof value === 'string' && ONEDRIVE_ITEM_ID.test(value) && !value.includes('..');
export const validStorageFileId = value => validGoogleDriveId(value) || validOneDriveItemId(value);
