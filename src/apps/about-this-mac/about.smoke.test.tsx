import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useSystem } from '@/kernel/system';
import AboutThisMac from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Marks the test environment as supporting act(), so React does not warn when updates are wrapped in it. */

describe('About This Computer', () => {
  it('renders the spec sheet and live session info without warnings', () => {
    const errors = vi.spyOn(console, 'error');
    useSystem.getState().updateSettings({ locale: 'en' });
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<AboutThisMac windowId="w1" pid={1} args={{}} />));

    const text = host.textContent ?? '';
    expect(text).toContain('Portfolio Book Pro');
    expect(text).toContain('webOS HD');
    expect(text).toContain('Hallasan 1.0');
    expect(text).toMatch(/Uptime/);
    expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^\/wallpapers\//);

    act(() => useSystem.getState().updateSettings({ locale: 'ko' }));
    expect(host.textContent).toContain('일련번호');

    act(() => root.unmount());
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
