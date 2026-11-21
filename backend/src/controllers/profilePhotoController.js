const pool = require('../config/database');
const logger = require('../services/logger');
const { writeAudit } = require('../services/auditService');
const { ensureUserPhotoColumn } = require('./adminSettingsController');
const { removeProfilePhotoFile } = require('../middleware/profilePhotoUpload');

const ensureResidentPhotoColumn = async () => {
  const [columns] = await pool.query("SHOW COLUMNS FROM residents LIKE 'profile_photo'");
  if (!columns.length) await pool.query('ALTER TABLE residents ADD COLUMN profile_photo VARCHAR(500) NULL');
};

const uploadResidentPhoto = async (req, res) => {
  try {
    await ensureResidentPhotoColumn();
    const [rows] = await pool.query('SELECT resident_id, profile_photo FROM residents WHERE resident_id = ?', [req.params.id]);
    if (!rows.length) {
      await removeProfilePhotoFile(req.profilePhotoPath);
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }
    await pool.query('UPDATE residents SET profile_photo = ? WHERE resident_id = ?', [req.profilePhotoPath, req.params.id]);
    await removeProfilePhotoFile(rows[0].profile_photo);
    await writeAudit({ user_id: req.user.user_id, action: 'UPDATE', module: 'residents', table_name: 'residents', record_id: req.params.id, old_data: { profile_photo: rows[0].profile_photo }, new_data: { profile_photo: req.profilePhotoPath } });
    return res.json({ success: true, data: { profile_photo: req.profilePhotoPath } });
  } catch (error) {
    await removeProfilePhotoFile(req.profilePhotoPath).catch(() => {});
    logger.error('uploadResidentPhoto error', error);
    return res.status(500).json({ success: false, message: 'Unable to save resident photo' });
  }
};

const deleteResidentPhoto = async (req, res) => {
  try {
    await ensureResidentPhotoColumn();
    const [rows] = await pool.query('SELECT resident_id, profile_photo FROM residents WHERE resident_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Resident not found' });
    await pool.query('UPDATE residents SET profile_photo = NULL WHERE resident_id = ?', [req.params.id]);
    await removeProfilePhotoFile(rows[0].profile_photo);
    await writeAudit({ user_id: req.user.user_id, action: 'UPDATE', module: 'residents', table_name: 'residents', record_id: req.params.id, old_data: { profile_photo: rows[0].profile_photo }, new_data: { profile_photo: null } });
    return res.json({ success: true, data: { profile_photo: null } });
  } catch (error) {
    logger.error('deleteResidentPhoto error', error);
    return res.status(500).json({ success: false, message: 'Unable to remove resident photo' });
  }
};

const uploadUserPhoto = async (req, res) => {
  try {
    await ensureUserPhotoColumn();
    const [rows] = await pool.query('SELECT user_id, full_name, username, contact_number, email, role, profile_photo FROM users WHERE user_id = ?', [req.user.user_id]);
    if (!rows.length) {
      await removeProfilePhotoFile(req.profilePhotoPath);
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    await pool.query('UPDATE users SET profile_photo = ? WHERE user_id = ?', [req.profilePhotoPath, req.user.user_id]);
    await removeProfilePhotoFile(rows[0].profile_photo);
    await writeAudit({ user_id: req.user.user_id, action: 'ACCOUNT_PHOTO_UPDATED', module: 'account-settings', table_name: 'users', record_id: req.user.user_id, old_data: { profile_photo: rows[0].profile_photo }, new_data: { profile_photo: req.profilePhotoPath } });
    return res.json({ success: true, data: { ...rows[0], profile_photo: req.profilePhotoPath } });
  } catch (error) {
    await removeProfilePhotoFile(req.profilePhotoPath).catch(() => {});
    logger.error('uploadUserPhoto error', error);
    return res.status(500).json({ success: false, message: 'Unable to save profile photo' });
  }
};

const deleteUserPhoto = async (req, res) => {
  try {
    await ensureUserPhotoColumn();
    const [rows] = await pool.query('SELECT user_id, full_name, username, contact_number, email, role, profile_photo FROM users WHERE user_id = ?', [req.user.user_id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found' });
    await pool.query('UPDATE users SET profile_photo = NULL WHERE user_id = ?', [req.user.user_id]);
    await removeProfilePhotoFile(rows[0].profile_photo);
    await writeAudit({ user_id: req.user.user_id, action: 'ACCOUNT_PHOTO_REMOVED', module: 'account-settings', table_name: 'users', record_id: req.user.user_id, old_data: { profile_photo: rows[0].profile_photo }, new_data: { profile_photo: null } });
    return res.json({ success: true, data: { ...rows[0], profile_photo: null } });
  } catch (error) {
    logger.error('deleteUserPhoto error', error);
    return res.status(500).json({ success: false, message: 'Unable to remove profile photo' });
  }
};

module.exports = { uploadResidentPhoto, deleteResidentPhoto, uploadUserPhoto, deleteUserPhoto };