import React from 'react';
import AdultBMIFormRedesign from './AdultBMIFormRedesign';

const AdultBMIPage = ({ onSwitchToAdolescent }) => {
  const fetchRecords = async () => {};
  return (
    <div className="container mt-4">
      <AdultBMIFormRedesign onSaved={fetchRecords} onSwitchToAdolescent={onSwitchToAdolescent} />
    </div>
  );
};

export default AdultBMIPage;
