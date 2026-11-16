const test = require('node:test');
const assert = require('node:assert/strict');
const psgcService = require('../src/services/psgcService');
const locations = require('../src/data/philippineLocations.json');

test('local PSGC data contains all Philippine location levels', () => {
  assert.equal(locations.regions.length, 17);
  assert.ok(locations.provinces.length >= 80);
  assert.ok(locations.cities.length >= 1600);
  assert.ok(locations.barangays.length >= 42000);
  const provinceCodes = new Set(locations.provinces.map(([code]) => code));
  const cityCodes = new Set(locations.cities.map(([code]) => code));
  assert.ok(locations.cities.every(([, , provinceCode]) => provinceCodes.has(provinceCode)));
  assert.ok(locations.barangays.every(([, , cityCode]) => cityCodes.has(cityCode)));
});

test('resident address location codes resolve only within their selected hierarchy', async () => {
  const region = locations.regions.find(([, name]) => name === 'Ilocos Region');
  const province = locations.provinces.find(([, , regionCode]) => regionCode === region[0]);
  const city = locations.cities.find(([, , provinceCode]) => provinceCode === province[0]);
  const barangay = locations.barangays.find(([, , cityCode]) => cityCode === city[0]);
  const location = await psgcService.resolveResidentLocation({
    region_code: region[0],
    province_code: province[0],
    city_municipality_code: city[0],
    barangay_code: barangay[0]
  });
  assert.equal(location.address, `${barangay[1]}, ${city[1]}, ${province[1]}, ${region[1]}`);

  await assert.rejects(
    psgcService.resolveResidentLocation({
      region_code: region[0],
      province_code: '020000000',
      city_municipality_code: city[0],
      barangay_code: barangay[0]
    }),
    /Select a province within the selected region/
  );
});

test('independent cities have a selectable region branch', async () => {
  const city = locations.cities.find(([, name]) => name === 'City of Isabela');
  assert.match(city[2], /^I\d{9}$/);
  const province = locations.provinces.find(([code]) => code === city[2]);
  const region = locations.regions.find(([code]) => code === city[3]);
  const barangay = locations.barangays.find(([, , cityCode]) => cityCode === city[0]);
  const location = await psgcService.resolveResidentLocation({
    region_code: region[0],
    province_code: province[0],
    city_municipality_code: city[0],
    barangay_code: barangay[0]
  });
  assert.equal(location.address, `${barangay[1]}, ${city[1]}, ${province[1]}, ${region[1]}`);
});
