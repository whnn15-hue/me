import type {MaterialItem} from '../src/workspace/types';
export type ResourceType = 'lecture'|'sound'|'music'|'template'|'image'|'video'|'other';
export interface DriveQuota {used:number;limit:number|null;remaining:number|null}
export const resourceTypes: {id:ResourceType;label:string}[];
export const extraFileTypes: Record<string,string>;
export function audioName(name:string):boolean;
export function validExtraFile(extension:string,bytes:Uint8Array):boolean;
export function resourceType(item:Partial<MaterialItem>):ResourceType;
export function resourceLabel(item:Partial<MaterialItem>):string;
export function libraryStorage(items:MaterialItem[]):{bytes:number;files:number;unknown:number};
export function driveQuota(value:unknown):DriveQuota;
export function formatBytes(bytes:number):string;
