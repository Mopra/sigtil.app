/** The tool the fast model calls to pass a turn on to the strong model. */
export const HAND_OVER = 'handOver';

/** How many failed edits in one turn before the fast model is taken off the job. */
const MAX_FAILED_EDITS = 2;

/** The part of a finished step the choice of model depends on. */
export type RoutedStep = {
  toolCalls: ReadonlyArray<{ toolName: string }>;
  toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
};

/** editFile answers like this when the text it was asked to replace is missing or not unique. */
function isFailedEdit(result: { toolName: string; output: unknown }) {
  return result.toolName === 'editFile' && typeof result.output === 'string' && result.output.startsWith('The text to replace');
}

/**
 * Which model runs the next step of a chat turn. Most turns are small content
 * changes the cheap model does well, so it starts every turn except a repair,
 * where a change has already broken the site once. The strong model takes
 * over when the fast one asks for it, or keeps missing with its edits, and
 * then stays for the rest of the turn: going back would mean paying for two
 * models to read the same history.
 */
export function modelForStep(steps: ReadonlyArray<RoutedStep>, repair: boolean): 'fast' | 'strong' {
  if (repair) return 'strong';
  if (steps.some(s => s.toolCalls.some(c => c.toolName === HAND_OVER))) return 'strong';
  const failedEdits = steps.reduce((n, s) => n + s.toolResults.filter(isFailedEdit).length, 0);
  return failedEdits >= MAX_FAILED_EDITS ? 'strong' : 'fast';
}
