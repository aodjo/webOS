/**
 * Notification banners (top-right) and Notification Center (right-side panel with notifications
 * grouped by app, then widgets).
 *
 * The kernel decides which notifications are bannered and dismisses banners after 5s; this
 * module adds the presentation: slide in/out, holding a banner while the pointer is over it,
 * clearing, and the collapsed/expanded app stacks of Notification Center.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { X } from 'lucide-react';
import type { LString, Notification } from '@/kernel/types';
import { getApp } from '@/kernel/registry';
import { dismissBanner, markAllRead, removeNotification, useNotifications } from '@/kernel/notifications';
import { useUI } from '@/kernel/ui';
import { useLocale, useT } from '@/kernel/i18n';
import { MENU_BAR_HEIGHT } from '@/kernel/constants';
import { osInfo } from '@/data/portfolio';
import { OSLogo } from '@/icons';
import { Z } from '../layers';
import { relativeTime } from './format';
import { useCloseOnSessionEnd, useDismiss, useNow, usePresence } from './hooks';
import { useAdaptiveTone } from './adaptiveTone';
import { Widgets } from './Widgets';
import styles from './Notifications.module.css';

const S = {
  title: { en: 'Notification Center', ko: '알림 센터' },
  banners: { en: 'Notifications', ko: '알림' },
  none: { en: 'No Notifications', ko: '알림 없음' },
  close: { en: 'Close', ko: '닫기' },
  clear: { en: 'Clear', ko: '지우기' },
  clearAll: { en: 'Clear All', ko: '모두 지우기' },
  showLess: { en: 'Show Less', ko: '간단히 보기' },
  more: { en: '{n} more notifications', ko: '알림 {n}개 더 보기' },
} satisfies Record<string, LString>; /** Localized strings for the banners and Notification Center. */

const MAX_BANNERS = 4; /** Banners visible at once; older ones wait (and expire) behind them. */

/**
 * Joins CSS class names, skipping falsy entries.
 *
 * Lets callers write conditional classes inline (`cond && styles.x`): `false`, `null`,
 * `undefined` and empty strings are dropped before the rest are joined with spaces.
 *
 * @param {...(string | false | null | undefined)} c - Class names or falsy placeholders.
 * @returns {string} The space-separated class list.
 *
 * @example
 * cx(styles.banner, leaving && styles.leaving); // "banner leaving" or "banner"
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const GLASS = 'lg lg-thick'; /** Thick Liquid Glass classes (styles/glass.css) for every card and button that carries text over the desktop. */

/**
 * Closes Notification Center.
 *
 * Clears the `notificationCenter` flag in the UI store; the panel then plays its exit animation
 * and unmounts.
 *
 * @returns {void}
 *
 * @example
 * <Widgets onDone={closeCenter} />
 */
const closeCenter = () => useUI.getState().set({ notificationCenter: false });

/* ───────────────────────── Shared pieces ───────────────────────── */

/**
 * Renders an app's icon for a notification.
 *
 * Uses the icon component registered for the app; notifications from unknown apps (or apps
 * without an icon) get a generic gray tile with the OS logo at 55% of the tile size.
 *
 * @param {Object} props - Component props.
 * @param {string} props.appId - Id of the app that posted the notification.
 * @param {number} props.size - Icon edge length in pixels.
 * @returns {JSX.Element} The app icon or the generic fallback tile.
 *
 * @example
 * <AppIcon appId="finder" size={34} />
 */
function AppIcon({ appId, size }: { appId: string; size: number }) {
  const Icon: ComponentType<{ size: number }> | undefined = getApp(appId)?.icon;
  if (Icon) return <Icon size={size} />;
  return (
    <span className={styles.genericIcon} style={{ width: size, height: size }}>
      <OSLogo size={Math.round(size * 0.55)} color="currentColor" />
    </span>
  );
}

/**
 * Renders the inside of a notification card.
 *
 * Shows the app icon, the app name (or the OS name for notifications without a registered app),
 * a relative timestamp computed against `now`, the localized title and, when present, the body.
 *
 * @param {Object} props - Component props.
 * @param {Notification} props.note - The notification to display.
 * @param {number} props.now - Current timestamp in ms used for the relative time.
 * @returns {JSX.Element} The icon and text columns of the card.
 *
 * @example
 * <NoteContent note={note} now={Date.now()} />
 */
function NoteContent({ note, now }: { note: Notification; now: number }) {
  const t = useT();
  const locale = useLocale();
  const app = getApp(note.appId);
  return (
    <>
      <span className={styles.appIcon}>
        <AppIcon appId={note.appId} size={34} />
      </span>
      <span className={styles.noteText}>
        <span className={styles.noteMeta}>
          <span className={styles.noteApp}>{app ? t(app.name) : osInfo.name}</span>
          <span className={styles.noteTime}>{relativeTime(note.createdAt, now, locale)}</span>
        </span>
        <span className={styles.noteTitle}>{t(note.title)}</span>
        {note.body && <span className={styles.noteBody}>{t(note.body)}</span>}
      </span>
    </>
  );
}

/**
 * Runs a notification's action and consumes it.
 *
 * Clicking a notification removes it from the kernel store (like macOS) and then calls its
 * optional `onClick` handler.
 *
 * @param {Notification} note - The clicked notification.
 * @returns {void}
 *
 * @example
 * activateNote(note);
 */
function activateNote(note: Notification) {
  removeNotification(note.id);
  note.onClick?.();
}

/* ───────────────────────── Banners ───────────────────────── */

/** A banner as rendered on screen. */
interface Shown {
  note: Notification;
  /** True while the banner plays its exit animation. */
  leaving: boolean;
}

/**
 * Syncs the rendered banners with the kernel's banner list.
 *
 * Kernel banners that are not on screen yet are prepended (newest on top); ids without a matching
 * notification are skipped. A rendered banner is marked leaving when it is in `closed`, or when
 * it is missing from the kernel's list and the pointer is not holding the stack. Leaving banners
 * beyond the first `MAX_BANNERS` never made it on screen, so they are dropped immediately instead
 * of animating out. Returns `prev` unchanged when nothing differs, so the state update bails out.
 *
 * @param {Shown[]} prev - Banners currently rendered, newest first.
 * @param {string[]} banners - Ids of the notifications the kernel currently banners.
 * @param {Notification[]} items - All notifications in the kernel store.
 * @param {boolean} hold - Whether the pointer is holding the stack (expired banners stay).
 * @param {ReadonlySet<string>} closed - Ids the user closed or activated; they leave regardless.
 * @returns {Shown[]} The next banner list, or `prev` when nothing changed.
 *
 * @example
 * setShown((prev) => reconcile(prev, banners, items, false, new Set()));
 */
function reconcile(prev: Shown[], banners: string[], items: Notification[], hold: boolean, closed: ReadonlySet<string>): Shown[] {
  const live = new Set(banners);
  let changed = false;
  const next = prev.map((s) => {
    const leaving = closed.has(s.note.id) || (!live.has(s.note.id) && !hold);
    if (leaving === s.leaving) return s;
    changed = true;
    return { ...s, leaving };
  });
  for (const id of banners) {
    if (prev.some((s) => s.note.id === id)) continue;
    const note = items.find((i) => i.id === id);
    if (!note) continue;
    next.unshift({ note, leaving: false });
    changed = true;
  }
  const trimmed = next.filter((s, i) => i < MAX_BANNERS || !s.leaving);
  return changed || trimmed.length !== next.length ? trimmed : prev;
}

/**
 * Renders a single notification banner with its close button.
 *
 * The banner slides in on mount and slides out while `leaving`; `onGone` fires when the
 * wrapper's own exit animation ends (animations of its children are ignored). While leaving,
 * both buttons are removed from the tab order. The timestamp refreshes every 30 seconds.
 *
 * @param {Object} props - Component props.
 * @param {Notification} props.note - The notification to show.
 * @param {boolean} props.leaving - Whether the banner is playing its exit animation.
 * @param {() => void} props.onGone - Called once the exit animation has finished.
 * @param {() => void} props.onClose - Called when the close button is clicked.
 * @param {() => void} props.onActivate - Called when the banner itself is clicked.
 * @returns {JSX.Element} The banner element.
 *
 * @example
 * <Banner note={note} leaving={false} onGone={drop} onClose={close} onActivate={open} />
 */
function Banner(props: { note: Notification; leaving: boolean; onGone: () => void; onClose: () => void; onActivate: () => void }) {
  const { note, leaving, onGone, onClose, onActivate } = props;
  const t = useT();
  const now = useNow(30000);
  return (
    <div
      className={cx(styles.banner, leaving && styles.leaving)}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onGone();
      }}
    >
      <button type="button" data-lg-optics className={cx(GLASS, styles.card)} onClick={onActivate} tabIndex={leaving ? -1 : undefined}>
        <NoteContent note={note} now={now} />
      </button>
      <button type="button" className={cx(GLASS, 'lg-circle', styles.close)} aria-label={t(S.close)} title={t(S.close)} onClick={onClose} tabIndex={leaving ? -1 : undefined}>
        <X size={10} strokeWidth={3.2} />
      </button>
    </div>
  );
}

const RELEASE_MS = 1200; /** How long banners stay after the pointer leaves the stack it was holding. */

/**
 * Renders the stack of notification banners in the top-right corner.
 *
 * Mirrors the kernel's banner list through `reconcile`. While a mouse pointer is over the stack
 * the `hold` flag keeps expired banners on screen so the stack does not shift under the pointer;
 * after the pointer leaves, the hold is released `RELEASE_MS` later and the list is re-synced.
 * Closing or activating a banner records its id in `closed` so it leaves immediately; the id is
 * forgotten once the exit animation ends. Only the first `MAX_BANNERS` entries are rendered, and
 * the stack is hidden (and non-interactive) while Notification Center is open.
 *
 * @returns {JSX.Element} The banner region.
 *
 * @example
 * <NotificationBanners />
 */
export function NotificationBanners() {
  const t = useT();
  const items = useNotifications((s) => s.items);
  const banners = useNotifications((s) => s.banners);
  const centerOpen = useUI((s) => s.notificationCenter);
  const [shown, setShown] = useState<Shown[]>([]);
  const hold = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closed = useRef(new Set<string>());
  const latest = useRef({ banners, items });

  useEffect(() => {
    latest.current = { banners, items };
    setShown((prev) => reconcile(prev, banners, items, hold.current, closed.current));
  }, [banners, items]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  /**
   * Re-runs `reconcile` against the most recent kernel state.
   *
   * Reads banners and items from the `latest` ref so it can be called from timers and event
   * handlers without stale closures.
   *
   * @returns {void}
   *
   * @example
   * resync();
   */
  const resync = () => setShown((prev) => reconcile(prev, latest.current.banners, latest.current.items, hold.current, closed.current));
  /**
   * Starts or schedules the end of the pointer hold on the banner stack.
   *
   * Turning the hold on takes effect immediately and cancels a pending release. Turning it off
   * waits `RELEASE_MS` before clearing the flag and re-syncing, so expired banners then leave.
   *
   * @param {boolean} on - True when the pointer enters the stack, false when it leaves.
   * @returns {void}
   *
   * @example
   * setHold(true);
   */
  const setHold = (on: boolean) => {
    clearTimeout(holdTimer.current);
    if (on) {
      hold.current = true;
      return;
    }
    holdTimer.current = setTimeout(() => {
      hold.current = false;
      resync();
    }, RELEASE_MS);
  };
  /**
   * Makes a banner leave right away.
   *
   * Adds the id to the `closed` set, which `reconcile` treats as leaving even while the stack is
   * held, then re-syncs.
   *
   * @param {string} id - Id of the notification whose banner should leave.
   * @returns {void}
   *
   * @example
   * remove(note.id);
   */
  const remove = (id: string) => {
    closed.current.add(id);
    resync();
  };

  return (
    <div
      className={cx(styles.banners, centerOpen && styles.bannersHidden)}
      style={{ zIndex: Z.BANNERS, top: MENU_BAR_HEIGHT + 8 }}
      role="region"
      aria-label={t(S.banners)}
      aria-live="polite"
      onPointerOver={(e) => e.pointerType === 'mouse' && setHold(true)}
      onPointerLeave={() => setHold(false)}
    >
      {shown.slice(0, MAX_BANNERS).map(({ note, leaving }) => (
        <Banner
          key={note.id}
          note={note}
          leaving={leaving}
          onGone={() => {
            closed.current.delete(note.id);
            setShown((prev) => prev.filter((s) => s.note.id !== note.id));
          }}
          onClose={() => {
            remove(note.id);
            dismissBanner(note.id);
          }}
          onActivate={() => {
            remove(note.id);
            activateNote(note);
          }}
        />
      ))}
    </div>
  );
}

/* ───────────────────────── Notification Center ───────────────────────── */

/**
 * Renders a notification card in Notification Center with its clear button.
 *
 * Clicking the card runs `onActivate` when given; otherwise it closes Notification Center and
 * activates the notification. The clear button's label defaults to "Clear".
 *
 * @param {Object} props - Component props.
 * @param {Notification} props.note - The notification to show.
 * @param {number} props.now - Current timestamp in ms used for the relative time.
 * @param {() => void} [props.onActivate] - Click handler replacing the default activation.
 * @param {() => void} props.onClear - Called when the clear button is clicked.
 * @param {string} [props.clearLabel] - Accessible label and tooltip of the clear button.
 * @returns {JSX.Element} The card with its clear button.
 *
 * @example
 * <NoteCard note={note} now={now} onClear={() => removeNotification(note.id)} />
 */
function NoteCard({ note, now, onActivate, onClear, clearLabel }: { note: Notification; now: number; onActivate?: () => void; onClear: () => void; clearLabel?: string }) {
  const t = useT();
  return (
    <div className={styles.cardWrap}>
      <button
        type="button"
        data-lg-optics
        className={cx(GLASS, styles.card)}
        onClick={
          onActivate ??
          (() => {
            closeCenter();
            activateNote(note);
          })
        }
      >
        <NoteContent note={note} now={now} />
      </button>
      <button type="button" className={cx(GLASS, 'lg-circle', styles.close)} aria-label={clearLabel ?? t(S.clear)} title={clearLabel ?? t(S.clear)} onClick={onClear}>
        <X size={10} strokeWidth={3.2} />
      </button>
    </div>
  );
}

/**
 * Removes every notification of an app group.
 *
 * Calls `removeNotification` for each entry in turn.
 *
 * @param {Notification[]} notes - The notifications to remove.
 * @returns {void}
 *
 * @example
 * clearGroup(notes);
 */
function clearGroup(notes: Notification[]) {
  for (const n of notes) removeNotification(n.id);
}

/**
 * Renders one app's notifications in Notification Center.
 *
 * A single notification is a plain card. Several notifications collapse into a stack: the newest
 * card on top (clicking it expands the group, its clear button clears all) with one decorative
 * glass layer peeking out below, or two when the group has more than two notifications. When
 * expanded, every card is listed under a header with the app name plus "Show Less" and "Clear"
 * buttons.
 *
 * @param {Object} props - Component props.
 * @param {Notification[]} props.notes - The app's notifications, newest first (non-empty).
 * @param {boolean} props.expanded - Whether the group is expanded.
 * @param {() => void} props.onToggle - Toggles between the collapsed and expanded layouts.
 * @param {number} props.now - Current timestamp in ms used for the relative times.
 * @returns {JSX.Element} The card, collapsed stack or expanded group.
 *
 * @example
 * <Group notes={group} expanded={false} onToggle={toggle} now={now} />
 */
function Group({ notes, expanded, onToggle, now }: { notes: Notification[]; expanded: boolean; onToggle: () => void; now: number }) {
  const t = useT();
  const app = getApp(notes[0].appId);
  const name = app ? t(app.name) : osInfo.name;

  if (notes.length === 1) return <NoteCard note={notes[0]} now={now} onClear={() => removeNotification(notes[0].id)} />;

  if (!expanded) {
    return (
      <div className={cx(styles.stack, notes.length > 2 && styles.stackDeep)} title={t(S.more).replace('{n}', String(notes.length - 1))}>
        <NoteCard note={notes[0]} now={now} onActivate={onToggle} onClear={() => clearGroup(notes)} clearLabel={t(S.clearAll)} />
        <div className={cx(GLASS, styles.layer)} aria-hidden="true" />
        {notes.length > 2 && <div className={cx(GLASS, styles.layer, styles.layer2)} aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={styles.groupTitle}>{name}</span>
        <button type="button" className={cx(GLASS, 'lg-capsule', styles.pillBtn)} onClick={onToggle}>
          {t(S.showLess)}
        </button>
        <button type="button" className={cx(GLASS, 'lg-capsule', styles.pillBtn)} onClick={() => clearGroup(notes)}>
          {t(S.clear)}
        </button>
      </div>
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} now={now} onClear={() => removeNotification(n.id)} />
      ))}
    </div>
  );
}

/**
 * Groups notifications by app.
 *
 * Sorts a copy of the list newest first, then buckets it by `appId`; because a `Map` keeps
 * insertion order, groups come out ordered by their newest notification and each group is
 * newest first. The input array is not mutated.
 *
 * @param {Notification[]} items - All notifications.
 * @returns {Notification[][]} One non-empty array per app.
 *
 * @example
 * const groups = groupByApp(items);
 * groups[0][0]; // the newest notification overall
 */
function groupByApp(items: Notification[]): Notification[][] {
  const groups = new Map<string, Notification[]>();
  for (const n of [...items].sort((a, b) => b.createdAt - a.createdAt)) {
    const g = groups.get(n.appId);
    if (g) g.push(n);
    else groups.set(n.appId, [n]);
  }
  return [...groups.values()];
}

/**
 * Renders the contents of Notification Center: grouped notifications followed by widgets.
 *
 * While the panel is open, every unread notification is marked read, including ones that arrive
 * while it stays open. Keeps the set of expanded app groups and refreshes timestamps every 30
 * seconds. The list and the widget area are marked `data-nc-backdrop` so clicks on their empty
 * space close the panel.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.open - Whether Notification Center is open (false while it animates out).
 * @returns {JSX.Element} The notification list and the widgets.
 *
 * @example
 * <CenterContent open={open} />
 */
function CenterContent({ open }: { open: boolean }) {
  const t = useT();
  const items = useNotifications((s) => s.items);
  const now = useNow(30000);
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    if (open && items.some((n) => !n.read)) markAllRead();
  }, [open, items]);

  const groups = groupByApp(items);
  return (
    <>
      <div className={styles.list} data-nc-backdrop>
        {groups.length === 0 ? (
          <div data-lg-optics className={cx(GLASS, styles.empty)}>{t(S.none)}</div>
        ) : (
          groups.map((g) => {
            const appId = g[0].appId;
            const isOpen = expanded.includes(appId);
            return (
              <Group
                key={appId}
                notes={g}
                expanded={isOpen}
                now={now}
                onToggle={() => setExpanded((e) => (isOpen ? e.filter((x) => x !== appId) : [...e, appId]))}
              />
            );
          })
        )}
      </div>
      <Widgets onDone={closeCenter} />
    </>
  );
}

/**
 * Renders the Notification Center side panel.
 *
 * Driven by the `notificationCenter` UI flag: the panel stays mounted for 320ms after closing to
 * play its exit animation, during which it is inert. It closes on a pointer-down outside of it
 * (except on its menu bar toggle, `[data-nc-toggle]`), on Escape, and when the session stops
 * being interactive. A pointer-down on the panel's own empty space or on a `data-nc-backdrop`
 * element also closes it, so the gaps between cards behave like the desktop behind them. The
 * widgets pick their content tone from what lies behind them (useAdaptiveTone).
 *
 * @returns {JSX.Element | null} The panel, or null when it is fully closed.
 *
 * @example
 * <NotificationCenter />
 */
export function NotificationCenter() {
  const t = useT();
  const open = useUI((s) => s.notificationCenter);
  const { mounted, closing } = usePresence(open, 320);
  const ref = useRef<HTMLElement>(null);
  useDismiss(open, ref, closeCenter, '[data-nc-toggle]');
  useCloseOnSessionEnd(open, closeCenter);
  useAdaptiveTone(ref, '[data-adaptive-tone]', mounted);
  if (!mounted) return null;
  return (
    <aside
      ref={ref}
      data-shell-overlay
      className={cx(styles.center, closing && styles.centerClosing)}
      style={{ zIndex: Z.PANELS, top: MENU_BAR_HEIGHT }}
      aria-label={t(S.title)}
      inert={closing || undefined}
      onPointerDown={(e) => {
        if (e.target instanceof HTMLElement && (e.target === e.currentTarget || 'ncBackdrop' in e.target.dataset)) closeCenter();
      }}
    >
      <CenterContent open={open} />
    </aside>
  );
}
