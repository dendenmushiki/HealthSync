import {
  getResidentBarangays,
  getResidentCitiesMunicipalities,
  getResidentProvinces,
  getResidentRegions
} from './residentService';
import api from './apiClient';

jest.mock('./apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() }
}));

jest.mock('../offline/indexedDbService', () => ({
  __esModule: true,
  default: {}
}));

test('resident address options are loaded from local data without API requests', async () => {
  const regions = await getResidentRegions();
  expect(regions.data).toContainEqual(expect.objectContaining({ name: 'Ilocos Region' }));

  const provinces = await getResidentProvinces('010000000');
  expect(provinces.data).toContainEqual(expect.objectContaining({ name: 'Ilocos Norte' }));

  const cities = await getResidentCitiesMunicipalities('012800000');
  expect(cities.data).toContainEqual(expect.objectContaining({ name: 'Adams' }));

  const barangays = await getResidentBarangays('012801000');
  expect(barangays.data).toContainEqual(expect.objectContaining({ name: 'Adams (Pob.)' }));
  expect(api.get).not.toHaveBeenCalled();
});
