import { beforeEach, describe, expect, it } from 'vitest';
import { localizePeriod, useBadges, useWM } from '@/kernel';
import { SEED_IDS, buildSeedMessages } from './seed';
import { ME, formatAddresses, isValidEmail, parseAddresses, unreadInboxCount, useMail } from './store';

/**
 * Resets the Mail store to a fresh state before each test.
 *
 * Clears all seeded-message state and visitor messages, re-dates the seed to now and
 * resets the last-checked time, so every test starts with all seeded messages unread
 * in the Inbox.
 *
 * @returns {void}
 *
 * @example
 * beforeEach(reset);
 */
const reset = () => useMail.setState({ seed: {}, messages: [], seededAt: Date.now(), lastChecked: 0 });

describe('mail store', () => {
  beforeEach(reset);

  it('parses and formats address lists', () => {
    expect(parseAddresses('Ann <ann@x.com>, bob@y.com; ')).toEqual([
      { name: 'Ann', email: 'ann@x.com' },
      { name: '', email: 'bob@y.com' },
    ]);
    expect(formatAddresses(parseAddresses('"Ann" <ann@x.com>,bob@y.com'))).toBe('Ann <ann@x.com>, bob@y.com');
    expect(isValidEmail('hello@example.com')).toBe(true);
    expect(isValidEmail('nope@')).toBe(false);
  });

  it('generates localized seed messages', () => {
    const en = buildSeedMessages('en', 1_000_000_000, ME);
    const ko = buildSeedMessages('ko', 1_000_000_000, ME);
    expect(en.map((m) => m.id)).toEqual([...SEED_IDS]);
    expect(en[0].subject).not.toBe(ko[0].subject);
    expect(en.find((m) => m.id === 'resume')?.attachments?.[0].name).toBe('Resume.md');
    expect(ko.find((m) => m.id === 'resume')?.attachments?.[0].name).toBe('이력서.md');
  });

  it('localizes an open-ended experience period', () => {
    expect(localizePeriod('2024 — Present', 'ko')).toBe('2024 — 현재');
    expect(localizePeriod('2024 — present', 'en')).toBe('2024 — Present');
    expect(localizePeriod('2023 — 2024', 'ko')).toBe('2023 — 2024');
    const ko = buildSeedMessages('ko', 1_000_000_000, ME).find((m) => m.id === 'resume')!;
    expect(ko.body).not.toMatch(/present/i);
  });

  it('counts unread inbox messages and follows read / trash state', () => {
    expect(unreadInboxCount(useMail.getState())).toBe(SEED_IDS.length);
    useMail.getState().update('welcome', { read: true });
    useMail.getState().trash('projects');
    expect(unreadInboxCount(useMail.getState())).toBe(SEED_IDS.length - 2);
    expect(useMail.getState().seed.projects).toMatchObject({ mailbox: 'trash', trashedFrom: 'inbox' });
    useMail.getState().eraseTrash();
    expect(useMail.getState().seed.projects?.mailbox).toBe('deleted');
  });

  it('keeps drafts and replaces them when sent', () => {
    const id = useMail.getState().saveDraft({ to: 'a@b.co', subject: 'Hi', body: 'Hello' });
    expect(useMail.getState().messages).toHaveLength(1);
    expect(useMail.getState().saveDraft({ to: 'a@b.co', subject: 'Hi!', body: 'Hello' }, id)).toBe(id);
    expect(useMail.getState().messages).toHaveLength(1);
    useMail.getState().send({ to: 'a@b.co', subject: 'Hi!', body: 'Hello' }, id);
    const msgs = useMail.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].mailbox).toBe('sent');
    expect(msgs[0].to).toEqual([{ name: '', email: 'a@b.co' }]);
  });

  it('shows the unread count on the Dock only while Mail runs', () => {
    useWM.setState({ processes: [{ pid: 1, appId: 'mail', startedAt: 0, hidden: false }] });
    expect(useBadges.getState().badges.mail).toBe(String(SEED_IDS.length));
    useMail.getState().update('contact', { read: true });
    expect(useBadges.getState().badges.mail).toBe(String(SEED_IDS.length - 1));
    useWM.setState({ processes: [] });
    expect(useBadges.getState().badges.mail).toBeUndefined();
  });
});
