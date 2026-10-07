/**
 * Prints a fingerprint of every TS/TSX file's syntax tree, ignoring comments and formatting.
 *
 * Parses each file with Oxc (via rolldown/utils), drops source positions and comments, and hashes
 * the remaining tree, so two snapshots of the code produce the same fingerprint exactly when only
 * comments or whitespace changed.
 *
 * @example
 * node scripts/ast-fingerprint.mjs src > before.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSync } from 'rolldown/utils';

const root = process.argv[2] ?? 'src'; /** Directory whose source files are fingerprinted. */
const SKIP = new Set(['start', 'end', 'range', 'loc', 'comments', 'hashbang']); /** AST keys that only describe positions or comments. */

/**
 * Lists every .ts/.tsx file under a directory.
 *
 * Walks the directory tree recursively and collects TypeScript sources in a stable order.
 *
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute paths of the TypeScript files found.
 *
 * @example
 * walk('src'); // ['src/main.tsx', ...]
 */
function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
}

/**
 * Serializes an AST node without position or comment information.
 *
 * Used as a JSON.stringify replacer so that formatting-only edits do not change the output.
 *
 * @param {string} key - Property name being serialized.
 * @param {unknown} value - Property value being serialized.
 * @returns {unknown} The value, or undefined for keys that must be ignored.
 *
 * @example
 * JSON.stringify(ast, stripPositions);
 */
function stripPositions(key, value) {
  return SKIP.has(key) ? undefined : value;
}

const out = {}; /** File path → fingerprint of its syntax tree. */
for (const file of walk(root)) {
  const code = readFileSync(file, 'utf8');
  const { program, errors } = parseSync(file, code);
  const body = errors.length ? `PARSE_ERROR:${errors.map((e) => e.message).join('|')}` : JSON.stringify(program, stripPositions);
  out[relative(process.cwd(), file)] = createHash('sha1').update(body).digest('hex');
}
process.stdout.write(JSON.stringify(out, null, 1));
