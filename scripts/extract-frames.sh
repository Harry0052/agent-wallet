#!/usr/bin/env bash
# ─── Smart Wallet: hero-loop.mp4 → frame sequence ────────────────────────────
#
# Usage:
#   chmod +x scripts/extract-frames.sh
#   ./scripts/extract-frames.sh
#
# Requirements: ffmpeg (brew install ffmpeg)
#
# Output:
#   public/frames/hero/frame-000.jpg … frame-089.jpg  (90 frames, 10fps)
#
# Why 10fps?
#   Source video is 9s × 30fps = 270 frames.
#   For scroll scrubbing we don't need 30fps precision.
#   10fps → 90 frames → ~36px of scroll per frame at 400vh section height.
#   That is exceptionally smooth and keeps total payload under 3MB.
#
# Why JPEG, not WebP?
#   JPEG is natively output by ffmpeg without extra codec flags.
#   For UI content (flat colors, clean text) JPEG at qscale:v 2 is ~85%
#   quality and compresses to ~20-40KB per frame.
#   Total payload: ~90 × 30KB = ~2.7MB — well within budget.
#   If you want WebP run the optional WebP block below.

set -euo pipefail

SRC="public/hero-loop.mp4"
OUT="public/frames/hero"
FPS=10

if ! command -v ffmpeg &>/dev/null; then
  echo "❌  ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -f "$SRC" ]; then
  echo "❌  Source video not found: $SRC"
  echo "    Run from the project root directory."
  exit 1
fi

echo "📽  Probing source video…"
ffprobe -v quiet -show_streams -of json "$SRC" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
v = next(s for s in d['streams'] if s['codec_type'] == 'video')
dur = float(v.get('duration', 0))
r = v['r_frame_rate'].split('/')
fps = int(r[0]) / int(r[1])
print(f'  Duration : {dur:.1f}s')
print(f'  Source FPS: {fps:.0f}fps')
print(f'  Size     : {v[\"width\"]}×{v[\"height\"]}')
print(f'  Extracting at {int('$FPS')}fps → {int(dur * int('$FPS'))} frames')
" 2>/dev/null || echo "  (probe skipped — ffprobe not available)"

mkdir -p "$OUT"

echo "🎞  Extracting frames at ${FPS}fps → ${OUT}/"
ffmpeg -y \
  -i "$SRC" \
  -vf "fps=${FPS}" \
  -qscale:v 2 \
  -start_number 0 \
  "${OUT}/frame-%03d.jpg" \
  2>&1 | grep -E "(frame=|fps=|time=|error|Error)" || true

FRAME_COUNT=$(ls -1 "${OUT}"/frame-*.jpg 2>/dev/null | wc -l | tr -d ' ')
echo "✅  Extracted ${FRAME_COUNT} frames to ${OUT}/"
echo ""
echo "📦  Estimating payload size:"
du -sh "${OUT}" 2>/dev/null || echo "   (du not available)"
echo ""
echo "🚀  Done. The ScrollVideoSection will auto-detect frames on next page load."

# ─── Optional: WebP variant (smaller, requires libwebp codec) ────────────────
# Uncomment to generate WebP frames instead of JPEG:
#
# echo "🎞  Extracting WebP frames…"
# ffmpeg -y \
#   -i "$SRC" \
#   -vf "fps=${FPS}" \
#   -c:v libwebp \
#   -quality 82 \
#   -lossless 0 \
#   -start_number 0 \
#   "${OUT}/frame-%03d.webp"
#
# If you use WebP, update FRAME_SRC in components/ScrollVideoSection.tsx:
#   const FRAME_SRC = (i: number) =>
#     `/frames/hero/frame-${String(i).padStart(3,'0')}.webp`;
