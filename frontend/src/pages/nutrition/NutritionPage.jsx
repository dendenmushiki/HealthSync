import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listOperationTimbang } from '../../services/api/operationTimbangService';
import { listAdolescentBMI } from '../../services/api/adolescentBMIService';
import { listAdultBMI } from '../../services/api/adultBMIService';
import { deleteOperationTimbang } from '../../services/api/operationTimbangService';
import { deleteAdolescentBMI } from '../../services/api/adolescentBMIService';
import { deleteAdultBMI } from '../../services/api/adultBMIService';
import OperationTimbangPage from '../operation-timbang/OperationTimbangPage';
import AdolescentBMIPage from '../adolescent-bmi/AdolescentBMIPage';
import AdultBMIPage from '../adult-bmi/AdultBMIPage';
import Pagination from '../../components/common/Pagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import { formatNutritionRecordAge } from '../../utils/nutritionRecordAge';
import NutritionLayout from '../../components/nutrition/NutritionLayout';
import NutritionRecordsPage from './NutritionRecordsPage';
import StatusBanner from '../../components/common/StatusBanner';

const tabs = [
  { key: 'operation-timbang', label: 'Operation Timbang', icon: '▣' },
  { key: 'bmi-computation', label: 'BMI Computation', icon: '⚖' },
  { key: 'recent-records', label: 'Recent Records', icon: '▤' },
];

const formatResidentName = (item) => `${item?.first_name || 'Unknown'} ${item?.last_name || ''}`.trim();

const NutritionPage = () => {
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const activeTab = useMemo(() => tabs.some((tab) => tab.key === tabFromUrl) ? tabFromUrl : 'operation-timbang', [tabFromUrl]);
  const setActiveTab = (tab) => setSearchParams((current) => { current.set('tab', tab); return current; });
  const bmiFromUrl = searchParams.get('bmi');
  const [bmiMode, setBmiMode] = useState(bmiFromUrl === 'adult' ? 'adult' : 'adolescent');
  useEffect(() => {
    if (activeTab === 'bmi-computation') setBmiMode(bmiFromUrl === 'adult' ? 'adult' : 'adolescent');
  }, [activeTab, bmiFromUrl]);
  const setBmiModeAndUrl = (mode) => {
    setBmiMode(mode);
    setSearchParams((current) => { current.set('tab', 'bmi-computation'); current.set('bmi', mode); return current; });
  };
  const [recentRecords, setRecentRecords] = useState([]);
  const [recentSearch, setRecentSearch] = useState('');
  const [recentSort, setRecentSort] = useState('date');
  const [recentOrder, setRecentOrder] = useState('desc');
  const [recentPage, setRecentPage] = useState(1);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadRecentRecords = useCallback(async () => {
    setRecentLoading(true);
    setError('');
    try {
      const [operationResp, adolescentResp, adultResp] = await Promise.all([
        listOperationTimbang({ page: 1, limit: 100, sort: 'created_at' }),
        listAdolescentBMI({ page: 1, limit: 100, sort: 'created_at' }),
        listAdultBMI({ page: 1, limit: 100, sort: 'created_at' }),
      ]);

      const operationRecords = (operationResp?.data?.items || []).map((item) => ({ ...item, recordType: 'Operation Timbang', recordKey: `operation-${item.timbang_id}` }));
      const adolescentRecords = (adolescentResp?.data?.items || []).map((item) => ({ ...item, recordType: 'Adolescent BMI', recordKey: `adolescent-${item.record_id}` }));
      const adultRecords = (adultResp?.data?.items || []).map((item) => ({ ...item, recordType: 'Adult BMI', recordKey: `adult-${item.bmi_id}` }));

      setRecentRecords([...operationRecords, ...adolescentRecords, ...adultRecords]);
      setRecentPage(1);
    } catch (err) {
      console.error('Unable to load recent nutrition records.', err);
      setError(err);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'recent-records') {
      loadRecentRecords();
    }
  }, [activeTab, loadRecentRecords]);

  const filteredRecentRecords = recentRecords
    .filter((item) => {
      const searchText = `${formatResidentName(item)} ${item.recordType}`.toLowerCase();
      return searchText.includes(recentSearch.trim().toLowerCase());
    })
    .sort((first, second) => {
      const direction = recentOrder === 'asc' ? 1 : -1;
      if (recentSort === 'name') return formatResidentName(first).localeCompare(formatResidentName(second)) * direction;
      if (recentSort === 'type') return first.recordType.localeCompare(second.recordType) * direction;
      const firstDate = first.created_at || first.recordDate || first.date_recorded || first.record_date || 0;
      const secondDate = second.created_at || second.recordDate || second.date_recorded || second.record_date || 0;
      const firstTimestamp = new Date(firstDate).getTime() || 0;
      const secondTimestamp = new Date(secondDate).getTime() || 0;
      return (firstTimestamp - secondTimestamp) * direction;
    });

  const recentTotalPages = Math.ceil(filteredRecentRecords.length / 10);
  const recentFirst = filteredRecentRecords.length ? ((recentPage - 1) * 10) + 1 : 0;
  const recentLast = Math.min(recentPage * 10, filteredRecentRecords.length);
  const visibleRecentRecords = filteredRecentRecords.slice((recentPage - 1) * 10, recentPage * 10);

  const handleDeleteRecentRecord = async () => {
    if (!recordToDelete) return;
    setDeleting(true);
    setError('');
    try {
      if (recordToDelete.recordType === 'Operation Timbang') {
        await deleteOperationTimbang(recordToDelete.timbang_id);
      } else if (recordToDelete.recordType === 'Adolescent BMI') {
        await deleteAdolescentBMI(recordToDelete.record_id);
      } else {
        await deleteAdultBMI(recordToDelete.bmi_id);
      }

      const nextRecords = recentRecords.filter((item) => item.recordKey !== recordToDelete.recordKey);
      const nextFilteredCount = nextRecords.filter((item) => {
        const searchText = `${formatResidentName(item)} ${item.recordType}`.toLowerCase();
        return searchText.includes(recentSearch.trim().toLowerCase());
      }).length;
      setRecentRecords(nextRecords);
      setRecentPage((currentPage) => Math.min(currentPage, Math.max(1, Math.ceil(nextFilteredCount / 10))));
      setRecordToDelete(null);
    } catch (deleteError) {
      console.error('Unable to delete nutrition record.', deleteError);
      setError(deleteError);
      setRecordToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const renderRecentRecords = () => {
    return (
      <div className="recent-records-section">
        <div className="recent-records-header">
          <h5>Recent Nutrition Records</h5>
        </div>

        <div className="resident-controls recent-record-controls">
          <div className="resident-search"><label className="form-label" htmlFor="recent-record-search">Search records</label><input id="recent-record-search" className="form-control healthsync-form-input" placeholder="Search by resident or record type..." value={recentSearch} onChange={(event) => { setRecentSearch(event.target.value); setRecentPage(1); }} /></div>
          <div><label className="form-label" htmlFor="recent-record-sort">Sort by</label><select id="recent-record-sort" className="form-select healthsync-form-input" value={recentSort} onChange={(event) => { setRecentSort(event.target.value); setRecentPage(1); }}><option value="date">Date added</option><option value="name">Resident name</option><option value="type">Record type</option></select></div>
          <div><label className="form-label" htmlFor="recent-record-order">Order</label><select id="recent-record-order" className="form-select healthsync-form-input" value={recentOrder} onChange={(event) => { setRecentOrder(event.target.value); setRecentPage(1); }}><option value="desc">Descending</option><option value="asc">Ascending</option></select></div>
        </div>

        <div className="table-responsive mt-3">
          <table className="table table-sm table-hover mb-0 recent-records-table">
            <thead><tr><th>Record Type</th><th>Resident</th><th>Age</th><th>Measurement</th><th>Result / Status</th><th>Record Date</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleRecentRecords.length === 0 ? <tr><td colSpan="7" className="text-center text-muted py-4">No records found.</td></tr> : visibleRecentRecords.map((item) => {
                const recordDate = item.recordDate || item.date_recorded || item.measurement_date || item.record_date || item.created_at;
                const measurement = item.recordType === 'Operation Timbang'
                  ? `${item.weight_kg ?? '-'} kg / ${item.measurement_cm ?? '-'} cm`
                  : `${item.weight_kg ?? '-'} kg / ${item.height_cm ?? '-'} cm`;
                const result = item.recordType === 'Operation Timbang'
                  ? item.wflh_status || '-'
                  : item.bmi_category || item.bmi_for_age_category || '-';
                return <tr key={item.recordKey}><td>{item.recordType}</td><td>{formatResidentName(item)}</td><td>{formatNutritionRecordAge({ ...item, recordDate })}</td><td>{measurement}</td><td>{result}</td><td>{recordDate ? String(recordDate).slice(0, 10) : '-'}</td><td><button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Delete ${item.recordType} record for ${formatResidentName(item)}`} onClick={() => setRecordToDelete(item)}>Delete</button></td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={recentPage} totalPages={recentTotalPages} first={recentFirst} last={recentLast} total={filteredRecentRecords.length} itemLabel="records" onPageChange={setRecentPage} />
        <ConfirmModal
          open={Boolean(recordToDelete)}
          title="Delete nutrition record?"
          message={recordToDelete ? `This permanently deletes the ${recordToDelete.recordType} record for ${formatResidentName(recordToDelete)}.` : ''}
          busy={deleting}
          onCancel={() => setRecordToDelete(null)}
          onConfirm={handleDeleteRecentRecord}
        />
      </div>
    );
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
              <div className="bmi-mode-switcher" role="tablist" aria-label="BMI type selector">
                <button
                  type="button"
                  className={`bmi-mode-btn ${bmiMode === 'adolescent' ? 'active' : ''}`}
                  onClick={() => setBmiModeAndUrl('adolescent')}
                >
                  Adolescent (5–19 yrs)
                </button>
                <button
                  type="button"
                  className={`bmi-mode-btn ${bmiMode === 'adult' ? 'active' : ''}`}
                  onClick={() => setBmiModeAndUrl('adult')}
                >
                  Adult (20+ yrs)
                </button>
              </div>

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
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {renderModule()}
      </NutritionLayout>
    </div>
  );
};

export default NutritionPage;
