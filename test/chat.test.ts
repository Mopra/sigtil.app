import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { forModel, forStorage, textOnly } from '@/lib/chat';

/** `n` turns: a user message and an answer each. */
function turns(n: number): UIMessage[] {
  return Array.from({ length: n }, (_, i) => [
    { id: `u${i}`, role: 'user' as const, parts: [{ type: 'text' as const, text: `q${i}` }] },
    { id: `a${i}`, role: 'assistant' as const, parts: [{ type: 'text' as const, text: `a${i}` }] },
  ]).flat();
}

describe('forModel', () => {
  it('sends short conversations whole', () => {
    expect(forModel(turns(11))).toHaveLength(22);
  });

  it('drops old turns in blocks, starting on a user message', () => {
    const at12 = forModel(turns(12));
    expect(at12).toHaveLength(12);
    expect(at12[0].id).toBe('u6');
    // The first message stays put until a whole block more has been said.
    expect(forModel(turns(17))[0].id).toBe('u6');
    expect(forModel(turns(18))[0].id).toBe('u12');
  });
});

describe('forStorage', () => {
  it('keeps the newest 40 turns', () => {
    const kept = forStorage(turns(45));
    expect(kept).toHaveLength(80);
    expect(kept[0].id).toBe('u5');
  });

  it('drops tool calls left unanswered, keeps finished ones', () => {
    const msg = {
      id: 'a',
      role: 'assistant',
      parts: [
        { type: 'tool-readFile', toolCallId: '1', state: 'output-available', input: {}, output: 'x' },
        { type: 'tool-editFile', toolCallId: '2', state: 'input-available', input: {} },
        { type: 'text', text: 'ok' },
      ],
    } as unknown as UIMessage;
    expect(forStorage([msg])[0].parts.map(p => p.type)).toEqual(['tool-readFile', 'text']);
  });
});

describe('textOnly', () => {
  it('keeps what was said and drops messages left empty', () => {
    const msgs = [
      { id: 'a', role: 'assistant', parts: [{ type: 'tool-x', toolCallId: '1', state: 'output-available' }] },
      { id: 'b', role: 'user', parts: [{ type: 'text', text: 'hej' }] },
    ] as unknown as UIMessage[];
    expect(textOnly(msgs).map(m => m.id)).toEqual(['b']);
  });
});
