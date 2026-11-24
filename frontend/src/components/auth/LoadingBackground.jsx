import React from 'react';
import './LoadingBackground.css';

const PARTICLES = [
  { x: 4, y: 8, size: 4, duration: 22, delay: -8, opacity: 0.25, sway: '3vmax' },
  { x: 10, y: 28, size: 6, duration: 18, delay: -15, opacity: 0.38, sway: '-2vmax' },
  { x: 16, y: 72, size: 3, duration: 25, delay: -5, opacity: 0.2, sway: '2vmax', cross: true },
  { x: 23, y: 48, size: 5, duration: 16, delay: -11, opacity: 0.32, sway: '-3vmax' },
  { x: 29, y: 15, size: 4, duration: 27, delay: -19, opacity: 0.18, sway: '2vmax' },
  { x: 35, y: 82, size: 7, duration: 20, delay: -3, opacity: 0.4, sway: '-2vmax' },
  { x: 41, y: 35, size: 3, duration: 24, delay: -14, opacity: 0.24, sway: '3vmax', cross: true },
  { x: 47, y: 65, size: 5, duration: 17, delay: -7, opacity: 0.3, sway: '-2vmax' },
  { x: 53, y: 10, size: 4, duration: 26, delay: -21, opacity: 0.2, sway: '2vmax' },
  { x: 59, y: 87, size: 6, duration: 19, delay: -9, opacity: 0.36, sway: '-3vmax' },
  { x: 65, y: 42, size: 3, duration: 23, delay: -17, opacity: 0.22, sway: '2vmax', cross: true },
  { x: 71, y: 20, size: 5, duration: 15, delay: -4, opacity: 0.34, sway: '-2vmax' },
  { x: 77, y: 74, size: 4, duration: 28, delay: -12, opacity: 0.2, sway: '3vmax' },
  { x: 83, y: 50, size: 7, duration: 21, delay: -18, opacity: 0.42, sway: '-3vmax' },
  { x: 89, y: 12, size: 3, duration: 16, delay: -6, opacity: 0.26, sway: '2vmax', cross: true },
  { x: 96, y: 62, size: 5, duration: 24, delay: -13, opacity: 0.3, sway: '-2vmax' },
];

function getParticleCount() {
  const lowEndDevice = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const compactViewport = window.innerWidth < 640;
  if (lowEndDevice) return compactViewport ? 6 : 8;
  return compactViewport ? 10 : PARTICLES.length;
}

function particleStyle(particle) {
  return {
    left: `${particle.x}%`,
    bottom: `${particle.y}%`,
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    '--ls-float-duration': `${particle.duration}s`,
    '--ls-float-delay': `${particle.delay}s`,
    '--ls-float-opacity': particle.opacity,
    '--ls-float-sway': particle.sway,
  };
}

export default function LoadingBackground({ onAnimationEnd }) {
  const particleCount = getParticleCount();

  return (
    <div
      className="login-loading-background"
      aria-hidden="true"
      onAnimationEnd={onAnimationEnd}
    >
      <div className="login-loading-glow login-loading-glow--teal" />
      <div className="login-loading-glow login-loading-glow--sky" />
      <div className="login-loading-glow login-loading-glow--center" />
      <div className="login-loading-grid" />
      <svg className="login-loading-ecg" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <path
          className="login-loading-ecg-line"
          d="M0 50H440L470 50L485 43L500 15L515 80L530 50H560L575 45L590 50H1000"
        />
        <path
          className="login-loading-ecg-scanner"
          d="M0 50H440L470 50L485 43L500 15L515 80L530 50H560L575 45L590 50H1000"
        />
      </svg>
      <div className="login-loading-particles">
        {PARTICLES.slice(0, particleCount).map((particle, index) => (
          <span
            key={index}
            className={`login-loading-particle${particle.cross ? ' is-cross' : ''}`}
            style={particleStyle(particle)}
          />
        ))}
      </div>
      <div className="login-loading-halo" />
      <div className="login-loading-ripple login-loading-ripple--complete" />
      <div className="login-loading-ripple login-loading-ripple--pulse login-loading-ripple--first" />
      <div className="login-loading-ripple login-loading-ripple--pulse login-loading-ripple--second" />
      <div className="login-loading-vignette" />
    </div>
  );
}
