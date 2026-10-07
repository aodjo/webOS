import { describe, expect, it } from 'vitest';
import { parseBrowser, parseOS, roundRefreshRate, serialNumber } from './deviceInfo';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.55 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54',
  whale: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Whale/4.33.325.17 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  operaLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/123.0.0.0',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}; /** Real-world user-agent strings for each browser/OS combination under test. */

describe('parseBrowser', () => {
  it('detects the common desktop browsers', () => {
    expect(parseBrowser(UA.chromeMac)).toEqual({ name: 'Chrome', version: '141', engine: 'Blink' });
    expect(parseBrowser(UA.safariMac)).toEqual({ name: 'Safari', version: '18.1', engine: 'WebKit' });
    expect(parseBrowser(UA.firefoxWin)).toEqual({ name: 'Firefox', version: '131', engine: 'Gecko' });
    expect(parseBrowser(UA.edgeWin)).toEqual({ name: 'Microsoft Edge', version: '140', engine: 'Blink' });
    expect(parseBrowser(UA.operaLinux).name).toBe('Opera');
  });

  it('prefers Chromium forks over Chrome', () => {
    expect(parseBrowser(UA.whale).name).toBe('Naver Whale');
    expect(parseBrowser(UA.samsung)).toEqual({ name: 'Samsung Internet', version: '27', engine: 'Blink' });
  });

  it('reports WebKit for every iOS browser', () => {
    expect(parseBrowser(UA.chromeIOS)).toEqual({ name: 'Chrome', version: '141', engine: 'WebKit' });
    expect(parseBrowser(UA.safariIOS).engine).toBe('WebKit');
  });

  it('falls back gracefully', () => {
    expect(parseBrowser('curl/8.0').name).toBe('Unknown');
  });
});

describe('parseOS', () => {
  it('detects operating systems', () => {
    expect(parseOS(UA.chromeMac)).toBe('macOS');
    expect(parseOS(UA.firefoxWin)).toBe('Windows');
    expect(parseOS(UA.samsung)).toBe('Android 14');
    expect(parseOS(UA.safariIOS)).toBe('iOS 18.1');
    expect(parseOS(UA.operaLinux)).toBe('Linux');
    expect(parseOS(UA.chromeOS)).toBe('ChromeOS');
  });

  it('treats a touch "Macintosh" as an iPad', () => {
    expect(parseOS(UA.safariMac, 5)).toBe('iPadOS');
  });
});

describe('roundRefreshRate', () => {
  it('snaps to common panel rates', () => {
    expect(roundRefreshRate(59.7)).toBe(60);
    expect(roundRefreshRate(118.4)).toBe(120);
    expect(roundRefreshRate(143)).toBe(144);
    expect(roundRefreshRate(200)).toBe(200);
  });
});

describe('serialNumber', () => {
  it('is stable and well-formed', () => {
    expect(serialNumber('aodjo')).toBe(serialNumber('aodjo'));
    expect(serialNumber('aodjo')).toMatch(/^PB[A-Z0-9]{8}$/);
    expect(serialNumber('aodjo')).not.toBe(serialNumber('someone'));
  });
});
