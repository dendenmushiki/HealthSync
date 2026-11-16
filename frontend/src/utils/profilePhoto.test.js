import { getProfilePhotoUrl, validateProfilePhoto } from './profilePhoto';

describe('getProfilePhotoUrl', () => {
  it('uses the API-prefixed upload route for saved profile photo paths', () => {
    expect(getProfilePhotoUrl('/uploads/profiles/photo.jpg')).toBe(
      'http://localhost:5000/api/uploads/profiles/photo.jpg'
    );
  });

  it('leaves empty photo paths empty', () => {
    expect(getProfilePhotoUrl('')).toBe('');
  });
});

describe('validateProfilePhoto', () => {
  it('accepts JPEG, PNG, and WebP files up to 5 MB', () => {
    expect(validateProfilePhoto({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBe('');
    expect(validateProfilePhoto({ type: 'image/png', size: 1024 })).toBe('');
    expect(validateProfilePhoto({ type: 'image/webp', size: 1024 })).toBe('');
  });

  it('rejects unsupported types and files over 5 MB', () => {
    expect(validateProfilePhoto({ type: 'image/gif', size: 1024 })).toBe('Choose a JPEG, PNG, or WebP image.');
    expect(validateProfilePhoto({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe('Image must be 5 MB or smaller.');
  });
});
