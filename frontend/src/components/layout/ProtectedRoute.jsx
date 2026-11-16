import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { token, user, offlineVaultReady, loading } = useContext(AuthContext);
  if (loading) return null;
  if (!token && !(user && offlineVaultReady)) return <Navigate to="/login" replace />;
  return children;
};

export default ProtectedRoute;
