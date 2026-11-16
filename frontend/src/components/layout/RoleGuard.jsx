import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';

const normalizeRoleValue = (role) => {
  const value = String(role || '').trim().toLowerCase().replace(/[-_\s]+/g, '_');
  if (value === 'barangay_official' || value === 'official') return 'official';
  return value;
};

const RoleGuard = ({ allowed = [], denied = [], children }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const normalizedUserRole = normalizeRoleValue(user.role);
  const normalizedDenied = denied.map((role) => normalizeRoleValue(role));
  if (normalizedDenied.includes(normalizedUserRole)) {
    return <Navigate to="/not-authorized" replace />;
  }
  if (allowed.length === 0) return children;
  const normalizedAllowed = allowed.map((role) => normalizeRoleValue(role));
  if (normalizedAllowed.includes(normalizedUserRole)) return children;
  return <Navigate to="/not-authorized" replace />;
};

export default RoleGuard;
