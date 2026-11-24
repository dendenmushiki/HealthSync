import { LOGO_PIECES } from './logoPieces.config';
import { getOffscreenTransform } from './LoginLoadingScreen';

test.each([
  [320, 640],
  [667, 375],
  [1366, 640],
])('starts every rotated logo piece fully outside a %sx%s viewport', (viewportWidth, viewportHeight) => {
  const rect = {
    left: 180,
    top: 140,
    width: 90,
    height: 70,
    right: 270,
    bottom: 210,
  };

  LOGO_PIECES.forEach((piece) => {
    const transform = getOffscreenTransform(
      { getBoundingClientRect: () => rect },
      piece,
      viewportWidth,
      viewportHeight
    );
    const [, x, y] = transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
    const radians = (Math.abs(piece.rotation) * Math.PI) / 180;
    const boundsWidth = 0.9 * (
      (rect.width * Math.cos(radians)) + (rect.height * Math.sin(radians))
    );
    const boundsHeight = 0.9 * (
      (rect.height * Math.cos(radians)) + (rect.width * Math.sin(radians))
    );
    const centerX = rect.left + (rect.width / 2) + Number(x);
    const centerY = rect.top + (rect.height / 2) + Number(y);

    if (piece.direction.includes('left')) {
      expect(centerX + (boundsWidth / 2)).toBeLessThan(0);
    }
    if (piece.direction.includes('right')) {
      expect(centerX - (boundsWidth / 2)).toBeGreaterThan(viewportWidth);
    }
    if (piece.direction.includes('top')) {
      expect(centerY + (boundsHeight / 2)).toBeLessThan(0);
    }
    if (piece.direction.includes('bottom')) {
      expect(centerY - (boundsHeight / 2)).toBeGreaterThan(viewportHeight);
    }
  });
});
