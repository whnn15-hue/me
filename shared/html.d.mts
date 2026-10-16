export function decodeHtml(bytes: Uint8Array | ArrayBuffer): string;
export function isHtmlBytes(bytes: Uint8Array): boolean;
export function htmlMetadata(source: string): { title: string; description: string; author: string; text: string };
