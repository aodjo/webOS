import { afterEach, describe, expect, it } from 'vitest';
import { dragRegionFor } from './useWindowInteractions';

/**
 * Creates a window-frame stand-in with the given inner HTML and attaches it to the document.
 *
 * The frame is a `<section>` appended to `document.body`; the `afterEach` hook clears the body
 * between tests.
 *
 * @param {string} html - Markup to place inside the frame.
 * @returns {HTMLElement} The attached frame element.
 *
 * @example
 * const f = frameWith('<div data-drag-region><span id="t">Title</span></div>');
 * dragRegionFor(f.querySelector('#t'), f);
 */
function frameWith(html: string): HTMLElement {
  const frame = document.createElement('section');
  frame.innerHTML = html;
  document.body.appendChild(frame);
  return frame;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dragRegionFor', () => {
  it('finds the drag region a press started in', () => {
    const f = frameWith('<div data-drag-region><span id="t">Title</span></div><div id="c">content</div>');
    expect(dragRegionFor(f.querySelector('#t'), f)).toBe(f.firstElementChild);
    expect(dragRegionFor(f.querySelector('#c'), f)).toBeNull();
  });

  it('leaves controls inside the region alone', () => {
    const f = frameWith(
      '<div data-drag-region><button><svg id="icon"></svg></button><div draggable="true" id="drag">x</div><div role="tab" id="tab">t</div><div data-no-drag><span id="nd">n</span></div></div>',
    );
    for (const sel of ['#icon', '#drag', '#tab', '#nd']) expect(dragRegionFor(f.querySelector(sel), f)).toBeNull();
  });

  it('only considers controls between the target and its region', () => {
    const f = frameWith('<div role="button"><div data-drag-region><span id="t">x</span></div></div>');
    expect(dragRegionFor(f.querySelector('#t'), f)).not.toBeNull();
  });

  it('ignores regions outside the window frame', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-drag-region', '');
    document.body.appendChild(outer);
    const f = document.createElement('section');
    f.innerHTML = '<span id="t">x</span>';
    outer.appendChild(f);
    expect(dragRegionFor(f.querySelector('#t'), f)).toBeNull();
  });
});
