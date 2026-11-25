import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ANIMATION_CONFIG,
  ANIMATION_EASING,
  getAnimationTotalMs,
  INTRO_PROFILE,
} from './animation.config';
import {
  FULL_LOGO,
  LOGIN_LOADING_IMAGES,
  LOGO_CANVAS,
  LOGO_PIECES,
  WORDMARK,
} from './logoPieces.config';
import LoadingBackground from './LoadingBackground';
import './LoginLoadingScreen.css';

const PULSE_IDS = ['centerleft', 'centerright'];

let preloadPromise;

export function preloadLoginImages() {
  if (!preloadPromise) {
    const imageLoads = LOGIN_LOADING_IMAGES.map((src) => new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        resolve(loaded);
      };

      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = src;

      if (typeof image.decode === 'function') {
        image.decode().then(
          () => finish(true),
          () => {
            if (image.complete) finish(image.naturalWidth > 0);
          }
        );
      }
    }));

    let timeout;
    preloadPromise = Promise.race([
      Promise.all(imageLoads).then((results) => results.every(Boolean)),
      new Promise((resolve) => {
        timeout = window.setTimeout(() => resolve(false), ANIMATION_CONFIG.assetTimeoutMs);
      }),
    ]).finally(() => window.clearTimeout(timeout));
  }
  return preloadPromise;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return undefined;
    const updatePreference = (event) => setReducedMotion(event.matches);
    mediaQuery.addEventListener?.('change', updatePreference);
    return () => mediaQuery.removeEventListener?.('change', updatePreference);
  }, []);

  return reducedMotion;
}

function LogoAssembly({ pieceRefs, baseRef, pulseGlowRef }) {
  return (
    <div
      className="login-loading-logo"
      style={{ aspectRatio: `${LOGO_CANVAS.width} / ${LOGO_CANVAS.height}` }}
      aria-hidden="true"
    >
      <img
        ref={baseRef}
        className="login-loading-full-logo"
        src={FULL_LOGO.src}
        width={FULL_LOGO.width}
        height={FULL_LOGO.height}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      {LOGO_PIECES.map((piece) => (
        <img
          key={piece.id}
          ref={(element) => { pieceRefs.current[piece.id] = element; }}
          className={`login-loading-piece login-loading-piece--${piece.id}`}
          src={piece.src}
          width={piece.width}
          height={piece.height}
          alt=""
          aria-hidden="true"
          draggable="false"
          style={{
            left: `${piece.left}%`,
            top: `${piece.top}%`,
            width: `${piece.widthPercent}%`,
            height: `${piece.heightPercent}%`,
          }}
        />
      ))}
      <span ref={pulseGlowRef} className="login-loading-pulse-glow" />
    </div>
  );
}

export function getOffscreenTransform(element, piece, viewportWidth, viewportHeight) {
  const rect = element.getBoundingClientRect();
  const gap = 2;
  const radians = (Math.abs(piece.rotation) * Math.PI) / 180;
  const scaledWidth = 0.9 * (
    (rect.width * Math.cos(radians)) + (rect.height * Math.sin(radians))
  );
  const scaledHeight = 0.9 * (
    (rect.height * Math.cos(radians)) + (rect.width * Math.sin(radians))
  );
  const rotationOverflowX = Math.max(0, (scaledWidth - rect.width) / 2);
  const rotationOverflowY = Math.max(0, (scaledHeight - rect.height) / 2);
  let x = 0;
  let y = 0;

  if (piece.direction.includes('left')) x = -rect.right - gap - rotationOverflowX;
  if (piece.direction.includes('right')) {
    x = viewportWidth - rect.left + gap + rotationOverflowX;
  }
  if (piece.direction.includes('top')) y = -rect.bottom - gap - rotationOverflowY;
  if (piece.direction.includes('bottom')) {
    y = viewportHeight - rect.top + gap + rotationOverflowY;
  }

  return `translate(${x}px, ${y}px) rotate(${piece.rotation}deg) scale(0.9)`;
}

function LoginLoadingScreen({ ready, error, onError, onExit, onBackToLogin }) {
  const screenRef = useRef(null);
  const pieceRefs = useRef({});
  const baseRef = useRef(null);
  const wordmarkRef = useRef(null);
  const pulseGlowRef = useRef(null);
  const readyRef = useRef(ready);
  const errorRef = useRef(error);
  const exitRef = useRef(onExit);
  const [phase, setPhase] = useState('preloading');
  const prefersReducedMotion = usePrefersReducedMotion();

  readyRef.current = ready;
  errorRef.current = error;
  exitRef.current = onExit;

  const setCompleteLogo = useCallback(() => {
    Object.values(pieceRefs.current).forEach((piece) => {
      if (piece) {
        piece.style.opacity = '1';
        piece.style.transform = 'none';
        piece.style.filter = 'none';
        piece.style.willChange = 'auto';
      }
    });
    if (baseRef.current) baseRef.current.style.opacity = '1';
    if (wordmarkRef.current) {
      wordmarkRef.current.style.opacity = '1';
      wordmarkRef.current.style.transform = 'none';
    }
  }, []);

  const finishCompletionFlash = useCallback((event) => {
    if (
      event.animationName === 'ls-ripple'
      && event.target.classList.contains('login-loading-ripple--complete')
    ) {
      screenRef.current?.removeAttribute('data-complete');
    }
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.getAttribute('content');
    const updateThemeColor = () => {
      if (!themeColor || !screenRef.current) return;
      const baseColor = window.getComputedStyle(root).getPropertyValue('--ls-bg-from').trim();
      if (baseColor) themeColor.setAttribute('content', baseColor);
    };
    const themeObserver = new MutationObserver(updateThemeColor);
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    updateThemeColor();

    return () => {
      themeObserver.disconnect();
      if (!themeColor) return;
      if (previousThemeColor === null) {
        themeColor.removeAttribute('content');
        return;
      }
      const pageColor = window.getComputedStyle(root).getPropertyValue('--page-bg').trim();
      themeColor.setAttribute('content', pageColor || previousThemeColor);
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () => {
      if (!screenRef.current) return;
      if (document.visibilityState === 'hidden') {
        screenRef.current.setAttribute('data-paused', 'true');
      } else {
        screenRef.current.removeAttribute('data-paused');
      }
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => {
      if (!readyRef.current && !errorRef.current) {
        onError('The dashboard is taking longer than expected to load.');
      }
    }, ANIMATION_CONFIG.readyTimeoutMs);
    return () => {
      window.clearTimeout(readyTimer);
    };
  }, [onError]);

  useEffect(() => {
    if (error) setPhase('error');
  }, [error]);

  useEffect(() => {
    let active = true;
    const animations = new Set();
    const timers = new Set();

    const wait = (duration) => new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, duration);
      timers.add(timer);
    });

    const animate = (element, keyframes, options, finalStyles = {}) => {
      if (!element || !active) return Promise.resolve();
      const duration = options.duration + (options.delay || 0);
      if (typeof element.animate !== 'function') {
        return wait(duration).then(() => {
          if (!active) return;
          Object.entries(finalStyles).forEach(([property, value]) => {
            element.style[property] = value;
          });
        });
      }
      element.style.willChange = 'transform, opacity';
      const animation = element.animate(keyframes, {
        duration: options.duration,
        easing: options.easing || ANIMATION_EASING,
        delay: options.delay || 0,
        fill: 'forwards',
      });
      animations.add(animation);
      return animation.finished.catch(() => {}).then(() => {
        animations.delete(animation);
        if (!active) return;
        Object.entries(finalStyles).forEach(([property, value]) => {
          element.style[property] = value;
        });
        element.style.willChange = 'auto';
      });
    };

    const pulseCycle = async (pulseMs, overlapMs) => {
      const cycleDuration = (pulseMs * 2) - overlapMs;
      const pulseAnimations = PULSE_IDS.map((id, index) => {
        const element = pieceRefs.current[id];
        return animate(element, [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.04)', filter: 'brightness(1.25)', offset: 0.5 },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ], {
          duration: pulseMs,
          delay: index === 1 ? pulseMs - overlapMs : 0,
          easing: 'ease-in-out',
        }, { transform: 'scale(1)', filter: 'brightness(1)' });
      });
      pulseAnimations.push(animate(pulseGlowRef.current, [
        { opacity: 0, transform: 'translateX(0)' },
        { opacity: 0.8, offset: 0.5, transform: 'translateX(90%)' },
        { opacity: 0, transform: 'translateX(180%)' },
      ], { duration: cycleDuration, easing: 'ease-in-out' }, { opacity: '0', transform: 'translateX(0)' }));
      await Promise.all(pulseAnimations);
    };

    const run = async () => {
      if (error) {
        setPhase('error');
        return;
      }

      const imagesReady = await preloadLoginImages();
      if (!active) return;

      if (!imagesReady) {
        setPhase('waiting');
        setCompleteLogo();
        if (readyRef.current) {
          exitRef.current?.();
          return;
        }
        while (active && !readyRef.current && !errorRef.current) {
          await wait(ANIMATION_CONFIG.readinessPollMs);
        }
        if (active && readyRef.current && !errorRef.current) {
          setPhase('exiting');
          await animate(screenRef.current, [{ opacity: 1 }, { opacity: 0 }], {
            duration: prefersReducedMotion
              ? ANIMATION_CONFIG.reducedMotion.exitFadeMs
              : ANIMATION_CONFIG.exitFadeMs,
          }, { opacity: '0' });
          if (active) exitRef.current?.();
        }
        return;
      }

      const pieces = Object.fromEntries(LOGO_PIECES.map((piece) => [
        piece.id,
        pieceRefs.current[piece.id],
      ]));
      Object.values(pieces).forEach((piece) => {
        if (piece) {
          piece.style.opacity = '0';
          piece.style.transform = 'none';
          piece.style.filter = 'none';
        }
      });
      if (baseRef.current) baseRef.current.style.opacity = '0';
      if (wordmarkRef.current) {
        wordmarkRef.current.style.opacity = '0';
        wordmarkRef.current.style.transform = 'translateY(8px)';
      }

      if (prefersReducedMotion) {
        setPhase('assembling');
        Object.values(pieces).forEach((piece) => {
          if (piece) piece.style.opacity = '0';
        });
        await animate(baseRef.current, [{ opacity: 0 }, { opacity: 1 }], {
          duration: ANIMATION_CONFIG.reducedMotion.logoFadeMs,
        }, { opacity: '1' });
        if (!active) return;
        setPhase('wordmark');
        await animate(wordmarkRef.current, [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: ANIMATION_CONFIG.reducedMotion.wordmarkFadeMs }, {
          opacity: '1',
          transform: 'translateY(0)',
        });
        if (!active) return;
        setPhase('waiting');
        while (active && !readyRef.current && !errorRef.current) {
          await wait(ANIMATION_CONFIG.readinessPollMs);
        }
        if (!active || errorRef.current) return;
        await wait(ANIMATION_CONFIG.reducedMotion.holdMs);
      } else {
        const startedAt = performance.now();
        setPhase('assembling');
        const flights = LOGO_PIECES.map(async (piece, index) => {
          const delay = (startedAt + (index * ANIMATION_CONFIG.pieceStaggerMs)) - performance.now();
          if (delay > 0) await wait(delay);
          if (!active) return;
          const element = pieces[piece.id];
          const fromTransform = getOffscreenTransform(
            element,
            piece,
            window.innerWidth,
            window.innerHeight
          );
          await animate(element, [
            { opacity: 0, transform: fromTransform, offset: 0 },
            { opacity: 1, transform: fromTransform, offset: 0.25 },
            { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)', offset: 1 },
          ], { duration: ANIMATION_CONFIG.pieceFlightMs }, {
            opacity: '1',
            transform: 'translate(0, 0) rotate(0deg) scale(1)',
          });
        });
        await Promise.all(flights);
        if (!active) return;
        setPhase('complete');
        screenRef.current?.setAttribute('data-complete', 'true');
        const settleAndFade = Promise.all([
          wait(ANIMATION_CONFIG.settleMs),
          animate(baseRef.current, [{ opacity: 0 }, { opacity: 1 }], {
            duration: ANIMATION_CONFIG.baseFadeMs,
          }, { opacity: '1' }),
        ]);
        await settleAndFade;
        if (!active) return;
        setPhase('pulsing');
        await pulseCycle(ANIMATION_CONFIG.pulseMs, ANIMATION_CONFIG.pulseOverlapMs);
        if (!active) return;
        setPhase('wordmark');
        await animate(wordmarkRef.current, [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: ANIMATION_CONFIG.wordmarkFadeMs }, {
          opacity: '1',
          transform: 'translateY(0)',
        });
        if (!active) return;
        setPhase('waiting');
        while (active && !readyRef.current && !errorRef.current) {
          await pulseCycle(ANIMATION_CONFIG.pulseMs, ANIMATION_CONFIG.pulseOverlapMs);
        }
        if (!active || errorRef.current) return;
        await wait(ANIMATION_CONFIG.holdMs);
      }

      if (!active || errorRef.current) return;
      setPhase('exiting');
      await animate(screenRef.current, [{ opacity: 1 }, { opacity: 0 }], {
        duration: prefersReducedMotion
          ? ANIMATION_CONFIG.reducedMotion.exitFadeMs
          : ANIMATION_CONFIG.exitFadeMs,
      }, { opacity: '0' });
      if (active) exitRef.current?.();
    };

    run();
    return () => {
      active = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      animations.forEach((animation) => animation.cancel());
    };
  }, [error, prefersReducedMotion, setCompleteLogo]);

  if (error) {
    return createPortal(
      <div
        ref={screenRef}
        className={`login-loading-screen login-loading-screen--error${prefersReducedMotion ? ' is-reduced-motion' : ''}`}
        data-phase="error"
      >
        <LoadingBackground onAnimationEnd={finishCompletionFlash} />
        <p className="login-loading-live-region" role="status" aria-live="polite">{error}</p>
        <div className="login-loading-error-card" role="alert">
          <strong>We couldn&apos;t finish loading your dashboard.</strong>
          <p>{error}</p>
          <button type="button" onClick={onBackToLogin}>Back to login</button>
        </div>
      </div>,
      document.body
    );
  }

  const statusMessage = phase === 'error'
    ? 'The dashboard is taking longer than expected to load.'
    : phase === 'exiting'
      ? 'Welcome'
      : 'Signing you in...';

  return createPortal(
    <div
      ref={screenRef}
      className={`login-loading-screen${prefersReducedMotion ? ' is-reduced-motion' : ''}`}
      data-animation-profile={INTRO_PROFILE}
      data-total-duration={getAnimationTotalMs(ANIMATION_CONFIG)}
      data-phase={phase}
      style={{
        '--ls-pulse-cycle': `${(ANIMATION_CONFIG.pulseMs * 2) - ANIMATION_CONFIG.pulseOverlapMs}ms`,
      }}
      aria-label="HealthSync signing in"
    >
      <LoadingBackground onAnimationEnd={finishCompletionFlash} />
      <p className="login-loading-live-region" role="status" aria-live="polite">{statusMessage}</p>
      <div className="login-loading-group" aria-hidden="true">
        <LogoAssembly
          pieceRefs={pieceRefs}
          baseRef={baseRef}
          pulseGlowRef={pulseGlowRef}
        />
        <div className="login-loading-wordmark-wrap">
          <img
            ref={wordmarkRef}
            className="login-loading-wordmark"
            src={WORDMARK.src}
            width={WORDMARK.width}
            height={WORDMARK.height}
            alt=""
            aria-hidden="true"
            draggable="false"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default LoginLoadingScreen;
