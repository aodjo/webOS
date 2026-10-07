/**
 * csh-style history expansion as done by zsh before parsing:
 *   !!  last command      !n  event n      !-n  n-th previous      !str  last starting with str
 *   !$  last word         !*  all args     ^old^new  quick substitution of the last command
 * Nothing is expanded inside single quotes or after a backslash.
 */

/** Result of `expandHistory`: the (possibly rewritten) line, or a zsh error message. */
export type HistoryResult = { line: string; changed: boolean; error?: undefined } | { error: string; line?: undefined; changed?: undefined };

/**
 * Splits a command line into whitespace-separated words.
 *
 * Quoting is not considered; the result only serves to pick the words for `!$`, `!^` and `!*`.
 *
 * @param {string} cmd - A command line from the history.
 * @returns {string[]} The non-empty words.
 *
 * @example
 * words('  ls -l  /tmp '); // ['ls', '-l', '/tmp']
 */
function words(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

/**
 * Applies history expansion to a line before it is parsed.
 *
 * A line of the form `^old^new[^]` replaces the first `old` in the last command. Otherwise each
 * `!` is examined: `!!` is the last command, `!$` its last word, `!^` its first argument, `!*`
 * all its arguments, `!n` / `!-n` an absolute or relative event number, and `!str` the most
 * recent command starting with `str`. A `!` at the end of the line or before whitespace, `=` or
 * `(` stays literal, as do `!` inside single quotes and `\!` (which is kept with its backslash).
 *
 * @param {string} line - The line as typed.
 * @param {readonly string[]} history - Previous commands, oldest first.
 * @returns {HistoryResult} `{ line, changed }` with the expanded line, or `{ error }` when an
 *   event cannot be found or a quick substitution fails.
 *
 * @example
 * expandHistory('sudo !!', ['apt update']); // { line: 'sudo apt update', changed: true }
 */
export function expandHistory(line: string, history: readonly string[]): HistoryResult {
  const last = history[history.length - 1];

  const quick = /^\^([^^]*)\^([^^]*)\^?$/.exec(line);
  if (quick) {
    if (!last || !last.includes(quick[1])) return { error: 'zsh: substitution failed' };
    return { line: last.replace(quick[1], quick[2]), changed: true };
  }

  let out = '';
  let changed = false;
  let single = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '!') {
      out += '\\!';
      i++;
      continue;
    }
    if (ch === "'") single = !single;
    if (ch !== '!' || single) {
      out += ch;
      continue;
    }
    const rest = line.slice(i + 1);
    const next = rest[0];
    if (next === undefined || /[\s=(]/.test(next)) {
      out += ch;
      continue;
    }
    let event: string | undefined;
    let consumed = 0;
    let m: RegExpExecArray | null;
    if (next === '!') {
      event = last;
      consumed = 1;
      if (!event) return { error: 'zsh: no such event: 0' };
    } else if (next === '$' || next === '*' || next === '^') {
      if (!last) return { error: 'zsh: no such event: 0' };
      const w = words(last);
      event = next === '$' ? w[w.length - 1] ?? '' : next === '^' ? w[1] ?? '' : w.slice(1).join(' ');
      consumed = 1;
    } else if ((m = /^-?\d+/.exec(rest))) {
      const n = Number(m[0]);
      const idx = n < 0 ? history.length + n : n - 1;
      event = history[idx];
      consumed = m[0].length;
      if (event === undefined) return { error: `zsh: no such event: ${m[0]}` };
    } else if ((m = /^[^\s;&|<>'"]+/.exec(rest))) {
      const prefix = m[0];
      for (let k = history.length - 1; k >= 0; k--) {
        if (history[k].startsWith(prefix)) {
          event = history[k];
          break;
        }
      }
      consumed = prefix.length;
      if (event === undefined) return { error: `zsh: event not found: ${prefix}` };
    } else {
      out += ch;
      continue;
    }
    out += event;
    changed = true;
    i += consumed;
  }
  return { line: out, changed };
}
