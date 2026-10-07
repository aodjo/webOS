import { describe, expect, it } from 'vitest';
import { NEW_NOTE, dateGroup, fileNameForTitle, listDate, noteSnippet, noteTitle, parseNote, plainLine, serializeNote, uniqueNameExcept } from './model';

describe('parseNote / serializeNote', () => {
  it('round-trips a markdown note', () => {
    const src = '# Ideas\n\n- Add `neofetch` ✅\n- Spaces next?\n';
    const p = parseNote(src);
    expect(p).toEqual({ title: 'Ideas', body: '- Add `neofetch` ✅\n- Spaces next?\n', prefix: '# ', sep: '\n\n' });
    expect(serializeNote(p)).toBe(src);
  });

  it('round-trips a plain text note with a single newline separator', () => {
    const src = 'Groceries\n- milk\n- eggs';
    const p = parseNote(src);
    expect(p.title).toBe('Groceries');
    expect(p.prefix).toBe('');
    expect(serializeNote(p)).toBe(src);
  });

  it('skips leading blank lines and handles empty content', () => {
    expect(parseNote('\n\n  \n## Title\nbody').title).toBe('Title');
    expect(parseNote('')).toMatchObject({ title: '', body: '' });
    expect(serializeNote({ ...NEW_NOTE })).toBe('');
  });

  it('writes a title-only note and uses the body as title when the title is empty', () => {
    expect(serializeNote({ ...NEW_NOTE, title: 'Hello' })).toBe('# Hello\n');
    expect(serializeNote({ ...NEW_NOTE, body: 'first line\nsecond' })).toBe('first line\nsecond');
  });

  it('extracts title and snippet', () => {
    const src = '# 아이디어\n\n- [ ] **터미널**에 `neofetch` 넣기\n';
    expect(noteTitle(src)).toBe('아이디어');
    expect(noteSnippet(src)).toBe('터미널에 neofetch 넣기');
    expect(noteSnippet('# Only title')).toBe('');
  });
});

describe('plainLine', () => {
  it('removes markdown syntax', () => {
    expect(plainLine('## A [link](http://x) and ![img](a.png)')).toBe('A link and img');
    expect(plainLine('1. *em* text')).toBe('em text');
  });
});

describe('fileNameForTitle', () => {
  it('sanitizes and falls back', () => {
    expect(fileNameForTitle('a/b: c', 'md', 'New Note')).toBe('a-b- c.md');
    expect(fileNameForTitle('   ', 'md', 'New Note')).toBe('New Note.md');
    expect(fileNameForTitle('..hidden', 'txt', 'x')).toBe('hidden.txt');
    expect(fileNameForTitle('x'.repeat(100), 'md', 'n')).toHaveLength(64 + 3);
  });
});

describe('uniqueNameExcept', () => {
  const taken = new Set(['Foo.md', 'Foo 2.md']);
  it('keeps its own name instead of hopping', () => {
    expect(uniqueNameExcept('Foo.md', (n) => taken.has(n), 'Foo 2.md')).toBe('Foo 2.md');
  });
  it('picks the next free name', () => {
    expect(uniqueNameExcept('Foo.md', (n) => taken.has(n), 'Bar.md')).toBe('Foo 3.md');
    expect(uniqueNameExcept('Baz.md', (n) => taken.has(n), 'Bar.md')).toBe('Baz.md');
  });
});

describe('dates', () => {
  const now = new Date(2026, 9, 2, 15, 4).getTime();
  it('groups by recency', () => {
    expect(dateGroup(now - 60_000, now, 'en').key).toBe('today');
    expect(dateGroup(new Date(2026, 9, 1, 9).getTime(), now, 'en').key).toBe('yesterday');
    expect(dateGroup(new Date(2026, 8, 28).getTime(), now, 'ko').label).toBe('이전 7일');
    expect(dateGroup(new Date(2026, 8, 10).getTime(), now, 'en').label).toBe('Previous 30 Days');
    expect(dateGroup(new Date(2026, 0, 15).getTime(), now, 'en').label).toBe('January');
    expect(dateGroup(new Date(2025, 5, 1).getTime(), now, 'ko').label).toBe('2025년');
  });
  it('formats list dates', () => {
    expect(listDate(new Date(2026, 9, 1, 9).getTime(), now, 'en')).toBe('Yesterday');
    expect(listDate(new Date(2026, 9, 1, 9).getTime(), now, 'ko')).toBe('어제');
    expect(listDate(new Date(2026, 0, 15).getTime(), now, 'en')).toBe('1/15/26');
  });
});
