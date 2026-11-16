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
  return slim(drop === 0 ? messages : messages.slice(starts[drop]));
}

/**
 * Earlier answers as the AI gets them: what it said, not what it read or did.
 * File contents and search results from old turns were nearly all of the
 * prompt, and paid for again on every turn. In their place, the next user
 * message names the files the answer changed, so a follow-up ("gør den
 * kortere") still knows where to look. Built from the saved history alone, so
 * it comes out the same on every turn and the prompt cache keeps hitting.
 */
function slim(messages: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  let changed: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      changed.push(...changedFiles(m));
      const parts = m.parts.filter(p => p.type === 'text');
      if (parts.length > 0) out.push({ ...m, parts });
    } else if (m.role === 'user' && changed.length > 0) {
      const note = `[Files changed in your previous answer: ${[...new Set(changed)].join(', ')}]`;
      out.push({ ...m, parts: [{ type: 'text', text: note }, ...m.parts] });
      changed = [];
    } else {
      out.push(m);
    }
  }
  return out;
}

/** Paths an answer wrote to, read off its finished tool calls. */
function changedFiles(message: UIMessage): string[] {
  return message.parts.flatMap(part => {
    const p = part as { type: string; state?: string; input?: unknown; output?: unknown };
    if (p.state !== 'output-available' || typeof p.output !== 'string') return [];
    const input = (p.input ?? {}) as { path?: unknown; moves?: unknown };
    if (p.type === 'tool-editFile' && p.output.startsWith('Saved')) return typeof input.path === 'string' ? [input.path] : [];
    if (p.type === 'tool-createFile' && p.output.startsWith('Created')) return typeof input.path === 'string' ? [input.path] : [];
    if (p.type === 'tool-moveFiles' && p.output.startsWith('Moved') && Array.isArray(input.moves)) {
      return input.moves.flatMap(mv => (typeof mv?.to === 'string' ? [mv.to] : []));
    }
    return [];
  });
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
