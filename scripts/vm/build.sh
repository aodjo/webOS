#!/usr/bin/env bash
# Builds the Alpine Linux image of the Linux app into public/vm:
#   alpine-fs.json      9p file system index (zstd-compressed)
#   alpine-rootfs-flat/ file contents named by their SHA-256 (zstd-compressed), fetched lazily
# Needs Docker (with linux/386 emulation), git and Python 3; `zstandard` is installed into a
# temporary virtualenv. Run scripts/vm/build-state.mjs afterwards for the instant-boot snapshot.
set -euo pipefail

cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
OUT="$ROOT/public/vm"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

V86_REF=master
git clone -q --depth 1 --branch "$V86_REF" https://github.com/copy/v86.git "$WORK/v86"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q zstandard

docker build . --platform linux/386 --tag webos/alpine-v86
CID=$(docker create --platform linux/386 webos/alpine-v86)
docker export "$CID" -o "$WORK/rootfs.tar"
docker rm "$CID" >/dev/null
tar -f "$WORK/rootfs.tar" --delete ".dockerenv" 2>/dev/null || true

rm -rf "$OUT/alpine-rootfs-flat" "$OUT/alpine-fs.json"
mkdir -p "$OUT/alpine-rootfs-flat"
"$WORK/venv/bin/python" "$WORK/v86/tools/fs2json.py" --zstd --out "$OUT/alpine-fs.json" "$WORK/rootfs.tar"
"$WORK/venv/bin/python" "$WORK/v86/tools/copy-to-sha256.py" --zstd "$WORK/rootfs.tar" "$OUT/alpine-rootfs-flat"
cp "$WORK/v86/bios/seabios.bin" "$WORK/v86/bios/vgabios.bin" "$OUT/"
cp "$WORK/v86/bios/COPYING.LESSER" "$OUT/SEABIOS-LICENSE.txt"

echo "Wrote $OUT ($(du -sh "$OUT" | cut -f1))"
