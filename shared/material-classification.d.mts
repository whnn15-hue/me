import type { MaterialItem } from '../src/workspace/types';
export const materialSubjects: string[];
export const materialTrainings: string[];
export function inferMaterialClassification(value?:string): {subjects:string[];trainings:string[]};
export function materialClassification(item:MaterialItem): {subjects:string[];trainings:string[]};
export function materialFileFormat(name:string): MaterialItem['format'];
export function materialDraft(name:string,text?:string,purpose?:'lecture'|'classroom'): Omit<MaterialItem,'id'|'createdAt'|'updatedAt'>;
