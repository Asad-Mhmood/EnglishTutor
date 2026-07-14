import { CEFR_LEVELS, type CefrLevel } from './types';

/**
 * CEFR ↔ number, in their own module because both `analysis.ts` and `parameters.ts` need them
 * and `parameters.ts` cannot import from `analysis.ts` — analysis imports the registry, so the
 * dependency only runs one way.
 */

export function cefrToNumber(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level) + 1;
}

export function numberToCefr(value: number): CefrLevel {
  const index = Math.round(value) - 1;
  return CEFR_LEVELS[Math.min(Math.max(index, 0), CEFR_LEVELS.length - 1)];
}
