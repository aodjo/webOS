#!/usr/bin/env node
/**
 * Boots the Alpine image in Node with v86 and saves a snapshot of the booted machine, so the
 * Linux app restores a logged-in system in a moment instead of booting the kernel.
 *
 * Run after scripts/vm/build.sh (`node scripts/vm/build-state.mjs`). The machine configuration
 * (memory, kernel command line) must match the one in src/apps/linux/machine.ts, or the
 * snapshot will not restore. Writes public/vm/alpine-state.bin.zst (needs the `zstd` CLI).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import { V86 } from 'v86';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../..'); /** Project root. */
const VM = path.join(ROOT, 'public/vm'); /** Folder with the image files. */
const OUT = path.join(VM, 'alpine-state.bin'); /** Uncompressed snapshot path; removed after compression. */

const emulator = new V86({
  wasm_path: path.join(ROOT, 'node_modules/v86/build/v86.wasm'),
  bios: { url: path.join(VM, 'seabios.bin') },
  vga_bios: { url: path.join(VM, 'vgabios.bin') },
  autostart: true,
  memory_size: 256 * 1024 * 1024,
  vga_memory_size: 8 * 1024 * 1024,
  bzimage_initrd_from_filesystem: true,
  cmdline: 'rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci tsc=reliable init_on_free=on nomodeset quiet',
  filesystem: { baseurl: path.join(VM, 'alpine-rootfs-flat'), basefs: path.join(VM, 'alpine-fs.json') },
});

console.log('Booting…');
let serial = '';
let booted = false;
const started = Date.now();

emulator.add_listener('serial0-output-byte', (byte) => {
  serial += String.fromCharCode(byte);
  if (booted || !/root@webos[^\n]*# $/.test(serial.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''))) return;
  booted = true;
  console.log(`Logged in after ${Math.round((Date.now() - started) / 1000)} s; settling…`);
  emulator.serial0_send('clear; sync; echo 3 >/proc/sys/vm/drop_caches\n');
  setTimeout(async () => {
    const state = await emulator.save_state();
    fs.writeFileSync(OUT, new Uint8Array(state));
    execFileSync('zstd', ['-19', '-f', '--rm', '-q', OUT]);
    console.log(`Saved ${OUT}.zst (${(fs.statSync(`${OUT}.zst`).size / 1048576).toFixed(1)} MB)`);
    emulator.destroy();
    process.exit(0);
  }, 10_000);
});

setTimeout(() => {
  console.error('Timed out waiting for the shell prompt. Serial output so far:\n' + serial.slice(-2000));
  process.exit(1);
}, 15 * 60_000);
