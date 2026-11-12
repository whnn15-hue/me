import type { Career, DocumentRecord } from '../src/types';
export const careerCategoryChoices: Career['category'][];
export const careerNavigationChoices: Career['category'][];
export function careerCollections(career: Career, documents?: DocumentRecord[]): ('secondment'|'writing'|'content')[];
export function careerCategoryLabel(career: Career, documents?: DocumentRecord[]): string;
export function matchesCareerCategory(career: Career, category: string, documents?: DocumentRecord[]): boolean;
export function recognitionDetails(career: Career): {level:string;grade:string;stages:string[]};
export interface RecognitionOutcome { level:string; stage:string; grade:string }
export function recognitionOutcomes(career: Career): RecognitionOutcome[];
export function recognitionLabels(career: Career): string[];
export function careerSection(career: Career, documents?: DocumentRecord[]): Career['category'];
export function careerOrganization(career: Career, documents?: DocumentRecord[]): string;
