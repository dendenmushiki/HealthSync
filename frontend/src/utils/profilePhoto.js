export function getProfilePhotoUrl(photoPath) {
  if (!photoPath) return '';
  try {
    const imagePath = String(photoPath).replace(/^\/uploads(?=\/)/, '/api/uploads');
    return new URL(imagePath, process.env.REACT_APP_API_URL || 'http://localhost:5000/api').toString();
  } catch (error) {
    return photoPath;
  }
}

export function validateProfilePhoto(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) return 'Choose a JPEG, PNG, or WebP image.';
  if (file.size > 5 * 1024 * 1024) return 'Image must be 5 MB or smaller.';
  return '';
}