import { beforeEach, describe, expect, it } from 'vitest';
import { HOME, fs } from '@/kernel';
import { fakeTerm, newShell, run, seedFS } from './testkit';
import { formatPrintf } from './commands/text';
import type { Shell } from './interpreter';

let sh: Shell; /** Fresh shell created before each test on a reseeded file system. */

beforeEach(() => {
  seedFS();
  sh = newShell();
});

describe('navigation', () => {
  it('ls lists visible entries (one per line when not a tty)', async () => {
    const r = await run(sh, 'ls');
    expect(r.out).toBe('Desktop\nDocuments\nDownloads\nnotes.txt\n');
    expect((await run(sh, 'ls -a')).out.split('\n')).toEqual(expect.arrayContaining(['.', '..', '.zshrc', '.Trash']));
    expect((await run(sh, 'ls -A')).out.split('\n')).not.toContain('.');
  });

  it('ls -l shows permissions, owner and size', async () => {
    const r = await run(sh, 'ls -l Documents');
    const lines = r.out.trim().split('\n');
    expect(lines[0]).toMatch(/^total \d+$/);
    expect(lines.find((l) => l.endsWith(' a.md'))).toMatch(/^-rw-r--r-- +1 aodjo +staff +16 Jan 15 +2026 a\.md$|^-rw-r--r-- +1 \S+ +staff +16 /);
    expect(lines.find((l) => l.endsWith(' Projects'))).toMatch(/^drwxr-xr-x/);
  });

  it('ls reports missing operands BSD-style and keeps going', async () => {
    const r = await run(sh, 'ls nope Documents/a.md');
    expect(r.err).toBe('ls: nope: No such file or directory\n');
    expect(r.out).toBe('Documents/a.md\n');
    expect(r.status).toBe(1);
  });

  it('cd changes directory, supports -, ~ and ..', async () => {
    await run(sh, 'cd Documents');
    expect((await run(sh, 'pwd')).out).toBe(`${HOME}/Documents\n`);
    await run(sh, 'cd ..');
    expect(sh.cwd).toBe(HOME);
    await run(sh, 'cd /etc');
    expect((await run(sh, 'cd -')).out).toBe('~\n');
    expect(sh.cwd).toBe(HOME);
    await run(sh, 'cd /; cd');
    expect(sh.cwd).toBe(HOME);
    await run(sh, 'cd ~/Documents/Projects');
    expect(sh.cwd).toBe(`${HOME}/Documents/Projects`);
  });

  it('cd errors use zsh wording', async () => {
    expect((await run(sh, 'cd nowhere')).err).toBe('cd: no such file or directory: nowhere\n');
    expect((await run(sh, 'cd notes.txt')).err).toBe('cd: not a directory: notes.txt\n');
  });
});

describe('redirection & pipes', () => {
  it('echo with > and >> writes files', async () => {
    await run(sh, 'echo hi > out.txt; echo there >> out.txt');
    expect(fs.readFile(`${HOME}/out.txt`)).toBe('hi\nthere\n');
    expect((await run(sh, 'cat out.txt')).out).toBe('hi\nthere\n');
    await run(sh, 'echo -n replaced > out.txt');
    expect(fs.readFile(`${HOME}/out.txt`)).toBe('replaced');
  });

  it('redirects stderr and merges streams', async () => {
    expect((await run(sh, 'ls nope 2>/dev/null')).err).toBe('');
    await run(sh, 'ls nope Documents/c.txt > both.txt 2>&1');
    expect(fs.readFile(`${HOME}/both.txt`)).toBe('ls: nope: No such file or directory\nDocuments/c.txt\n');
    expect((await run(sh, 'echo x > /etc/hosts')).err).toBe('zsh: permission denied: /etc/hosts\n');
    expect((await run(sh, 'echo x > /nope.txt')).err).toBe('zsh: read-only file system: /nope.txt\n');
    expect((await run(sh, 'echo ok > /tmp/ok.txt && cat /tmp/ok.txt')).out).toBe('ok\n');
    const r = await run(sh, 'echo x > /missing/dir/f');
    expect(r.err).toBe('zsh: no such file or directory: /missing/dir/f\n');
    expect(r.status).toBe(1);
  });

  it('reads stdin with <', async () => {
    expect((await run(sh, 'wc -l < notes.txt')).out.trim()).toBe('4');
  });

  it('pipes output between commands', async () => {
    expect((await run(sh, 'cat notes.txt | grep an | wc -l')).out.trim()).toBe('2');
    expect((await run(sh, 'cat notes.txt | sort | uniq -c')).out).toBe('   1 apple\n   2 banana\n   1 cherry\n');
    expect((await run(sh, 'ls Documents | head -n 2')).out).toBe('Projects\na.md\n');
    expect((await run(sh, 'echo hello | tr a-z A-Z')).out).toBe('HELLO\n');
  });

  it('chains with && || ;', async () => {
    expect((await run(sh, 'false || echo ok')).out).toBe('ok\n');
    expect((await run(sh, 'true && echo yes')).out).toBe('yes\n');
    expect((await run(sh, 'false && echo no; echo $?')).out).toBe('1\n');
    expect((await run(sh, '! false && echo negated')).out).toBe('negated\n');
  });

  it('reports unknown commands with status 127', async () => {
    const r = await run(sh, 'frobnicate --now');
    expect(r.err).toBe('zsh: command not found: frobnicate\n');
    expect(r.status).toBe(127);
    expect((await run(sh, 'echo $?')).out).toBe('127\n');
  });
});

describe('file operations', () => {
  it('mkdir -p creates intermediate directories', async () => {
    expect((await run(sh, 'mkdir -p a/b/c')).status).toBe(0);
    expect(fs.isDir(`${HOME}/a/b/c`)).toBe(true);
    expect((await run(sh, 'mkdir a')).err).toBe('mkdir: a: File exists\n');
    expect((await run(sh, 'mkdir x/y')).err).toBe('mkdir: x/y: No such file or directory\n');
    expect((await run(sh, 'mkdir -p a/b')).status).toBe(0);
  });

  it('mkdir and touch respect read-only system locations', async () => {
    expect((await run(sh, 'mkdir /nope')).err).toBe('mkdir: /nope: Read-only file system\n');
    expect((await run(sh, 'touch /etc/new')).err).toBe('touch: /etc/new: Permission denied\n');
    expect((await run(sh, 'touch /tmp/ok')).status).toBe(0);
  });

  it('rm -r removes trees; rm refuses directories and system files', async () => {
    await run(sh, 'mkdir -p tree/sub && touch tree/sub/f');
    expect((await run(sh, 'rm tree')).err).toBe('rm: tree: is a directory\n');
    expect((await run(sh, 'rm -r tree')).status).toBe(0);
    expect(fs.exists(`${HOME}/tree`)).toBe(false);
    expect((await run(sh, 'rm -f ghost')).status).toBe(0);
    expect((await run(sh, 'rm ghost')).err).toBe('rm: ghost: No such file or directory\n');
    expect((await run(sh, 'rm -rf /')).err).toBe('rm: "/" may not be removed\n');
    expect((await run(sh, 'rm /Applications/Safari.app')).err).toBe('rm: /Applications/Safari.app: Operation not permitted\n');
    expect((await run(sh, 'rm -r ~/Documents')).err).toContain('Operation not permitted');
  });

  it('mv renames and moves into directories', async () => {
    await run(sh, 'mv notes.txt list.txt');
    expect(fs.exists(`${HOME}/list.txt`)).toBe(true);
    expect(fs.exists(`${HOME}/notes.txt`)).toBe(false);
    await run(sh, 'mv list.txt Documents');
    expect(fs.exists(`${HOME}/Documents/list.txt`)).toBe(true);
    await run(sh, 'mv Documents/*.md Desktop');
    expect(fs.exists(`${HOME}/Desktop/a.md`) && fs.exists(`${HOME}/Desktop/b.md`)).toBe(true);
    expect((await run(sh, 'mv ghost x')).err).toBe('mv: rename ghost to x: No such file or directory\n');
  });

  it('cp copies files and (with -r) directories', async () => {
    await run(sh, 'cp notes.txt copy.txt');
    expect(fs.readFile(`${HOME}/copy.txt`)).toBe(fs.readFile(`${HOME}/notes.txt`));
    expect((await run(sh, 'cp Documents Backup')).err).toBe('cp: Documents is a directory (not copied).\n');
    await run(sh, 'cp -r Documents Backup');
    expect(fs.readFile(`${HOME}/Backup/Projects/README.md`)).toBe('# Projects\n');
    // A second `cp -r` into the existing Backup2 nests the source as Backup2/Documents.
    expect((await run(sh, 'cp -r Documents/ Backup2 && cp -r Documents Backup2')).status).toBe(0);
    expect(fs.isDir(`${HOME}/Backup2/Documents`)).toBe(true);
  });

  it('cat -n numbers lines; cat reads stdin', async () => {
    expect((await run(sh, 'cat -n Documents/b.md')).out).toBe('     1\tHello again\n     2\tbye\n');
    expect((await run(sh, 'echo piped | cat')).out).toBe('piped\n');
    expect((await run(sh, 'cat Documents')).err).toBe('cat: Documents: Is a directory\n');
  });

  it('cat without input reads lines typed in the terminal until EOF', async () => {
    const term = fakeTerm();
    term.input = ['first', 'second', null];
    const s = newShell(term);
    await run(s, 'cat > typed.txt');
    expect(fs.readFile(`${HOME}/typed.txt`)).toBe('first\nsecond\n');
  });

  it('find and tree walk the hierarchy', async () => {
    expect((await run(sh, 'find Documents -name "*.md"')).out).toBe('Documents/Projects/README.md\nDocuments/a.md\nDocuments/b.md\n');
    expect((await run(sh, 'find . -maxdepth 1 -type d')).out).toBe('.\n./.Trash\n./Desktop\n./Documents\n./Downloads\n');
    const tree = (await run(sh, 'tree Documents')).out;
    expect(tree).toBe('Documents\n├── a.md\n├── b.md\n├── c.txt\n└── Projects\n    └── README.md\n\n1 directory, 4 files\n');
  });
});

describe('text tools', () => {
  it('grep supports -i -n -c -v -r', async () => {
    expect((await run(sh, 'grep -i hello Documents/a.md Documents/b.md')).out).toBe('Documents/a.md:hello world\nDocuments/b.md:Hello again\n');
    expect((await run(sh, 'grep -n banana notes.txt')).out).toBe('2:banana\n4:banana\n');
    expect((await run(sh, 'grep -c banana notes.txt')).out).toBe('2\n');
    expect((await run(sh, 'grep -v banana notes.txt')).out).toBe('apple\ncherry\n');
    expect((await run(sh, 'grep -r Projects Documents')).out).toBe('Documents/Projects/README.md:# Projects\n');
    expect((await run(sh, 'grep zzz notes.txt')).status).toBe(1);
    expect((await run(sh, 'grep "apple\\|cherry" notes.txt')).out).toBe('apple\ncherry\n');
  });

  it('head, tail and wc', async () => {
    expect((await run(sh, 'head -n 1 notes.txt')).out).toBe('apple\n');
    expect((await run(sh, 'tail -2 notes.txt')).out).toBe('cherry\nbanana\n');
    expect((await run(sh, 'wc notes.txt')).out).toBe('       4       4      27 notes.txt\n');
  });

  it('tail -f follows appends made anywhere on the disk until interrupted', async () => {
    const { BufferOutput } = await import('./interpreter');
    const out = new BufferOutput();
    const ac = new AbortController();
    const done = sh.run('tail -n 1 -f notes.txt', { stdout: out, stderr: new BufferOutput() }, ac.signal);
    await new Promise((r) => setTimeout(r, 5));
    fs.appendFile(`${HOME}/notes.txt`, 'date\n');
    expect(out.text).toBe('banana\ndate\n');
    ac.abort();
    expect(await done).toBe(130);
    fs.appendFile(`${HOME}/notes.txt`, 'elderberry\n');
    expect(out.text).toBe('banana\ndate\n');
  });

  it('sort -r / -n and cut', async () => {
    expect((await run(sh, 'sort -r notes.txt')).out).toBe('cherry\nbanana\nbanana\napple\n');
    expect((await run(sh, 'printf "10\\n9\\n100\\n" | sort -n')).out).toBe('9\n10\n100\n');
    expect((await run(sh, 'echo a:b:c | cut -d: -f2-')).out).toBe('b:c\n');
  });

  it('echo escapes and printf formats', async () => {
    expect((await run(sh, 'echo "a\\tb"')).out).toBe('a\tb\n');
    expect((await run(sh, 'echo -E "a\\tb"')).out).toBe('a\\tb\n');
    expect(formatPrintf('%-5s|%05.1f|%x|%3d', ['ab', '3.14159', '255', '7'])).toBe('ab   |003.1|ff|  7');
    expect(formatPrintf('%s\\n', ['a', 'b'])).toBe('a\nb\n');
  });
});

describe('shell state', () => {
  it('sources ~/.zshrc for aliases and exports', async () => {
    await run(sh, 'source ~/.zshrc');
    expect(sh.aliases.get('ll')).toBe('ls -la');
    expect((await run(sh, 'echo $GREETING')).out).toBe('hello\n');
    expect((await run(sh, 'll Documents')).out).toContain('a.md');
    expect((await run(sh, 'alias ll')).out).toBe("ll='ls -la'\n");
    expect((await run(sh, 'env')).out).toContain('GREETING=hello\n');
  });

  it('which / type describe commands', async () => {
    await run(sh, 'alias g=grep');
    expect((await run(sh, 'which ls cd g nope')).out).toBe('/bin/ls\ncd: shell built-in command\ng: aliased to grep\nnope not found\n');
    expect((await run(sh, 'type cd')).out).toBe('cd is a shell builtin\n');
  });

  it('runs shell scripts with arguments in a child shell', async () => {
    fs.writeFile(`${HOME}/hello.sh`, '#!/bin/zsh\necho "hi $1 from $0"\ncd /tmp\n');
    expect((await run(sh, './hello.sh there')).out).toBe(`hi there from ${HOME}/hello.sh\n`);
    expect(sh.cwd).toBe(HOME);
    expect((await run(sh, 'zsh -c "echo nested"')).out).toBe('nested\n');
    expect((await run(sh, './notes.txt')).err).toBe('zsh: permission denied: ./notes.txt\n');
  });

  it('runs commands by their install path, like /bin/ls', async () => {
    expect((await run(sh, '/bin/echo hi')).out).toBe('hi\n');
    expect((await run(sh, '/usr/bin/grep -c an notes.txt')).out).toBe('2\n');
    expect((await run(sh, '/usr/bin/ls')).err).toBe('zsh: no such file or directory: /usr/bin/ls\n');
  });

  it('stops runaway recursion instead of freezing', async () => {
    fs.writeFile(`${HOME}/loop.sh`, './loop.sh\n');
    const r = await run(sh, './loop.sh');
    expect(r.err).toContain('zsh: maximum nested function level reached');
    expect(r.status).toBe(1);
    expect((await run(sh, 'echo {a..z}{a..z}{a..z}{a..z}')).err).toBe('zsh: brace expansion produces too many words\n');
  });

  it('test / [ evaluate conditions for && and ||', async () => {
    expect((await run(sh, '[ -f notes.txt ] && echo file')).out).toBe('file\n');
    expect((await run(sh, '[ -d notes.txt ] || echo "not a dir"')).out).toBe('not a dir\n');
    expect((await run(sh, 'test -d Documents -a ! -e nope && echo ok')).out).toBe('ok\n');
    expect((await run(sh, 'X=3; [ $X -gt 2 ] && [ "$X" = 3 ] && echo yes')).out).toBe('yes\n');
    expect((await run(sh, '[ -z "" ]; echo $?; test; echo $?')).out).toBe('0\n1\n');
    expect((await run(sh, '[ 1 -eq 1')).err).toBe("[: ']' expected\n");
    expect((await run(sh, '[ a -lt 2 ]')).status).toBe(2);
  });

  it('chmod validates modes and refuses system files', async () => {
    expect((await run(sh, 'chmod +x notes.txt && chmod 755 Documents')).status).toBe(0);
    expect((await run(sh, 'chmod -x notes.txt')).status).toBe(0);
    expect((await run(sh, 'chmod bogus notes.txt')).err).toBe('chmod: Invalid file mode: bogus\n');
    expect((await run(sh, 'chmod +x ghost')).err).toBe('chmod: ghost: No such file or directory\n');
    expect((await run(sh, 'chmod 777 /etc/motd')).err).toBe('chmod: Unable to change file mode on /etc/motd: Operation not permitted\n');
  });

  it('exit stops the shell', async () => {
    await run(sh, 'exit 3; echo unreachable');
    expect(sh.exited).toBe(true);
    expect(sh.status).toBe(3);
  });

  it('sleep can be interrupted', async () => {
    const ac = new AbortController();
    const { BufferOutput } = await import('./interpreter');
    const p = sh.run('sleep 30; echo after', { stdout: new BufferOutput(), stderr: new BufferOutput() }, ac.signal);
    setTimeout(() => ac.abort(), 20);
    expect(await p).toBe(130);
  });
});
