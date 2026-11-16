import React from 'react';
import AdolescentBMIFormRedesign from './AdolescentBMIFormRedesign';

const AdolescentBMIPage = ({ onSwitchToAdult }) => {
  const fetchRecords = async () => {
    // kept to satisfy the save callback without rendering redundant recent lists here
  };

  return (
    <div className="container mt-4">
      <AdolescentBMIFormRedesign onSaved={fetchRecords} onSwitchToAdult={onSwitchToAdult} />
    </div>
  );
};

export default AdolescentBMIPage;
