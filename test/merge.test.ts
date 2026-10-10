import { describe, expect, it } from 'vitest';
import { isBinary, mergeText } from '@/lib/merge';

const lines = (...l: string[]) => l.join('\n');

describe('mergeText', () => {
  const base = lines('title', 'intro', 'body', 'footer');

  it('keeps changes to different lines from both sides', () => {
    const ours = lines('title', 'NEW intro', 'body', 'footer');
    const theirs = lines('title', 'intro', 'body', 'NEW footer');
    expect(mergeText(base, ours, theirs)).toBe(lines('title', 'NEW intro', 'body', 'NEW footer'));
  });

  it("lets the editor's version win where both changed the same line", () => {
    const ours = lines('title', 'editor intro', 'body', 'footer');
    const theirs = lines('title', 'developer intro', 'body', 'footer');
    expect(mergeText(base, ours, theirs)).toBe(ours);
  });

  it('keeps the rest of their changes around a conflict', () => {
    const ours = lines('title', 'editor intro', 'body', 'footer');
    const theirs = lines('title', 'developer intro', 'body', 'NEW footer');
    expect(mergeText(base, ours, theirs)).toBe(lines('title', 'editor intro', 'body', 'NEW footer'));
  });

  it('treats their change right next to a conflict as part of it, so the editor wins it too', () => {
    const ours = lines('title', 'editor intro', 'body', 'footer');
    const theirs = lines('NEW title', 'developer intro', 'body', 'footer');
    expect(mergeText(base, ours, theirs)).toBe(ours);
  });

  it('does not duplicate a change both sides made', () => {
    const both = lines('title', 'same intro', 'body', 'footer');
    expect(mergeText(base, both, both)).toBe(both);
  });

  it('returns ours when only ours changed, theirs when only theirs changed', () => {
    const changed = lines('title', 'intro', 'longer body', 'more', 'footer');
    expect(mergeText(base, changed, base)).toBe(changed);
    expect(mergeText(base, base, changed)).toBe(changed);
  });

  it('keeps lines added on both sides at different places', () => {
    const ours = lines('title', 'intro', 'editor line', 'body', 'footer');
    const theirs = lines('title', 'intro', 'body', 'footer', 'developer line');
    expect(mergeText(base, ours, theirs)).toBe(lines('title', 'intro', 'editor line', 'body', 'footer', 'developer line'));
  });

  it('keeps a deletion on one side and an edit elsewhere on the other', () => {
    const ours = lines('title', 'body', 'footer');
    const theirs = lines('title', 'intro', 'body', 'NEW footer');
    expect(mergeText(base, ours, theirs)).toBe(lines('title', 'body', 'NEW footer'));
  });

  it('keeps whitespace and indentation exactly', () => {
    const b = lines('<div>', '  <p>Hej</p>', '</div>', '');
    const o = lines('<div>', '  <p>Hej  med   dig</p>', '</div>', '');
    const t = lines('<main>', '<div>', '  <p>Hej</p>', '</div>', '');
    expect(mergeText(b, o, t)).toBe(lines('<main>', '<div>', '  <p>Hej  med   dig</p>', '</div>', ''));
  });

  it('merges against an empty base (file added on both sides): editor wins', () => {
    expect(mergeText('', 'mine', 'theirs')).toBe('mine');
  });

  it('keeps CRLF line endings', () => {
    const b = 'a\r\nb\r\nc\r\n';
    const o = 'A\r\nb\r\nc\r\n';
    const t = 'a\r\nb\r\nC\r\n';
    expect(mergeText(b, o, t)).toBe('A\r\nb\r\nC\r\n');
  });
});

describe('isBinary', () => {
  it('sees a NUL byte as binary', () => {
    expect(isBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
  });

  it('sees text, including Danish letters, as not binary', () => {
    expect(isBinary(Buffer.from('Æblegrød på øen', 'utf8'))).toBe(false);
  });

  it('only looks at the first 8000 bytes', () => {
    expect(isBinary(Buffer.concat([Buffer.alloc(8000, 'a'), Buffer.from([0])]))).toBe(false);
  });
});
