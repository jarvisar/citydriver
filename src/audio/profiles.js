// Sound character is independent of the handling model. The default car takes
// its voice from the journey; garage cars keep their voice wherever they go.
const tourer = { idle: 820, redline: 4200, cylinders: 4, gearing: 1, body: 1, rasp: .65, intake: .6, harmonics: [1, .52, .28, .16, .09, .055, .025] };
const voice = changes => ({ ...tourer, ...changes });
export const ENGINES = {
  coast: voice({}),
  desert: voice({ idle: 730, cylinders: 6, gearing: .88, body: 1.35, rasp: .8 }),
  snow: voice({ idle: 780, gearing: .95, rasp: .4, intake: .4 }),
  jungle: voice({ idle: 710, redline: 3700, gearing: .83, body: 1.5, rasp: .9 }),
  plains: voice({ idle: 740, cylinders: 6, gearing: .9, body: 1.2, rasp: .5 }),
  city: voice({ idle: 850, body: .8, rasp: .35, intake: .4 }),
  hatchback: voice({ idle: 920, gearing: 1.2, body: .6, rasp: .85, intake: .9, harmonics: [1, .35, .42, .15, .13, .06] }),
  sedan: voice({ idle: 720, cylinders: 6, gearing: .95, rasp: .35, harmonics: [1, .25, .15, .08, .04] }),
  wagon: voice({ idle: 780, body: 1.2, rasp: .55 }),
  pickup: voice({ idle: 640, cylinders: 8, gearing: .78, body: 1.8, rasp: 1.1, harmonics: [1, .7, .22, .3, .12, .1, .05] }),
  van: voice({ idle: 680, redline: 3500, gearing: .8, body: 1.5, rasp: 1.2, intake: .3 }),
  sports: voice({ idle: 980, redline: 6500, cylinders: 6, gearing: 1.55, body: .85, rasp: 1, intake: 1.4, harmonics: [1, .6, .38, .26, .18, .12, .075, .04] }),
  formula: voice({ idle: 1800, redline: 12500, cylinders: 8, gearing: 3.1, body: .5, rasp: .9, intake: 1.8, harmonics: [1, .48, .24, .13, .06, .03] }),
};
export const engineFor = (car, journey = 'coast') => ENGINES[car === 'auto' ? journey : car] ?? ENGINES.coast;

export const AMBIENCE = {
  coast: { low: 430, high: 2700, bed: .16, swell: .2, air: .025, wash: .14, rough: 1100, wildlife: 'gull', interval: [8, 18], root: 57 },
  desert: { low: 580, high: 1500, bed: .065, swell: .1, air: .012, wash: .04, rough: 1700, wildlife: 'wind', interval: [12, 24], root: 50 },
  snow: { low: 320, high: 1800, bed: .045, swell: .055, air: .016, wash: .055, rough: 620, wildlife: 'owl', interval: [15, 28], root: 54 },
  jungle: { low: 370, high: 3300, bed: .085, swell: .06, air: .035, wash: .065, rough: 870, wildlife: 'bird', interval: [3, 7], root: 55 },
  plains: { low: 410, high: 2400, bed: .065, swell: .08, air: .022, wash: .065, rough: 1200, wildlife: 'lark', interval: [7, 15], root: 60 },
  city: { low: 300, high: 4600, bed: .085, swell: .04, air: .14, wash: .1, rough: 1000, wildlife: 'drip', interval: [2, 5], root: 53 },
};

export const MIX_PRESETS = {
  balanced: { master: .72, engine: .8, road: .7, ambience: .85, traffic: .65, music: 0, night: false },
  scenic: { master: .72, engine: .42, road: .5, ambience: 1, traffic: .45, music: .32, night: false },
  night: { master: .55, engine: .6, road: .45, ambience: .65, traffic: .4, music: .22, night: true },
};
export const MIX_CHANNELS = ['master', 'engine', 'road', 'ambience', 'traffic', 'music'];
export function sanitizeMix(value) {
  const mix = { ...MIX_PRESETS.balanced };
  if (!value || typeof value !== 'object') return mix;
  for (const channel of MIX_CHANNELS) if (typeof value[channel] === 'number' && Number.isFinite(value[channel])) mix[channel] = Math.max(0, Math.min(1, value[channel]));
  if (typeof value.night === 'boolean') mix.night = value.night;
  return mix;
}
