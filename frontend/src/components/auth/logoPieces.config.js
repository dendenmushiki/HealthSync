export const LOGO_CANVAS = {
  width: 792,
  height: 635,
};

export const LOGO_PIECES = [
  {
    id: 'upperleft',
    src: '/images/upperleftlogopiece.svg',
    width: 327,
    height: 289,
    left: 6.692,
    top: 0,
    widthPercent: 41.288,
    heightPercent: 45.512,
    direction: 'top-left',
    rotation: -24,
  },
  {
    id: 'upperright',
    src: '/images/upperrightlogopiece.svg',
    width: 417,
    height: 289,
    left: 40.404,
    top: 0,
    widthPercent: 52.652,
    heightPercent: 45.512,
    direction: 'top-right',
    rotation: 21,
  },
  {
    id: 'lowerright',
    src: '/images/lowerrightlogopiece.svg',
    width: 369,
    height: 278,
    left: 38.763,
    top: 56.220,
    widthPercent: 46.591,
    heightPercent: 43.780,
    direction: 'bottom-right',
    rotation: 23,
  },
  {
    id: 'lowerleft',
    src: '/images/lowerleftlogopiece.svg',
    width: 228,
    height: 208,
    left: 14.899,
    top: 56.220,
    widthPercent: 28.788,
    heightPercent: 32.756,
    direction: 'bottom-left',
    rotation: -18,
  },
  {
    id: 'centerleft',
    src: '/images/centerleftlogopiece.svg',
    width: 441,
    height: 266,
    left: 0,
    top: 30.709,
    widthPercent: 55.682,
    heightPercent: 41.890,
    direction: 'left',
    rotation: -13,
  },
  {
    id: 'centerright',
    src: '/images/centerrightlogopiece.svg',
    width: 383,
    height: 210,
    left: 51.641,
    top: 20.630,
    widthPercent: 48.359,
    heightPercent: 33.071,
    direction: 'right',
    rotation: 14,
  },
];

export const FULL_LOGO = {
  src: '/images/fulllogopiece.svg',
  width: LOGO_CANVAS.width,
  height: LOGO_CANVAS.height,
};

export const WORDMARK = {
  src: '/images/healthsynctext.png',
  width: 1134,
  height: 248,
};

export const LOGIN_LOADING_IMAGES = [
  ...LOGO_PIECES.map(({ src }) => src),
  FULL_LOGO.src,
  WORDMARK.src,
];
