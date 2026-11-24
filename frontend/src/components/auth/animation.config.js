export const INTRO_PROFILE = 'recommended';

const reducedMotion = {
  logoFadeMs: 200,
  wordmarkFadeMs: 200,
  holdMs: 600,
  exitFadeMs: 250,
};

export const ANIMATION_PROFILES = {
  recommended: {
    pieceFlightMs: 800,
    pieceStaggerMs: 350,
    settleMs: 150,
    baseFadeMs: 200,
    pulseMs: 600,
    pulseOverlapMs: 150,
    wordmarkFadeMs: 500,
    holdMs: 300,
    exitFadeMs: 350,
    skipRevealMs: 1000,
    assetTimeoutMs: 3000,
    readyTimeoutMs: 15000,
    readinessPollMs: 100,
    reducedMotion,
  },
  long: {
    pieceFlightMs: 1000,
    pieceStaggerMs: 500,
    settleMs: 200,
    baseFadeMs: 200,
    pulseMs: 800,
    pulseOverlapMs: 200,
    wordmarkFadeMs: 600,
    holdMs: 200,
    exitFadeMs: 200,
    skipRevealMs: 1000,
    assetTimeoutMs: 3000,
    readyTimeoutMs: 15000,
    readinessPollMs: 100,
    reducedMotion,
  },
  quick: {
    pieceFlightMs: 550,
    pieceStaggerMs: 220,
    settleMs: 100,
    baseFadeMs: 150,
    pulseMs: 400,
    pulseOverlapMs: 120,
    wordmarkFadeMs: 350,
    holdMs: 150,
    exitFadeMs: 250,
    skipRevealMs: 1000,
    assetTimeoutMs: 3000,
    readyTimeoutMs: 15000,
    readinessPollMs: 100,
    reducedMotion,
  },
};

export const ANIMATION_CONFIG = ANIMATION_PROFILES[INTRO_PROFILE];
export const ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function getAnimationTotalMs(profile, pieceCount = 6) {
  const pieceAssemblyMs = profile.pieceFlightMs + (profile.pieceStaggerMs * (pieceCount - 1));
  const completionFadeMs = Math.max(profile.settleMs, profile.baseFadeMs);
  const pulseSequenceMs = (profile.pulseMs * 2) - profile.pulseOverlapMs;

  return pieceAssemblyMs
    + completionFadeMs
    + pulseSequenceMs
    + profile.wordmarkFadeMs
    + profile.holdMs
    + profile.exitFadeMs;
}
