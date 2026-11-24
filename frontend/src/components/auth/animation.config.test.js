import { ANIMATION_PROFILES, getAnimationTotalMs } from './animation.config';

test.each([
  ['recommended', 4950],
  ['long', 6100],
  ['quick', 3230],
])('computes the %s profile duration', (profileName, expectedDuration) => {
  expect(getAnimationTotalMs(ANIMATION_PROFILES[profileName])).toBe(expectedDuration);
});
