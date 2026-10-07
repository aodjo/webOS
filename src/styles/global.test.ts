import { beforeAll, describe, expect, it } from 'vitest';

let css = ''; /** Raw text of src/styles/global.css, read from disk in beforeAll because Vitest stubs CSS imports (even ?raw) to ''. */
beforeAll(async () => {
  // The module name is a variable so this Node-only import stays out of the browser typings.
  const nodeFs: string = 'node:fs';
  const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, enc: 'utf8'): string };
  const { cwd } = (globalThis as unknown as { process: { cwd(): string } }).process;
  css = readFileSync(`${cwd()}/src/styles/global.css`, 'utf8');
});

/**
 * Extracts the innermost `selector { declarations }` blocks from a stylesheet.
 *
 * Strips all comments first, then matches every brace pair that contains no
 * nested braces. Rules nested inside @media (or any other at-rule) are therefore
 * returned on their own, while the wrapping at-rule itself is skipped. The
 * selector is trimmed; the body is the raw declaration text between the braces.
 *
 * @param {string} source - Raw CSS text to scan.
 * @returns {{ selector: string; body: string }[]} One entry per innermost rule, in source order.
 *
 * @example
 * const [first] = rules('a { color: red; }');
 * console.log(first); // { selector: 'a', body: ' color: red; ' }
 */
function rules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

const FIELD = /(^|[\s,>+~(])(input|textarea|select)\b|\.ui-(input|select|search)\b/; /** Matches selectors that target a text field: an input/textarea/select element or the .ui-input, .ui-select and .ui-search classes. */

describe('global.css text fields on touch screens', () => {
  it('raises --input-font-min to 16px only for coarse pointers', () => {
    expect(css).toMatch(/--input-font-min:\s*0px/);
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{\s*:root\s*\{\s*--input-font-min:\s*16px;?\s*\}/);
  });

  it('never gives a text field a font-size iOS would zoom into', () => {
    const offenders: string[] = [];
    for (const { selector, body } of rules(css)) {
      if (!FIELD.test(selector)) continue;
      for (const [, value] of body.matchAll(/font-size:\s*([^;]+)/g)) {
        if (value.includes('var(--input-font-min')) continue;
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
        if (px && Number(px[1]) < 16) offenders.push(`${selector} { font-size: ${value} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lets the base field rule defer to component sizes (element selector, no !important)', () => {
    const base = rules(css).find((r) => /^input,\s*textarea,\s*select$/.test(r.selector) && r.body.includes('font-size'));
    expect(base?.body).toMatch(/font-size:\s*max\(var\(--input-font-min, 0px\), 1em\);/);
    expect(base?.body).not.toContain('!important');
  });
});
