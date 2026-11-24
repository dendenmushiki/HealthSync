export const getRoleLabel = (role) => {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'admin' || normalized === 'administrator') return 'Administrator';
  if (normalized === 'bhw') return 'BHW';
  if (normalized === 'official' || normalized === 'barangay_official') return 'Official';
  return role ? String(role) : 'System';
};
