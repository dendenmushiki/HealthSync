const locations = require('../data/philippineLocations.json');

const [REGIONS, PROVINCES, CITIES, BARANGAYS] = [
  locations.regions,
  locations.provinces,
  locations.cities,
  locations.barangays
];
const byCode = (items, code) => items.find((item) => item[0] === code);
const validCode = (code) => /^(?:\d{9,10}|I\d{9})$/.test(String(code || ''));

async function resolveResidentLocation(codes) {
  const { region_code: regionCode, province_code: provinceCode, city_municipality_code: cityCode, barangay_code: barangayCode } = codes;
  if (![regionCode, provinceCode, cityCode, barangayCode].every(validCode)) {
    throw new Error('Select a region, province, city or municipality, and barangay.');
  }

  const region = byCode(REGIONS, regionCode);
  if (!region) throw new Error('Select a valid region.');

  const province = byCode(PROVINCES, provinceCode);
  if (!province || province[2] !== regionCode) {
    throw new Error('Select a province within the selected region.');
  }

  const city = byCode(CITIES, cityCode);
  if (!city || city[2] !== provinceCode || city[3] !== regionCode) {
    throw new Error('Select a city or municipality within the selected province.');
  }

  const barangay = byCode(BARANGAYS, barangayCode);
  if (!barangay || barangay[2] !== cityCode) {
    throw new Error('Select a barangay within the selected city or municipality.');
  }

  return {
    region_code: region[0],
    province_code: province[0],
    city_municipality_code: city[0],
    barangay_code: barangay[0],
    address: [barangay[1], city[1], province[1], region[1]].filter(Boolean).join(', ')
  };
}

module.exports = { resolveResidentLocation };
