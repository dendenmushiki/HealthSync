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
      {error && <div className="alert alert-danger">{error}</div>}
      <OperationTimbangForm onSaved={fetchRecords} />
    </div>
  );
};

export default OperationTimbangPage;
