import React, { useEffect, useState } from 'react';
import { listOperationTimbang } from '../../services/api/operationTimbangService';
import OperationTimbangForm from './OperationTimbangForm';

const OperationTimbangPage = () => {
  const [error, setError] = useState('');

  const fetchRecords = async () => {
    // kept to refresh after successful save without rendering the redundant recent list here
    setError('');
  };

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      <OperationTimbangForm onSaved={fetchRecords} />
    </div>
  );
};

export default OperationTimbangPage;
