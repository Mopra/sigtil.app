import { describe, expect, it } from 'vitest';
import { HAND_OVER, modelForStep, type RoutedStep } from '@/lib/agent/route-model';

/** A finished step that called each tool once and got `output` back from it. */
function step(...calls: Array<[toolName: string, output: unknown]>): RoutedStep {
  return {
    toolCalls: calls.map(([toolName]) => ({ toolName })),
    toolResults: calls.map(([toolName, output]) => ({ toolName, output })),
  };
}

const NOT_FOUND = 'The text to replace was not found. Read the file again and retry with the exact current text.';
const NOT_UNIQUE = 'The text to replace appears 3 times. Include more surrounding context to make it unique.';
const SAVED = 'Saved. content/menu.mdx updated.';

describe('modelForStep', () => {
  it('starts an ordinary turn on the fast model', () => {
    expect(modelForStep([], false)).toBe('fast');
  });

  it('runs a repair on the strong model from the first step', () => {
    expect(modelForStep([], true)).toBe('strong');
    expect(modelForStep([step(['readFile', 'x'])], true)).toBe('strong');
  });

  it('stays on the fast model through ordinary steps', () => {
    const steps = [step(['searchFiles', 'a:1: x']), step(['readFile', 'x']), step(['editFile', SAVED])];
    expect(modelForStep(steps, false)).toBe('fast');
  });

  it('switches to the strong model after a hand-over', () => {
    expect(modelForStep([step(['listPages', '/']), step([HAND_OVER, 'Continue with the task.'])], false)).toBe('strong');
  });

  it('keeps the strong model for the rest of the turn', () => {
    const steps = [step([HAND_OVER, 'Continue with the task.']), step(['readFile', 'x']), step(['editFile', SAVED])];
    expect(modelForStep(steps, false)).toBe('strong');
  });

  it('switches on a hand-over called together with other tools', () => {
    expect(modelForStep([step(['readFile', 'x'], [HAND_OVER, 'Continue with the task.'])], false)).toBe('strong');
  });

  it('allows one failed edit', () => {
    expect(modelForStep([step(['editFile', NOT_FOUND]), step(['editFile', SAVED])], false)).toBe('fast');
  });

  it('switches after two failed edits, in one step or several', () => {
    expect(modelForStep([step(['editFile', NOT_FOUND]), step(['readFile', 'x']), step(['editFile', NOT_UNIQUE])], false)).toBe('strong');
    expect(modelForStep([step(['editFile', NOT_FOUND], ['editFile', NOT_FOUND])], false)).toBe('strong');
  });

  it('does not count refused edits or other tools as failed edits', () => {
    const steps = [
      step(['editFile', 'Refused: package.json is not an editable file on this site.']),
      step(['editFile', 'Refused: package.json is not an editable file on this site.']),
      step(['readFile', 'The text to replace is mentioned in this file']),
      step(['editFile', { odd: true }]),
    ];
    expect(modelForStep(steps, false)).toBe('fast');
  });
});
