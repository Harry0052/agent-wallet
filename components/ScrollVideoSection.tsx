'use client';
/**
 * ScrollVideoSection — scroll-scrubbed cinematic video section
 *
 * Two rendering modes (auto-detected on mount):
 *   "frames"  — image-sequence mode: preloads JPEG frames, maps scroll→frame
 *               index. Silky smooth. Requires running scripts/extract-frames.sh first.
 *   "video"   — video-seek mode: hidden <video> element, sets currentTime on
 *               scroll, draws to canvas on seeked event. Works immediately with
 *               the raw MP4 — no preprocessing needed.
 *
 * Fallbacks:
 *   • prefers-reduced-motion → autoplay MP4 in a standard container
 *   • viewport ≤ 768px       → autoplay MP4 (scroll-scrub is desktop-only)
 *   • frames not found       → silently downgrade to video-seek mode
 *   • video fails to load    → static poster frame fallback
 *
 * To upgrade from video-seek → frame mode:
 *   chmod +x scripts/extract-frames.sh && ./scripts/extract-frames.sh
 *   The component auto-detects and switches on next page load.
 *
 * To replace the video later:
 *   1. Swap public/hero-loop.mp4
 *   2. Re-run scripts/extract-frames.sh
 *   3. Update TOTAL_FRAMES if the new video duration differs
 *   4. Update SCENES frame boundaries if the content structure changes
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

// ─── Config ───────────────────────────────────────────────────────────────────

const VIDEO_SRC = '/hero-loop.mp4';
const FRAME_SRC = (i: number) =>
  `/frames/hero/frame-${String(i).padStart(3, '0')}.jpg`;

/** Must match frame count produced by scripts/extract-frames.sh */
const TOTAL_FRAMES = 90;

/** Sticky section = SCROLL_VH × viewport height tall.
 *  Gives SCROLL_VH − 1 viewport-heights of scroll distance. */
const SCROLL_VH = 4;

/** Eager frames to preload before revealing canvas in frames mode */
const EAGER_COUNT = 15;

/** Minimum video time change (seconds) to trigger a seek (= 1 source frame at 30fps) */
const SEEK_DEADBAND = 1 / 30;

// ─── Scenes ───────────────────────────────────────────────────────────────────

interface Scene {
  fromFrame: number; // inclusive
  toFrame: number;   // exclusive
  kicker: string;
  headline: string;
  body: string;
  accent: string;
}

const SCENES: Scene[] = [
  {
    fromFrame: 0,
    toFrame: 30,
    kicker: 'Recurring spend',
    headline: 'Every subscription, surfaced automatically',
    body: 'Agent Wallet scans your transaction history and flags recurring charges — with renewal dates, risk signals, and one-click actions.',
    accent: '#FDBA74',
  },
  {
    fromFrame: 30,
    toFrame: 60,
    kicker: 'Found money',
    headline: "Money you didn't know you were losing",
    body: "Duplicate charges, ghost subscriptions, and price drops — found and queued for action before you'd ever notice.",
    accent: '#FBCFE8',
  },
  {
    fromFrame: 60,
    toFrame: 90,
    kicker: 'Connection health',
    headline: 'Your financial data, always in sync',
    body: 'Live sync across every connected account. When a link drops, Agent Wallet surfaces it instantly — and walks you through the fix.',
    accent: '#FDE68A',
  },
];


// ─── Tokens (mirrors LandingPage LT system) ───────────────────────────────────

const C = {
  bg: '#FFF7ED',
  white: '#FFFCF8',
  text: '#111111',
  textSoft: '#3A332E',
  textMuted: '#6B5B4B',
  border: '#F2DECC',
  shadowLg: '0 24px 80px rgba(17,17,17,0.10), 0 4px 16px rgba(17,17,17,0.06)',
  shadowMd: '0 8px 32px rgba(17,17,17,0.08)',
  display: "'Space Grotesk', 'DM Sans', system-ui, sans-serif",
  body: "'DM Sans', system-ui, sans-serif",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'detecting' | 'frames' | 'video' | 'fallback';

// ─── Component ────────────────────────────────────────────────────────────────

export function ScrollVideoSection() {
  // ── Refs (non-reactive, mutation-safe) ──────────────────────────────────
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  /** Loaded frame images (frames mode) */
  const frameImages = useRef<(HTMLImageElement | null)[]>(
    Array(TOTAL_FRAMES).fill(null),
  );
  /** Last frame drawn (frames mode) */
  const lastFrameIdx = useRef(-1);
  /** Last video time set (video mode) */
  const lastVideoTime = useRef(-1);
  /** Pending RAF id */
  const raf = useRef<number | null>(null);
  /** Seek queue (video mode) */
  const seekLock = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  /** Current scene index (ref to avoid stale closure in scroll handler) */
  const sceneIdxRef = useRef(0);

  // ── State (only for things that drive re-renders) ────────────────────────
  const [mode, setMode]               = useState<Mode>('detecting');
  const [ready, setReady]             = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isMobile, setIsMobile]       = useState(false);
  const [currentScene, setCurrentScene] = useState<Scene>(SCENES[0]);
  const [scrollPct, setScrollPct]     = useState(0);

  // ── Environment detection ────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    setIsMobile(window.innerWidth < 768);
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Mode detection: probe for extracted frames ───────────────────────────
  useEffect(() => {
    if (reducedMotion || isMobile) {
      setMode('fallback');
      return;
    }
    const probe = new Image();
    probe.onload  = () => setMode('frames');
    probe.onerror = () => setMode('video');
    probe.src = FRAME_SRC(0);
  }, [reducedMotion, isMobile]);

  // ── Canvas drawing util ──────────────────────────────────────────────────
  const drawSource = useCallback(
    (source: HTMLImageElement | HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    },
    [],
  );

  // ── Frame-sequence mode setup ────────────────────────────────────────────
  const loadFrame = useCallback(
    (i: number) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        if (frameImages.current[i]) return resolve(frameImages.current[i]!);
        const img = new Image();
        img.onload = () => { frameImages.current[i] = img; resolve(img); };
        img.onerror = reject;
        img.src = FRAME_SRC(i);
      }),
    [],
  );

  useEffect(() => {
    if (mode !== 'frames') return;
    let cancelled = false;

    const eagerIndices = Array.from({ length: EAGER_COUNT }, (_, i) => i);
    Promise.all(eagerIndices.map((i) => loadFrame(i).catch(() => null))).then(
      (results) => {
        if (cancelled) return;
        const loaded = results.filter(Boolean);
        if (loaded.length === 0) {
          // No frames found after mode was set — fall through to video mode
          setMode('video');
          return;
        }
        drawSource(frameImages.current[0]!);
        setReady(true);

        // Load remaining frames lazily
        const loadRest = () => {
          Array.from(
            { length: TOTAL_FRAMES - EAGER_COUNT },
            (_, i) => i + EAGER_COUNT,
          ).forEach((i) => loadFrame(i).catch(() => {}));
        };
        if ('requestIdleCallback' in window) {
          (window as Window & typeof globalThis).requestIdleCallback(loadRest, { timeout: 2000 });
        } else {
          setTimeout(loadRest, 500);
        }
      },
    );
    return () => { cancelled = true; };
  }, [mode, loadFrame, drawSource]);

  // ── Video-seek mode setup ────────────────────────────────────────────────
  const videoSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (seekLock.current) {
      pendingSeek.current = time;
      return;
    }
    seekLock.current = true;
    video.currentTime = time;
  }, []);

  useEffect(() => {
    if (mode !== 'video') return;
    const video = videoRef.current;
    if (!video) return;

    const onSeeked = () => {
      drawSource(video);
      seekLock.current = false;
      if (pendingSeek.current !== null) {
        const t = pendingSeek.current;
        pendingSeek.current = null;
        videoSeek(t);
      }
    };
    const onReady = () => {
      drawSource(video);
      setReady(true);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    return () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
    };
  }, [mode, drawSource, videoSeek]);

  // ── Scroll handler ───────────────────────────────────────────────────────
  const onScroll = useCallback(() => {
    const section = sectionRef.current;
    if (!section || !ready) return;

    const scrollable = section.offsetHeight - window.innerHeight;
    const scrolled   = Math.max(0, -section.getBoundingClientRect().top);
    const progress   = Math.min(1, scrolled / scrollable);

    // Update progress bar directly (no re-render)
    if (progressBarRef.current) {
      progressBarRef.current.style.width = `${progress * 100}%`;
    }

    // Update scroll % state (drives scroll-hint opacity)
    setScrollPct(progress);

    // Derive target frame from progress
    const targetFrame = Math.round(progress * (TOTAL_FRAMES - 1));

    // Update scene if changed (cheap index compare)
    const newSceneIdx = SCENES.findIndex(
      (s) => targetFrame >= s.fromFrame && targetFrame < s.toFrame,
    );
    if (newSceneIdx !== -1 && newSceneIdx !== sceneIdxRef.current) {
      sceneIdxRef.current = newSceneIdx;
      setCurrentScene(SCENES[newSceneIdx]);
    }

    if (mode === 'frames') {
      if (targetFrame === lastFrameIdx.current) return;
      lastFrameIdx.current = targetFrame;
      const img = frameImages.current[targetFrame];
      if (!img) return;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => drawSource(img));
    }

    if (mode === 'video') {
      const video = videoRef.current;
      if (!video || !video.duration) return;
      const targetTime = progress * video.duration;
      if (Math.abs(targetTime - lastVideoTime.current) < SEEK_DEADBAND) return;
      lastVideoTime.current = targetTime;
      videoSeek(targetTime);
    }
  }, [mode, ready, drawSource, videoSeek]);

  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [onScroll]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const activeIdx = SCENES.indexOf(currentScene);

  // ── Fallback render (reduced motion + mobile) ────────────────────────────
  if (mode === 'fallback') {
    return (
      <section
        style={{
          padding: '88px 20px',
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          fontFamily: C.body,
        }}
      >
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: '#111111',
                background: '#FFF1E6',
                border: '1px solid #F2DECC',
                borderRadius: 100,
                padding: '4px 14px',
              }}
            >
              See it in action
            </span>
            <h2
              style={{
                margin: '16px 0 12px',
                fontSize: 'clamp(26px, 3vw, 38px)',
                fontWeight: 700,
                color: C.text,
                fontFamily: C.display,
                lineHeight: 1.15,
              }}
            >
              Your finances, intelligently surfaced
            </h2>
            <p style={{ margin: 0, fontSize: 16, color: C.textSoft, lineHeight: 1.7 }}>
              Recurring spend detection, found-money insights, and connection health — all in one place.
            </p>
          </div>
          <div
            style={{
              borderRadius: 20,
              overflow: 'hidden',
              border: `1px solid ${C.border}`,
              boxShadow: C.shadowLg,
              aspectRatio: '16/9',
              background: C.bg,
            }}
          >
            <video
              src={VIDEO_SRC}
              autoPlay
              loop
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        </div>
      </section>
    );
  }

  // ── Main scroll experience ────────────────────────────────────────────────
  return (
    <section
      ref={sectionRef}
      style={{
        height: `${SCROLL_VH * 100}vh`,
        position: 'relative',
        fontFamily: C.body,
      }}
    >
      {/* Hidden video element for seek mode */}
      {(mode === 'video' || mode === 'detecting') && (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          preload="auto"
          muted
          playsInline
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* ── Sticky viewport ─────────────────────────────────────────────── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Thin progress bar — top edge */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: C.border,
            zIndex: 10,
          }}
        >
          <div
            ref={progressBarRef}
            style={{
              height: '100%',
              width: '0%',
              background: currentScene.accent,
              transition: 'background-color 0.6s ease',
            }}
          />
        </div>

        {/* Section eyebrow — top center */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.12em',
              color: C.textMuted,
            }}
          >
            See it in action
          </span>
        </div>

        {/* Canvas — center stage */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            flex: 1,
            paddingTop: 48,
            paddingBottom: 140,
          }}
        >
          {/* Loading skeleton */}
          {!ready && (
            <div
              style={{
                position: 'absolute',
                width: 'min(88vw, calc(70vh * 16 / 9))',
                aspectRatio: '16/9',
                borderRadius: 16,
                background: 'linear-gradient(90deg, #F2DECC 25%, #FFF1E6 50%, #F2DECC 75%)',
                backgroundSize: '200% 100%',
                animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
              }}
            />
          )}

          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            style={{
              maxWidth: '88vw',
              maxHeight: '70vh',
              width: 'auto',
              height: 'auto',
              borderRadius: 16,
              boxShadow: C.shadowLg,
              border: `1px solid ${C.border}`,
              display: 'block',
              opacity: ready ? 1 : 0,
              transition: 'opacity 0.5s ease',
            }}
          />
        </div>

        {/* Scene info panel — bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            width: 'min(90vw, 520px)',
            textAlign: 'center',
          }}
        >
          {/* Kicker badge */}
          <span
            key={currentScene.kicker}
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.11em',
              color: currentScene.accent,
              background: `${currentScene.accent}12`,
              border: `1px solid ${currentScene.accent}28`,
              borderRadius: 100,
              padding: '4px 14px',
              transition: 'color 0.5s ease, background 0.5s ease, border-color 0.5s ease',
            }}
          >
            {currentScene.kicker}
          </span>

          {/* Headline */}
          <p
            style={{
              margin: 0,
              fontSize: 'clamp(15px, 1.5vw, 19px)',
              fontWeight: 700,
              color: C.text,
              fontFamily: C.display,
              lineHeight: 1.25,
            }}
          >
            {currentScene.headline}
          </p>

          {/* Body */}
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: C.textSoft,
              lineHeight: 1.65,
              maxWidth: 480,
            }}
          >
            {currentScene.body}
          </p>

          {/* Progress dots */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 4,
              alignItems: 'center',
            }}
          >
            {SCENES.map((s, i) => (
              <div
                key={i}
                style={{
                  height: 5,
                  width: i === activeIdx ? 22 : 5,
                  borderRadius: 3,
                  background: i === activeIdx ? s.accent : C.border,
                  transition: 'width 0.35s ease, background 0.35s ease',
                }}
              />
            ))}
          </div>
        </div>

        {/* Scroll hint — visible only before first scroll */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            right: 36,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            opacity: scrollPct < 0.04 ? 1 : 0,
            transition: 'opacity 0.6s ease',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.textMuted,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
            }}
          >
            Scroll
          </span>
          <svg
            width={16}
            height={24}
            viewBox="0 0 16 24"
            fill="none"
            style={{ animation: 'scroll-bounce 1.8s ease-in-out infinite' }}
          >
            <rect x={1} y={1} width={14} height={22} rx={7} stroke={C.border} strokeWidth={1.5} />
            <rect
              x={7}
              y={5}
              width={2}
              height={6}
              rx={1}
              fill={C.textMuted}
              style={{ animation: 'scroll-dot 1.8s ease-in-out infinite' }}
            />
          </svg>
        </div>

        {/* CSS keyframes injected once */}
        <style>{`
          @keyframes skeleton-shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @keyframes scroll-bounce {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(4px); }
          }
          @keyframes scroll-dot {
            0%, 100% { opacity: 1; transform: translateY(0); }
            50%       { opacity: 0.4; transform: translateY(4px); }
          }
        `}</style>
      </div>
    </section>
  );
}
