/** Network commands: ping (simulated replies) and curl (real fetch, subject to CORS). */
import { basename, dirname, fs, t, useSystem } from '@/kernel';
import { owner } from '@/data/portfolio';
import { c } from '../ansi';
import type { CommandContext, CommandDef } from '../types';
import { getopt, humanBytes, padStart, seeded, sleep, writeDenied } from '../util';

/**
 * Reports whether the simulated network is reachable.
 *
 * True when Wi-Fi is enabled in the system settings and the browser does not
 * report itself offline (`navigator.onLine === false`). Outside a browser only
 * the Wi-Fi setting counts.
 *
 * @returns {boolean} True when network commands may reach remote hosts.
 *
 * @example
 * if (!online()) ctx.error('cannot resolve example.com: Unknown host');
 */
const online = () => useSystem.getState().settings.wifi && (typeof navigator === 'undefined' || navigator.onLine !== false);

/**
 * Hashes a host name to a stable unsigned 32-bit integer.
 *
 * Uses the `h * 31 + charCode` string hash, forced unsigned with `>>> 0`, so a
 * host always maps to the same fake address, base latency and TTL.
 *
 * @param {string} host - Host name or address as typed.
 * @returns {number} Unsigned 32-bit hash of the host.
 *
 * @example
 * const h = hashHost('example.com');
 * console.log(h === hashHost('example.com')); // true
 */
function hashHost(host: string): number {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Produces a deterministic fake IPv4 address for a host.
 *
 * `localhost` maps to 127.0.0.1 and a dotted-quad address is returned as is.
 * Any other name is hashed: the hash picks a realistic first octet from a fixed
 * list and derives the other octets, keeping the last one within 1-253.
 *
 * @param {string} host - Host name or address.
 * @returns {string} The address shown in ping output.
 *
 * @example
 * fakeIP('localhost'); // '127.0.0.1'
 * fakeIP('10.0.0.2'); // '10.0.0.2'
 */
function fakeIP(host: string): string {
  if (host === 'localhost') return '127.0.0.1';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const h = hashHost(host);
  const firsts = [142, 104, 151, 172, 13, 52, 185, 199];
  return `${firsts[h % firsts.length]}.${(h >>> 8) % 256}.${(h >>> 16) % 256}.${1 + ((h >>> 3) % 253)}`;
}

const ping: CommandDef = {
  name: 'ping',
  path: '/sbin',
  group: 'network',
  summary: { en: 'send ICMP echo requests to a host (^C to stop)', ko: '호스트에 ICMP 에코 요청 보내기 (^C로 중단)' },
  usage: 'ping [-c count] [-i wait] host',
  description: {
    en: 'Browsers can’t send ICMP packets, so the replies are simulated — but the timing, statistics and ^C behave like the real thing. Turning Wi-Fi off in Control Center makes hosts unreachable.',
    ko: '브라우저는 ICMP 패킷을 보낼 수 없어 응답은 시뮬레이션이지만, 타이밍과 통계, ^C 동작은 실제와 같습니다. 제어 센터에서 Wi-Fi를 끄면 호스트에 연결할 수 없습니다.',
  },
  options: [
    ['-c count', { en: 'Stop after sending count packets', ko: 'count개를 보낸 뒤 중지' }],
    ['-i wait', { en: 'Seconds between packets (default 1)', ko: '패킷 간격(초, 기본값 1)' }],
  ],
  /**
   * Runs `ping`, printing one simulated reply per interval until done or ^C.
   *
   * Parses `-c count` and `-i wait` (other BSD flags are accepted and ignored)
   * and prints the BSD usage text with exit 64 when no host is given. While
   * offline every host except localhost/127.* is unknown (exit 68). Reply times
   * come from a per-host base latency plus seeded jitter, so each host has a
   * stable latency and TTL; loopback replies take a fraction of a millisecond.
   * The wait between packets is an abortable sleep, so ^C ends the loop and the
   * statistics are still printed. After ^C the terminal is already on a new
   * line, so the blank line before the summary is only printed after a normal
   * finish. Packet loss is always 0%.
   *
   * @async
   * @param {CommandContext} ctx - Command context with arguments, output streams and abort signal.
   * @returns {Promise<number>} 0 after the statistics, 64 on a usage error, 68 when the host
   *   cannot be resolved.
   *
   * @example
   * // $ ping -c 3 example.com
   * const status = await ping.run(ctx); // 0
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'AaDdfnoQqRrv', values: 'ciWts' });
    const host = operands[0];
    if (error || !host) {
      ctx.stderr.write('usage: ping [-AaDdfnoQqRrv] [-c count] [-G sweepmaxsize]\n            [-g sweepminsize] [-h sweepincrsize] [-i wait]\n            [-l preload] [-M mask | time] [-m ttl] [-p pattern]\n            [-S src_addr] [-s packetsize] [-t timeout][-W waittime]\n            [-z tos] host\n');
      return 64;
    }
    if (!online() && host !== 'localhost' && !host.startsWith('127.')) {
      ctx.error(`cannot resolve ${host}: Unknown host`);
      return 68;
    }
    const count = typeof opts.c === 'string' ? Math.max(1, Number(opts.c) || 1) : Infinity;
    const wait = typeof opts.i === 'string' ? Math.max(0.1, Number(opts.i) || 1) : 1;
    const ip = fakeIP(host);
    const local = ip.startsWith('127.');
    const base = local ? 0.05 : 6 + (hashHost(host) % 60);
    const ttl = local ? 64 : 52 + (hashHost(host) % 64);
    ctx.print(`PING ${host} (${ip}): 56 data bytes`);
    const times: number[] = [];
    let sent = 0;
    while (sent < count) {
      if (sent > 0 && !(await sleep(wait * 1000, ctx.signal))) break;
      const jitter = local ? seeded(Date.now()) * 0.08 : (seeded(Date.now() / 7 + sent) - 0.3) * base * 0.35;
      const time = Math.max(0.02, base + jitter);
      times.push(time);
      ctx.print(`64 bytes from ${ip}: icmp_seq=${sent} ttl=${ttl} time=${time.toFixed(3)} ms`);
      sent++;
    }
    const n = times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const sd = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n));
    ctx.print(`${ctx.signal.aborted ? '' : '\n'}--- ${host} ping statistics ---`);
    ctx.print(`${n} packets transmitted, ${n} packets received, 0.0% packet loss`);
    if (n) ctx.print(`round-trip min/avg/max/stddev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${sd.toFixed(3)} ms`);
    return 0;
  },
}; /** `ping` command: prints simulated ICMP echo replies and BSD-style round-trip statistics. */

/**
 * Decides whether a Content-Type should be handled as text.
 *
 * An empty type counts as text; otherwise text/*, JSON, XML, JavaScript,
 * ECMAScript, SVG, form-encoded, CSV and YAML types are text. Text bodies are
 * printed or saved as file content, anything else is treated as binary.
 *
 * @param {string} type - Content-Type header value (parameters such as charset are allowed).
 * @returns {boolean} True for textual content types.
 *
 * @example
 * isTextType('application/json; charset=utf-8'); // true
 * isTextType('image/png'); // false
 */
const isTextType = (type: string) => !type || /^text\/|json|xml|javascript|ecmascript|svg|x-www-form-urlencoded|csv|yaml/.test(type);

/**
 * Reads a Blob into a base64 `data:` URL.
 *
 * Wraps `FileReader.readAsDataURL` in a Promise. Binary downloads are stored in
 * the virtual file system as a data URL in the node's `src`.
 *
 * @param {Blob} blob - Response body to encode.
 * @returns {Promise<string>} The `data:<mime>;base64,...` URL.
 * @throws {DOMException} Rejects with the FileReader error when the blob cannot be read.
 *
 * @example
 * const src = await blobToDataURL(await res.blob());
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Writes curl's transfer progress table to stderr.
 *
 * Prints the two header lines and one completed (100%) row with the total size
 * and the average download speed, computed from the byte count and elapsed
 * time (clamped to at least 1 ms). Sizes drop the trailing `B` like curl does.
 *
 * @param {CommandContext} ctx - Command context whose stderr receives the table.
 * @param {number} bytes - Number of bytes transferred.
 * @param {number} ms - Elapsed transfer time in milliseconds.
 * @returns {void}
 *
 * @example
 * progressMeter(ctx, blob.size, performance.now() - started);
 */
function progressMeter(ctx: CommandContext, bytes: number, ms: number): void {
  const speed = humanBytes(Math.round(bytes / Math.max(0.001, ms / 1000))).replace(/B$/, '');
  const size = humanBytes(bytes).replace(/B$/, '');
  ctx.stderr.write(
    '  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n' +
      '                                 Dload  Upload   Total   Spent    Left  Speed\n' +
      `100 ${padStart(size, 5)}  100 ${padStart(size, 5)}    0     0  ${padStart(speed, 5)}      0 --:--:-- --:--:-- --:--:-- ${padStart(speed, 5)}\n`,
  );
}

const curl: CommandDef = {
  name: 'curl',
  path: '/usr/bin',
  group: 'network',
  summary: { en: 'transfer a URL', ko: 'URL 전송' },
  usage: 'curl [-sSfIL] [-o file | -O] url',
  description: {
    en: 'Fetches a URL with the browser’s fetch(). Sites that don’t allow cross-origin requests (CORS) can’t be read from a web page — try an API such as https://api.github.com/users/<name>.',
    ko: '브라우저의 fetch()로 URL을 가져옵니다. 교차 출처 요청(CORS)을 허용하지 않는 사이트는 웹 페이지에서 읽을 수 없습니다 — https://api.github.com/users/<이름> 같은 API를 사용해 보세요.',
  },
  options: [
    ['-o file', { en: 'Write output to a file in the virtual disk', ko: '출력을 가상 디스크의 파일에 저장' }],
    ['-O', { en: 'Save using the remote file name', ko: '원격 파일 이름으로 저장' }],
    ['-I', { en: 'Show response headers only', ko: '응답 헤더만 표시' }],
    ['-i', { en: 'Include response headers in the output', ko: '출력에 응답 헤더 포함' }],
    ['-s', { en: 'Silent mode', ko: '조용히 실행' }],
    ['-f', { en: 'Fail on HTTP errors', ko: 'HTTP 오류 시 실패 처리' }],
  ],
  /**
   * Runs `curl`, fetching a URL and writing the body to stdout or a file.
   *
   * URLs without a scheme get `https://`; only http and https are supported.
   * `-X`, `-H` (a single header), `-d` (implies POST) and `-I` (HEAD) shape the
   * request, which ^C aborts through the context signal. A failed fetch usually
   * means the site blocks cross-origin requests, so a hint suggesting a
   * CORS-friendly API is printed unless silent (`-s` without `-S`). `-f` turns
   * HTTP error statuses into exit 22, `-i` prefixes the body with the headers.
   * With `-o file` or `-O` (remote name, falling back to index.html) the body is
   * saved to the virtual disk, text types as content and others as a data URL
   * with size and MIME type, followed by a progress meter unless silent. Binary
   * bodies are never printed to the terminal.
   *
   * @async
   * @param {CommandContext} ctx - Command context with arguments, output streams and abort signal.
   * @returns {Promise<number>} 0 on success, otherwise a curl exit code: 1 unsupported
   *   protocol, 2 bad option or missing URL, 3 malformed URL, 6 offline, 7 connection failure,
   *   22 HTTP error with -f, 23 write failure or binary output, 130 when aborted.
   * @throws {FSError} When saving the body with -o/-O fails, e.g. the target is a directory or
   *   a locked file.
   * @throws {DOMException} When ^C aborts the transfer while the response body is being read,
   *   or when a binary body cannot be encoded as a data URL.
   *
   * @example
   * // $ curl -s https://api.github.com/users/octocat
   * const status = await curl.run(ctx); // 0
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'sSfIiLOkv', values: 'oXHdA', long: { silent: 's', fail: 'f', head: 'I', include: 'i', location: 'L', output: 'o', 'remote-name': 'O', request: 'X', header: 'H', data: 'd' } });
    if (error) {
      ctx.stderr.write(`curl: option ${error.replace(/^.*-- /, '-')}: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information\n`);
      return 2;
    }
    let url = operands[0];
    if (!url) {
      ctx.stderr.write("curl: try 'curl --help' or 'curl --manual' for more information\n");
      return 2;
    }
    if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      ctx.stderr.write(`curl: (3) URL rejected: Malformed input to a URL function\n`);
      return 3;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      ctx.stderr.write(`curl: (1) Protocol "${parsed.protocol.slice(0, -1)}" not supported\n`);
      return 1;
    }
    if (!online()) {
      ctx.stderr.write(`curl: (6) Could not resolve host: ${parsed.hostname}\n`);
      return 6;
    }
    const silent = !!opts.s && !opts.S;
    const headers: Record<string, string> = {};
    if (typeof opts.H === 'string') {
      const [k, ...v] = opts.H.split(':');
      headers[k.trim()] = v.join(':').trim();
    }
    const method = typeof opts.X === 'string' ? opts.X.toUpperCase() : opts.I ? 'HEAD' : typeof opts.d === 'string' ? 'POST' : 'GET';
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(parsed.href, { method, headers, body: typeof opts.d === 'string' ? opts.d : undefined, signal: ctx.signal, redirect: 'follow' });
    } catch (e) {
      if (ctx.signal.aborted) return 130;
      if (!silent) {
        ctx.stderr.write(`curl: (7) Failed to connect to ${parsed.hostname}: ${(e as Error).message || 'network error'}\n`);
        ctx.stderr.write(
          c.dim(
            t({
              en: `      The browser blocked this request (the site doesn't allow cross-origin requests).\n      Try a CORS-friendly URL, e.g.: curl https://api.github.com/users/${owner.handle}\n`,
              ko: `      브라우저가 이 요청을 차단했습니다 (사이트가 교차 출처 요청을 허용하지 않음).\n      CORS를 허용하는 URL을 사용해 보세요. 예: curl https://api.github.com/users/${owner.handle}\n`,
            }),
          ),
        );
      }
      return 7;
    }
    if (opts.f && !res.ok) {
      if (!silent) ctx.stderr.write(`curl: (22) The requested URL returned error: ${res.status}\n`);
      return 22;
    }
    const headerText = `HTTP/2 ${res.status}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n`;
    if (opts.I) {
      ctx.stdout.write(headerText);
      return 0;
    }
    const type = res.headers.get('content-type') ?? '';
    const outName = typeof opts.o === 'string' ? opts.o : opts.O ? basename(parsed.pathname) || 'index.html' : null;
    if (outName) {
      const path = ctx.resolve(outName);
      const denied = fs.isDir(dirname(path)) ? writeDenied(dirname(path)) : 'No such file or directory';
      if (denied) {
        ctx.stderr.write(`curl: (23) Failed writing body: ${outName}: ${denied}\n`);
        return 23;
      }
      const blob = await res.blob();
      if (isTextType(type)) fs.writeFile(path, await blob.text());
      else fs.writeFile(path, '', { src: await blobToDataURL(blob), bytes: blob.size, mime: type.split(';')[0] || undefined });
      if (!silent) progressMeter(ctx, blob.size, performance.now() - started);
      return 0;
    }
    if (!isTextType(type)) {
      ctx.stderr.write('Warning: Binary output can mess up your terminal. Use "--output -" to tell\nWarning: curl to output it to your terminal anyway, or consider "--output\nWarning: <FILE>" to save to a file.\n');
      return 23;
    }
    const body = await res.text();
    ctx.stdout.write((opts.i ? headerText : '') + body);
    return 0;
  },
}; /** `curl` command: transfers a URL with the browser's fetch(), printing or saving the response. */

export const NET_COMMANDS: CommandDef[] = [ping, curl]; /** Network commands contributed to the command registry. */
