/**
 * The virtual PC behind the Linux app: a v86 x86 emulator booting the Alpine Linux image from
 * public/vm (built by scripts/vm/build.sh) and restoring its booted snapshot.
 */
import { V86 } from 'v86';
import wasmUrl from 'v86/build/v86.wasm?url';

const VM_BASE = '/vm'; /** Public folder holding the BIOS, the 9p file system and the snapshot. */

/**
 * Creates and starts the virtual machine, drawing its text console into `screen` when given.
 *
 * The hardware (256 MB RAM, no network card, 9p root file system and kernel command line) matches
 * scripts/vm/build-state.mjs exactly, because the machine resumes from the snapshot that script
 * saved instead of booting. Files of the root file system are fetched from `VM_BASE` on first
 * access.
 *
 * @param {HTMLElement | null} screen - Container with a `<div>` for text mode and a `<canvas>` for
 *   graphics, or null for a headless machine used only through its serial port.
 * @returns {V86} The running emulator.
 *
 * @example
 * const vm = createMachine(screenRef.current!);
 * vm.add_listener('emulator-ready', () => console.log('ready'));
 */
export function createMachine(screen: HTMLElement | null): V86 {
  return new V86({
    wasm_path: wasmUrl,
    bios: { url: `${VM_BASE}/seabios.bin` },
    vga_bios: { url: `${VM_BASE}/vgabios.bin` },
    memory_size: 256 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    bzimage_initrd_from_filesystem: true,
    cmdline: 'rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci tsc=reliable init_on_free=on nomodeset quiet',
    filesystem: { baseurl: `${VM_BASE}/alpine-rootfs-flat/`, basefs: `${VM_BASE}/alpine-fs.json` },
    initial_state: { url: `${VM_BASE}/alpine-state.bin.zst` },
    screen_container: screen,
    disable_mouse: true,
    autostart: true,
  });
}
