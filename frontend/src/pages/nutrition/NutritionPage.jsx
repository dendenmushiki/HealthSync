import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import OperationTimbangPage from '../operation-timbang/OperationTimbangPage';
import AdolescentBMIPage from '../adolescent-bmi/AdolescentBMIPage';
import AdultBMIPage from '../adult-bmi/AdultBMIPage';
import NutritionLayout from '../../components/nutrition/NutritionLayout';
import NutritionRecordsPage from './NutritionRecordsPage';
import StatusBanner from '../../components/common/StatusBanner';

const NutritionPage = () => {
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const activeTab = useMemo(() => {
    if (tabFromUrl === 'operation-timbang' || tabFromUrl === 'bmi-computation') return tabFromUrl;
    return 'recent-records';
  }, [tabFromUrl]);
  const bmiFromUrl = searchParams.get('bmi');
  const [bmiMode, setBmiMode] = useState(bmiFromUrl === 'adult' ? 'adult' : 'adolescent');
  const [createRecordOpen, setCreateRecordOpen] = useState(false);
  const createRecordRef = useRef(null);
  useEffect(() => {
    if (activeTab === 'bmi-computation') setBmiMode(bmiFromUrl === 'adult' ? 'adult' : 'adolescent');
  }, [activeTab, bmiFromUrl]);

  useEffect(() => {
    if (!createRecordOpen) return undefined;
    createRecordRef.current?.querySelector('button')?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setCreateRecordOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [createRecordOpen]);

  useEffect(() => {
    const openCreateModal = () => setCreateRecordOpen(true);
    window.addEventListener('healthsync:create-nutrition-record', openCreateModal);
    return () => window.removeEventListener('healthsync:create-nutrition-record', openCreateModal);
  }, []);

  const openCreateRecord = (type) => {
    setCreateRecordOpen(false);
    if (type === 'operation-timbang') {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('tab', 'operation-timbang');
        next.delete('bmi');
        return next;
      });
    } else {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('tab', 'bmi-computation');
        next.set('bmi', type);
        return next;
      });
    }
  };
  const setBmiModeAndUrl = (mode) => {
    setBmiMode(mode);
    setSearchParams((current) => { current.set('tab', 'bmi-computation'); current.set('bmi', mode); return current; });
  };
  const handleBack = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('tab');
      next.delete('bmi');
      return next;
    });
  };
  const renderModule = () => {
    switch (activeTab) {
      case 'recent-records':
        return <div className="nutrition-module-shell"><NutritionRecordsPage /></div>;
      case 'operation-timbang':
        return <div className="nutrition-module-shell"><OperationTimbangPage /></div>;
      case 'bmi-computation':
        return (
          <div className="nutrition-module-shell">
            <div className="bmi-computation-card">
              {bmiMode === 'adolescent' ? <AdolescentBMIPage onSwitchToAdult={() => setBmiModeAndUrl('adult')} /> : <AdultBMIPage onSwitchToAdolescent={() => setBmiModeAndUrl('adolescent')} />}
            </div>
          </div>
        );
      default:
        return <div className="nutrition-module-shell"><OperationTimbangPage /></div>;
    }
  };

  return (
    <div className="page-shell">
      {error && <StatusBanner error={error} compact />}
      <NutritionLayout
        tabs={[]}
        activeTab={activeTab}
        onCreateRecord={() => setCreateRecordOpen(true)}
        onBack={activeTab === 'recent-records' ? undefined : handleBack}
        showHeader={activeTab !== 'recent-records'}
      >
        {renderModule()}
      </NutritionLayout>
      {createRecordOpen && (
        <div className="nutrition-create-record-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCreateRecordOpen(false);
        }}>
          <section ref={createRecordRef} className="nutrition-create-record-modal" role="dialog" aria-modal="true" aria-labelledby="create-record-title">
            <header>
              <div><span>Create nutritional assessment</span><h2 id="create-record-title">Create Record</h2></div>
              <button type="button" className="nutrition-create-record-close" aria-label="Close create record" onClick={() => setCreateRecordOpen(false)}>×</button>
            </header>
            <div className="nutrition-create-record-options">
              <button type="button" onClick={() => openCreateRecord('operation-timbang')}>
                <span className="nutrition-create-record-icon" aria-hidden="true">▣</span>
                <span><strong>Operation Timbang</strong><small>Child nutritional assessment</small></span>
                <span aria-hidden="true">›</span>
              </button>
              <button type="button" onClick={() => openCreateRecord('adolescent')}>
                <span className="nutrition-create-record-icon" aria-hidden="true">◷</span>
                <span><strong>Adolescent BMI</strong><small>BMI assessment for ages 5–19</small></span>
                <span aria-hidden="true">›</span>
              </button>
              <button type="button" onClick={() => openCreateRecord('adult')}>
                <span className="nutrition-create-record-icon" aria-hidden="true">⚖</span>
                <span><strong>Adult BMI</strong><small>BMI assessment for adults</small></span>
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default NutritionPage;
