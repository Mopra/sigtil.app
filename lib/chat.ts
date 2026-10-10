import type { UIMessage } from 'ai';

/** Fewest earlier turns the AI still sees once old ones are dropped. */
const MODEL_KEEP = 6;
/** Turns dropped at a time, so the history prefix (and its prompt cache) only changes every this many turns. */
const MODEL_STEP = 6;
/** Turns kept in the database; the editor scrolls back this far. */
const STORED_TURNS = 40;

/** Where each turn starts: a turn is a user message and the answer to it. */
function turnStarts(messages: UIMessage[]): number[] {
  return messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
}

/**
 * The part of the history sent to the AI: between MODEL_KEEP and
 * MODEL_KEEP + MODEL_STEP - 1 turns. Old turns go in blocks rather than one per
 * turn, so the cached prefix holds for MODEL_STEP turns before it is cut.
 */
export function forModel(messages: UIMessage[]): UIMessage[] {
  const starts = turnStarts(messages);
  const drop = Math.max(0, Math.floor((starts.length - MODEL_KEEP) / MODEL_STEP) * MODEL_STEP);
  return drop === 0 ? messages : messages.slice(starts[drop]);
}

/** The newest STORED_TURNS turns, as saved, without tool calls a cut-off turn left unanswered. */
export function forStorage(messages: UIMessage[]): UIMessage[] {
  const starts = turnStarts(messages);
  const kept = starts.length <= STORED_TURNS ? messages : messages.slice(starts[starts.length - STORED_TURNS]);
  return kept.map(m => ({ ...m, parts: m.parts.filter(finished) }));
}

function finished(part: UIMessage['parts'][number]): boolean {
  if (!('toolCallId' in part)) return true;
  return part.state === 'output-available' || part.state === 'output-error';
}

/** Only what was said: the fallback when stored tool calls no longer validate. */
export function textOnly(messages: UIMessage[]): UIMessage[] {
  return messages
    .map(m => ({ ...m, parts: m.parts.filter(p => p.type === 'text') }))
    .filter(m => m.parts.length > 0);
}
