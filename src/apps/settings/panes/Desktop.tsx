/**
 * Desktop & Dock, Wallpaper and Displays settings panes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ImagePlus, Sun, Upload } from 'lucide-react';
import { Button, Segmented, Switch } from '@/components/ui';
import { dialogs, fmt, fs, kindOf, PATHS, pickHostFiles, tildify, useDir, useIsDark, useNode, useSystem, useT, WALLPAPERS, type DockPosition } from '@/kernel';
import { ActivityIndicator, LabeledSlider, onRadioGroupKeyDown, Pane, Row, Section, SwitchRow } from '../kit';
import { useNav } from '../nav';
import { setPrefs, usePrefs } from '../prefs';
import { useScreenInfo } from '../hooks';
import { IMAGE_EXTENSIONS, isImagePath, useWallpaperURL, wallpaperName } from '../media';
import { measureRefreshRate } from '../deviceInfo';
import { DisplayArt } from './MachineArt';
import s from './panes.module.css';

const S = {
  dock: { en: 'Dock', ko: 'Dock' },
  size: { en: 'Size', ko: '크기' },
  small: { en: 'Small', ko: '작게' },
  large: { en: 'Large', ko: '크게' },
  magnification: { en: 'Magnification', ko: '확대' },
  position: { en: 'Position on screen', ko: '화면상의 위치' },
  left: { en: 'Left', ko: '왼쪽' },
  bottom: { en: 'Bottom', ko: '하단' },
  right: { en: 'Right', ko: '오른쪽' },
  autohide: { en: 'Automatically hide and show the Dock', ko: '자동으로 Dock 가리기와 보기' },
  recents: { en: 'Show suggested and recent apps in Dock', ko: 'Dock에서 제안된 앱 및 최근 사용한 앱 보기' },
  finder: { en: 'Finder', ko: 'Finder' },
  hiddenFiles: { en: 'Show hidden files', ko: '숨김 파일 보기' },
  hiddenFilesSub: {
    en: 'Shows files and folders whose names begin with a dot in Finder and on the desktop.',
    ko: 'Finder와 데스크탑에서 이름이 마침표로 시작하는 파일과 폴더를 표시합니다.',
  },

  dynamic: { en: 'Dynamic — changes with Light and Dark appearance', ko: '다이내믹 — 라이트 및 다크 모드에 따라 변경됨' },
  missing: { en: 'The picture can’t be found. Showing the default wallpaper.', ko: '사진을 찾을 수 없어 기본 배경화면을 표시합니다.' },
  addPhoto: { en: 'Add Photo…', ko: '사진 추가…' },
  importPhoto: { en: 'Import from Computer…', ko: '컴퓨터에서 가져오기…' },
  choosePicture: { en: 'Choose a Picture', ko: '사진 선택' },
  notImage: { en: 'This file isn’t a picture.', ko: '이 파일은 사진이 아닙니다.' },
  wallpapers: { en: 'Dynamic Wallpapers', ko: '다이내믹 배경화면' },
  pictures: { en: 'Pictures', ko: '사진' },

  builtIn: { en: 'Built-in Display', ko: '내장 디스플레이' },
  brightness: { en: 'Brightness', ko: '밝기' },
  nightShift: { en: 'Night Shift', ko: 'Night Shift' },
  nightShiftSub: { en: 'Shifts the colors of your display to the warmer end of the spectrum.', ko: '디스플레이의 색상을 따뜻한 색 계열로 조정합니다.' },
  resolution: { en: 'Resolution', ko: '해상도' },
  viewport: { en: 'Browser viewport', ko: '브라우저 뷰포트' },
  density: { en: 'Pixel density', ko: '픽셀 밀도' },
  highDensity: { en: 'High density', ko: '고밀도' },
  standard: { en: 'Standard', ko: '표준' },
  refresh: { en: 'Refresh rate', ko: '재생률' },
  measuring: { en: 'Measuring…', ko: '측정 중…' },
  unknown: { en: 'Unknown', ko: '알 수 없음' },
  color: { en: 'Color', ko: '색상' },
  bits: { en: '{n}-bit', ko: '{n}비트' },
  displayFooter: { en: 'These values are measured from your real screen.', ko: '이 값은 실제 화면에서 측정한 값입니다.' },
}; /** Localized strings for the Desktop & Dock, Wallpaper and Displays panes. */

/* ───────────────────────── Desktop & Dock ───────────────────────── */

/**
 * Renders the Desktop & Dock settings pane.
 *
 * Binds the Dock size, magnification (size slider plus on/off switch), screen position and
 * auto-hide controls to the kernel's system settings, the "suggested and recent apps" switch to
 * this app's prefs, and the Finder "show hidden files" switch to system settings. The
 * magnification slider never starts below the current Dock size and is disabled while
 * magnification is off.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <DesktopDockPane />
 */
export function DesktopDockPane() {
  const t = useT();
  const st = useSystem((x) => x.settings);
  const update = useSystem((x) => x.updateSettings);
  const showRecentApps = usePrefs((p) => p.showRecentApps);

  return (
    <Pane>
      <Section title={t(S.dock)}>
        <Row label={t(S.size)}>
          <LabeledSlider value={st.dockSize} min={32} max={96} step={1} onChange={(v) => update({ dockSize: v })} label={t(S.size)} start={t(S.small)} end={t(S.large)} />
        </Row>
        <Row label={t(S.magnification)}>
          <LabeledSlider
            value={Math.max(st.dockMagnifiedSize, st.dockSize)}
            min={st.dockSize}
            max={128}
            step={1}
            onChange={(v) => update({ dockMagnifiedSize: v })}
            label={t(S.magnification)}
            start={t(S.small)}
            end={t(S.large)}
            disabled={!st.dockMagnification}
            width={170}
          />
          <Switch checked={st.dockMagnification} onChange={(v) => update({ dockMagnification: v })} label={t(S.magnification)} />
        </Row>
        <Row label={t(S.position)}>
          <Segmented<DockPosition>
            value={st.dockPosition}
            onChange={(v) => update({ dockPosition: v })}
            options={[
              { value: 'left', label: t(S.left) },
              { value: 'bottom', label: t(S.bottom) },
              { value: 'right', label: t(S.right) },
            ]}
          />
        </Row>
        <SwitchRow label={t(S.autohide)} checked={st.dockAutohide} onChange={(v) => update({ dockAutohide: v })} />
        <SwitchRow label={t(S.recents)} checked={showRecentApps} onChange={(v) => setPrefs({ showRecentApps: v })} />
      </Section>

      <Section title={t(S.finder)}>
        <SwitchRow label={t(S.hiddenFiles)} sublabel={t(S.hiddenFilesSub)} checked={st.showHiddenFiles} onChange={(v) => update({ showHiddenFiles: v })} />
      </Section>
    </Pane>
  );
}

/* ───────────────────────── Wallpaper ───────────────────────── */

/**
 * Renders one selectable wallpaper thumbnail.
 *
 * A `role="radio"` button showing a lazily loaded preview image, a check badge when selected and
 * the wallpaper name as caption and tooltip. It is meant to sit inside a `radiogroup` whose key
 * handler provides arrow-key navigation.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - Image URL of the preview.
 * @param {string} props.name - Wallpaper name shown as the caption and tooltip.
 * @param {boolean} props.selected - Whether this wallpaper is the current one.
 * @param {() => void} props.onSelect - Called when the thumbnail is clicked.
 * @returns {JSX.Element} The thumbnail button.
 *
 * @example
 * <Thumb src={w.light} name={t(w.name)} selected={wallpaper === w.id} onSelect={() => setWallpaper(w.id)} />
 */
function Thumb({ src, name, selected, onSelect }: { src: string; name: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={s.thumb} onClick={onSelect} title={name}>
      <span className={s.thumbImg}>
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
        {selected && (
          <span className={s.thumbCheck} aria-hidden="true">
            <Check size={10} strokeWidth={3.2} />
          </span>
        )}
      </span>
      <span className={s.thumbName}>{name}</span>
    </button>
  );
}

/**
 * Renders the Wallpaper settings pane.
 *
 * Shows a preview of the current wallpaper (resolved for the current light/dark appearance) with
 * its name and a subtitle: "Dynamic" for a built-in wallpaper, the tilde-abbreviated path for a
 * picture file, or a notice that the default wallpaper is shown when that file is missing.
 * Below it the built-in dynamic wallpapers and every image file in ~/Pictures are listed as radio
 * thumbnails. "Add Photo…" picks an image from the virtual file system; "Import from Computer…"
 * copies host images into ~/Pictures and uses the first imported image.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <WallpaperPane />
 */
export function WallpaperPane() {
  const t = useT();
  const { windowId } = useNav();
  const dark = useIsDark();
  const wallpaper = useSystem((x) => x.settings.wallpaper);
  const update = useSystem((x) => x.updateSettings);
  const url = useWallpaperURL(wallpaper, dark);
  const isPath = wallpaper.startsWith('/');
  const node = useNode(isPath ? wallpaper : null);
  const pictures = useDir(PATHS.pictures).filter((n) => n.type === 'file' && kindOf(n) === 'image');

  /**
   * Stores a new wallpaper in the system settings.
   *
   * The value is either a built-in wallpaper id or an absolute path to an image file in the
   * virtual file system.
   *
   * @param {string} value - Wallpaper id or image path.
   * @returns {void}
   *
   * @example
   * setWallpaper('/Users/me/Pictures/beach.jpg');
   */
  const setWallpaper = (value: string) => update({ wallpaper: value });

  /**
   * Lets the user choose a picture from the virtual file system as the wallpaper.
   *
   * Opens an Open panel as a sheet on this window, starting in ~/Pictures and filtered to image
   * extensions. A chosen image becomes the wallpaper; a chosen file that is not an image shows an
   * alert instead. Cancelling the panel does nothing.
   *
   * @async
   * @returns {Promise<void>} Resolves once the panel (and any alert) has been dismissed.
   *
   * @example
   * <Button onClick={() => void addPhoto()}>Add Photo…</Button>
   */
  const addPhoto = async () => {
    const path = await dialogs.open({ windowId, title: S.choosePicture, defaultDir: PATHS.pictures, extensions: IMAGE_EXTENSIONS });
    if (!path) return;
    if (isImagePath(path)) setWallpaper(path);
    else await dialogs.alert({ windowId, appId: 'settings', title: S.notImage });
  };

  /**
   * Imports pictures from the host computer and uses the first image as the wallpaper.
   *
   * Opens the browser's file picker limited to images, copies the chosen files into ~/Pictures
   * and sets the first created file recognized as an image as the wallpaper. Nothing changes when
   * the picker is cancelled or no image was imported.
   *
   * @async
   * @returns {Promise<void>} Resolves after the import has finished.
   *
   * @example
   * <Button onClick={() => void importPhoto()}>Import from Computer…</Button>
   */
  const importPhoto = async () => {
    const created = await pickHostFiles(PATHS.pictures, 'image/*');
    const image = created.find(isImagePath);
    if (image) setWallpaper(image);
  };

  return (
    <Pane>
      <Section>
        <div className={s.wpCurrent}>
          <div className={s.wpPreview}>
            <img src={url} alt="" draggable={false} />
          </div>
          <div className={s.wpInfo}>
            <div className={s.wpName}>{t(wallpaperName(wallpaper))}</div>
            <div className={s.wpSub}>{!isPath ? t(S.dynamic) : node ? tildify(wallpaper) : t(S.missing)}</div>
            <div className={s.wpButtons}>
              <Button onClick={() => void addPhoto()}>
                <ImagePlus size={13} />
                {t(S.addPhoto)}
              </Button>
              <Button onClick={() => void importPhoto()}>
                <Upload size={13} />
                {t(S.importPhoto)}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t(S.wallpapers)} plain>
        <div className={s.thumbGrid} role="radiogroup" aria-label={t(S.wallpapers)} onKeyDown={onRadioGroupKeyDown}>
          {WALLPAPERS.map((w) => (
            <Thumb key={w.id} src={dark ? (w.dark ?? w.light) : w.light} name={t(w.name)} selected={wallpaper === w.id} onSelect={() => setWallpaper(w.id)} />
          ))}
        </div>
      </Section>

      {pictures.length > 0 && (
        <Section title={t(S.pictures)} plain>
          <div className={s.thumbGrid} role="radiogroup" aria-label={t(S.pictures)} onKeyDown={onRadioGroupKeyDown}>
            {pictures.map((n) => (
              <Thumb key={n.path} src={fs.getURL(n.path)} name={n.name} selected={wallpaper === n.path} onSelect={() => setWallpaper(n.path)} />
            ))}
          </div>
        </Section>
      )}
    </Pane>
  );
}

/* ───────────────────────── Displays ───────────────────────── */

/**
 * Measures the display's refresh rate once on mount.
 *
 * Runs `measureRefreshRate`, which counts animation frames over a short sample, and stores the
 * result. The shared signal is flagged as cancelled on unmount so a result that arrives later is
 * ignored.
 *
 * @returns {number | null | undefined} The rate in Hz, `undefined` while still measuring, or
 *   `null` when the browser cannot measure it.
 *
 * @example
 * const hz = useRefreshRate();
 * const label = hz === undefined ? 'Measuring…' : hz === null ? 'Unknown' : `${hz} Hz`;
 */
function useRefreshRate(): number | null | undefined {
  const [hz, setHz] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    const signal = { cancelled: false };
    void measureRefreshRate(signal).then((v) => {
      if (!signal.cancelled) setHz(v);
    });
    return () => {
      signal.cancelled = true;
    };
  }, []);
  return hz;
}

/**
 * Renders the Displays settings pane.
 *
 * Shows a display illustration with the current wallpaper, brightness and Night Shift controls
 * bound to system settings, and read-only facts measured from the real screen: resolution,
 * browser viewport, device pixel ratio (labelled high density at 2× and above), refresh rate
 * (with a spinner while it is being measured) and the color depth, gamut (sRGB, Display P3 or
 * Rec. 2020) and HDR support. The color facts are read once on mount.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <DisplaysPane />
 */
export function DisplaysPane() {
  const t = useT();
  const dark = useIsDark();
  const brightness = useSystem((x) => x.settings.brightness);
  const nightShift = useSystem((x) => x.settings.nightShift);
  const update = useSystem((x) => x.updateSettings);
  const url = useWallpaperURL(useSystem((x) => x.settings.wallpaper), dark);
  const scr = useScreenInfo();
  const hz = useRefreshRate();
  const color = useMemo(() => {
    /**
     * Evaluates a CSS media query against the current window.
     *
     * Returns false when `window.matchMedia` is unavailable.
     *
     * @param {string} q - The media query, e.g. "(color-gamut: p3)".
     * @returns {boolean} Whether the query currently matches.
     *
     * @example
     * mq('(dynamic-range: high)'); // true on an HDR-capable screen
     */
    const mq = (q: string) => !!window.matchMedia?.(q).matches;
    const gamut = mq('(color-gamut: rec2020)') ? 'Rec. 2020' : mq('(color-gamut: p3)') ? 'Display P3' : 'sRGB';
    return { depth: screen.colorDepth, gamut, hdr: mq('(dynamic-range: high)') };
  }, []);
  const dpr = Number(scr.dpr.toFixed(2));

  return (
    <Pane>
      <div className={s.machineHeader}>
        <DisplayArt wallpaper={url} width={170} />
        <div className={s.machineName}>{t(S.builtIn)}</div>
        <div className={s.machineSub}>{`${scr.screenW} × ${scr.screenH}`}</div>
      </div>

      <Section>
        <Row label={t(S.brightness)}>
          <LabeledSlider
            inline
            value={brightness}
            min={0.3}
            max={1}
            onChange={(v) => update({ brightness: v })}
            label={t(S.brightness)}
            start={<Sun size={11} />}
            end={<Sun size={16} />}
            width={230}
          />
        </Row>
        <SwitchRow label={t(S.nightShift)} sublabel={t(S.nightShiftSub)} checked={nightShift} onChange={(v) => update({ nightShift: v })} />
      </Section>

      <Section title={t(S.resolution)} footer={t(S.displayFooter)}>
        <Row label={t(S.resolution)}>{`${scr.screenW} × ${scr.screenH}`}</Row>
        <Row label={t(S.viewport)}>{`${scr.viewW} × ${scr.viewH}`}</Row>
        <Row label={t(S.density)}>{`${dpr}× · ${t(dpr >= 2 ? S.highDensity : S.standard)}`}</Row>
        <Row label={t(S.refresh)}>
          {hz === undefined ? (
            <>
              <ActivityIndicator size={13} />
              {t(S.measuring)}
            </>
          ) : hz === null ? (
            t(S.unknown)
          ) : (
            `${hz} Hz`
          )}
        </Row>
        <Row label={t(S.color)}>{[fmt(t(S.bits), { n: color.depth }), color.gamut, color.hdr ? 'HDR' : null].filter(Boolean).join(' · ')}</Row>
      </Section>
    </Pane>
  );
}
