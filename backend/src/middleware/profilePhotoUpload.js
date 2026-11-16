const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDirectory = path.resolve(__dirname, '../../uploads/profiles');
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const getProfilePhotoFilePath = (photoPath) => {
  const match = /^\/uploads\/profiles\/([a-f0-9-]+\.(?:jpg|png|webp))$/i.exec(String(photoPath || ''));
  return match ? path.join(uploadDirectory, match[1]) : null;
};
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    fs.mkdir(uploadDirectory, { recursive: true }, (error) => callback(error, uploadDirectory));
  },
  filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${extensions[file.mimetype] || '.img'}`)
});
const parser = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!extensions[file.mimetype]) return callback(new Error('Choose a JPEG, PNG, or WebP image.'));
    return callback(null, true);
  }
}).single('photo');

const matchesImageSignature = (mimeType, bytes) => {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
};

const uploadProfilePhoto = (req, res, next) => {
  parser(req, res, async (error) => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: status === 413 ? 'Image must be 5 MB or smaller.' : error.message });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image to upload.' });

    try {
      const handle = await fs.promises.open(req.file.path, 'r');
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      await handle.close();
      if (!matchesImageSignature(req.file.mimetype, header.subarray(0, bytesRead))) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ success: false, message: 'The selected file is not a valid image.' });
      }
      req.profilePhotoPath = `/uploads/profiles/${req.file.filename}`;
      return next();
    } catch (validationError) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return next(validationError);
    }
  });
};

const removeProfilePhotoFile = async (photoPath) => {
  const filePath = getProfilePhotoFilePath(photoPath);
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => {});
};

const isStoredProfilePhoto = async (photoPath) => {
  const filePath = getProfilePhotoFilePath(photoPath);
  if (!filePath) return false;
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

module.exports = { uploadProfilePhoto, removeProfilePhotoFile, isStoredProfilePhoto };