/** Command registry: every command module contributes a list; names and aliases are indexed here. */
import type { CommandDef } from '../types';
import { APP_COMMANDS } from './apps';
import { BUILTIN_COMMANDS } from './builtins';
import { FILE_COMMANDS } from './files';
import { FUN_COMMANDS } from './fun';
import { NET_COMMANDS } from './net';
import { PORTFOLIO_COMMANDS } from './portfolio';
import { SYSTEM_COMMANDS } from './system';
import { TEXT_COMMANDS } from './text';

export const COMMAND_LIST: CommandDef[] = [...PORTFOLIO_COMMANDS, ...FILE_COMMANDS, ...TEXT_COMMANDS, ...APP_COMMANDS, ...SYSTEM_COMMANDS, ...NET_COMMANDS, ...BUILTIN_COMMANDS, ...FUN_COMMANDS]; /** Every command definition, in registry order: portfolio, files, text, apps, system, network, builtins, fun. */

const byName = new Map<string, CommandDef>(); /** Index from every command name and alias to its definition, filled from COMMAND_LIST at module load (later entries win on a name clash). */
for (const def of COMMAND_LIST) {
  byName.set(def.name, def);
  for (const a of def.aliases ?? []) byName.set(a, def);
}

/**
 * Looks up a command by the name typed on the command line.
 *
 * Resolves both primary names and aliases (e.g. `less` for `cat`) through the
 * index built from COMMAND_LIST when this module loads.
 *
 * @param {string} name - Command name or alias as typed (argv[0]).
 * @returns {CommandDef | undefined} The matching definition, or undefined when nothing has that name.
 *
 * @example
 * const def = findCommand('ls');
 * console.log(def?.group); // 'files'
 */
export function findCommand(name: string): CommandDef | undefined {
  return byName.get(name);
}

/**
 * Lists every invocable command name.
 *
 * Includes primary names and aliases, sorted in code-unit order; tab
 * completion offers these as command-name candidates.
 *
 * @returns {string[]} All registered names and aliases, sorted.
 *
 * @example
 * const names = commandNames();
 * console.log(names.includes('more')); // true
 */
export function commandNames(): string[] {
  return [...byName.keys()].sort();
}
