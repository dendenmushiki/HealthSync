import React from 'react';
import { render, waitFor } from '@testing-library/react';
import LoginLoadingScreen from './LoginLoadingScreen';

describe('LoginLoadingScreen theme integration', () => {
  const originalImage = window.Image;
  const originalTheme = document.documentElement.dataset.theme;
  const originalThemeColor = document.documentElement.style.getPropertyValue('--ls-bg-from');
  const originalPageColor = document.documentElement.style.getPropertyValue('--page-bg');
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  let themeColor;
  let mockImages;

  beforeEach(() => {
    mockImages = [];
    window.Image = class {
      decode() {
        return new Promise((resolve) => {
          this.resolveDecode = () => {
            this.complete = true;
            this.naturalWidth = 1;
            resolve();
          };
          mockImages.push(this);
        });
      }
    };
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.setProperty('--ls-bg-from', 'Canvas');
    document.documentElement.style.setProperty('--page-bg', 'Canvas');
    themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = 'CanvasText';
    document.head.appendChild(themeColor);
  });

  afterEach(() => {
    window.Image = originalImage;
    if (originalTheme) document.documentElement.dataset.theme = originalTheme;
    else delete document.documentElement.dataset.theme;
    if (originalThemeColor) {
      document.documentElement.style.setProperty('--ls-bg-from', originalThemeColor);
    } else {
      document.documentElement.style.removeProperty('--ls-bg-from');
    }
    if (originalPageColor) {
      document.documentElement.style.setProperty('--page-bg', originalPageColor);
    } else {
      document.documentElement.style.removeProperty('--page-bg');
    }
    if (originalVisibility) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    } else {
      delete document.visibilityState;
    }
    themeColor.remove();
    mockImages.forEach((image) => image.resolveDecode?.());
  });

  it('portals the opaque background and tracks live theme changes in theme-color', async () => {
    const { unmount } = render(
      <LoginLoadingScreen
        ready={false}
        error={null}
        onError={() => {}}
        onExit={() => {}}
        onBackToLogin={() => {}}
      />
    );
    const overlay = document.querySelector('body > .login-loading-screen');

    expect(overlay).toHaveAttribute('data-phase', 'preloading');
    expect(overlay.querySelector('.login-loading-background')).toHaveAttribute('aria-hidden', 'true');
    expect(themeColor).toHaveAttribute('content', 'Canvas');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(overlay).toHaveAttribute('data-paused', 'true');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(overlay).not.toHaveAttribute('data-paused');

    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.setProperty('--ls-bg-from', 'ButtonFace');
    document.documentElement.style.setProperty('--page-bg', 'ButtonText');
    await waitFor(() => expect(themeColor).toHaveAttribute('content', 'ButtonFace'));

    unmount();
    expect(themeColor).toHaveAttribute('content', 'ButtonText');
  });
});
