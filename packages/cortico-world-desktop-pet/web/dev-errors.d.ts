export interface Problem {
  file: string | null;
  line: number | null;
  message: string;
}
export const MAX_PROBLEMS: number;
export const MESSAGE_MAX: number;
export const CLIP_MAX: number;
export const CLIP_MIN: number;
export function problemsIn(output: string): Problem[];
export function looksLikeError(text: unknown): boolean;
