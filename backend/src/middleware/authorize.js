const normalizeRoleAccess = (role) => {
  const value = String(role || '').trim().toLowerCase().replace(/[-_\s]+/g, '_');
  if (value === 'barangay_official' || value === 'official') return 'official';
  return value;
};

const authorizeRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (!Array.isArray(allowedRoles)) allowedRoles = [allowedRoles];
    const normalizedAllowed = allowedRoles.map((role) => normalizeRoleAccess(role));
    const userRole = normalizeRoleAccess(req.user.role);
    if (normalizedAllowed.length === 0) return next();
    if (normalizedAllowed.includes(userRole)) return next();
    return res.status(403).json({ success: false, message: 'Forbidden: insufficient role access' });
  };
};

module.exports = authorizeRole;
