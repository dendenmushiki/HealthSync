import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Pagination from '../../components/common/Pagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import ClassificationBadge from '../../components/nutrition/ClassificationBadge';
import ResultPanel from '../../components/nutrition/ResultPanel';
import TrendChart from '../../components/nutrition/TrendChart';
import { listNutritionRecords, getNutritionRecord, exportNutritionRecords } from '../../services/api/nutritionRecordsService';
import { deleteOperationTimbang } from '../../services/api/operationTimbangService';
import { deleteAdolescentBMI } from '../../services/api/adolescentBMIService';
import { deleteAdultBMI } from '../../services/api/adultBMIService';
import { formatDateLabel } from '../../utils/dateUtils';

const nameFor = (row) => [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(' ').trim();
const typeKey = (type) => type === 'Operation Timbang' ? 'operation' : type === 'Adolescent BMI' ? 'adolescent' : 'adult';
const ageLabel = (row) => {
  if (!row.birthdate || !row.record_date) return 'Age unknown'; const birth=new Date(`${String(row.birthdate).slice(0,10)}T00:00:00`); const record=new Date(`${row.record_date}T00:00:00`);
  if (Number.isNaN(birth.getTime())||Number.isNaN(record.getTime())||record<birth) return 'Age unknown'; let months=(record.getFullYear()-birth.getFullYear())*12+record.getMonth()-birth.getMonth(); if(record.getDate()<birth.getDate())months-=1;
  return months < 12 ? `${months} mo${months===1?'':'s'}` : `${Math.floor(months/12)} yr${Math.floor(months/12)===1?'':'s'}${months%12?` ${months%12} mos`:''}`;
};

const NutritionRecordsPage = () => {
  const [searchParams,setSearchParams]=useSearchParams(); const searchParam=searchParams.get('search')||'';
  const [search,setSearch]=useState(searchParam); const [items,setItems]=useState([]); const [counts,setCounts]=useState({total:0,attention:0,month:0,childrenThisYear:0,type:{operation:0,adolescent:0,adult:0}}); const [total,setTotal]=useState(0); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [deleteRow,setDeleteRow]=useState(null); const [deleting,setDeleting]=useState(false); const [drawer,setDrawer]=useState(null); const [drawerDetail,setDrawerDetail]=useState(null); const drawerRef=useRef(null); const rowFocus=useRef(null);
  const type=searchParams.get('type')||'All'; const status=searchParams.get('status')||''; const sort=searchParams.get('sort')||'date'; const order=searchParams.get('order')||'desc'; const page=Number(searchParams.get('page')||1); const pageSize=Number(searchParams.get('pageSize')||10); const latestOnly=searchParams.get('latestOnly')==='true'; const from=searchParams.get('from')||''; const to=searchParams.get('to')||'';
  const setParam=(key,value)=>setSearchParams((current)=>{const next=new URLSearchParams(current); if(value===null||value===''||value===false) next.delete(key); else next.set(key,String(value)); if(key!=='page') next.set('page','1'); return next;});
  useEffect(()=>{const timer=window.setTimeout(()=>{setParam('search',search);},300); return()=>window.clearTimeout(timer);},[search]); // eslint-disable-line react-hooks/exhaustive-deps
  const load=useCallback(async()=>{setLoading(true);setError('');try{const response=await listNutritionRecords({search:searchParam,type:type==='All'?undefined:type,status,from,to,latestOnly,sort,order,page,pageSize});if(response.success){setItems(response.data.items||[]);setCounts(response.data.counts||{});setTotal(response.data.total||0)}}catch(error){setError(error.response?.data?.message||'Unable to load nutrition records.')}finally{setLoading(false)}},[searchParam,type,status,from,to,latestOnly,sort,order,page,pageSize]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    const recordParam=searchParams.get('record');
    if(!recordParam||drawer)return;
    const separator=recordParam.indexOf('-');
    if(separator<1)return;
    const recordType=recordParam.slice(0,separator);
    const id=Number(recordParam.slice(separator+1));
    if(!id)return;
    const found=items.find((row)=>Number(row.id)===id&&typeKey(row.record_type)===recordType);
    if(found){openDrawer(found);return}
    getNutritionRecord(recordType,id).then((response)=>{
      if(response.success){const row=response.data;setDrawer(row);setDrawerDetail(row)}
    }).catch(()=>setDrawer(null));
  },[searchParams,items,drawer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!searchParam&&search!==searchParam)setSearch(searchParam)},[searchParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{const handler=(event)=>{const target=event.target;if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)){event.preventDefault();document.getElementById('nutrition-record-search')?.focus()}};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler)},[]);
  const openDrawer=async(row,event)=>{rowFocus.current=event?.currentTarget;setDrawer(row);setSearchParams((current)=>{const next=new URLSearchParams(current);next.set('record',`${typeKey(row.record_type)}-${row.id}`);return next});try{const response=await getNutritionRecord(typeKey(row.record_type),row.id);if(response.success)setDrawerDetail(response.data)}catch(error){setDrawerDetail(row)}};
  useEffect(() => {
    if (!drawer) return undefined;
    drawerRef.current?.focus();
    const handler = (event) => {
      if (event.key === 'Escape') {
        setDrawer(null);
        setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('record'); return next; });
        rowFocus.current?.focus();
      }
      if (event.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll('button,a,input,[tabindex]:not([tabindex="-1"])' );
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [drawer, setSearchParams]);
  const confirmDelete=async()=>{if(!deleteRow)return;setDeleting(true);try{if(deleteRow.record_type==='Operation Timbang')await deleteOperationTimbang(deleteRow.id);else if(deleteRow.record_type==='Adolescent BMI')await deleteAdolescentBMI(deleteRow.id);else await deleteAdultBMI(deleteRow.id);setDeleteRow(null);await load();}catch(error){setError(error.response?.data?.message||'Unable to delete nutrition record.');setDeleteRow(null)}finally{setDeleting(false)}};
  const navigateFromDrawer=async(target)=>{if(!target)return;const response=await getNutritionRecord(typeKey(target.type),target.id);if(response.success){const row=response.data;setDrawer(row);setDrawerDetail(row);setSearchParams((current)=>{const next=new URLSearchParams(current);next.set('record',`${typeKey(target.type)}-${target.id}`);return next})}};
  const exportCsv=async()=>{const blob=await exportNutritionRecords({search:searchParam,type:type==='All'?undefined:type,status,from,to,latestOnly,sort,order});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='nutrition-records.csv';link.click();URL.revokeObjectURL(url)};
  const clearAll=()=>setSearchParams((current)=>{const next=new URLSearchParams(current);['search','type','status','from','to','latestOnly','sort','order','page','pageSize'].forEach((key)=>next.delete(key));return next});
  const filterCount=[search,type!=='All'?type:null,status,from,to,latestOnly?'latestOnly':null].filter(Boolean).length;
  const invalidDateRange=Boolean(from&&to&&from>to);
  const first=total ? (page-1)*pageSize+1:0; const last=Math.min(page*pageSize,total);
  return <div className="nutrition-records-page">
    <div className="nutrition-records-summary" aria-label="Nutrition record summaries"><button className={type==='All'?'active':''} onClick={()=>setParam('type','All')}><span>Total records</span><strong>{counts.total||0}</strong></button><button className={status==='attention'?'active':''} onClick={()=>setParam('status',status==='attention'?null:'attention')}><span>Needs follow-up</span><strong>{counts.attention||0}</strong></button><button onClick={()=>{setParam('status',null);setParam('from',new Date().toISOString().slice(0,7)+'-01');setParam('to',new Date().toISOString().slice(0,10))}}><span>Recorded this month</span><strong>{counts.month||0}</strong></button><button onClick={()=>{setParam('type','Operation Timbang');setParam('from',`${new Date().getFullYear()}-01-01`)}}><span>Children this year</span><strong>{counts.childrenThisYear||0}</strong></button></div>
    <section className="nutrition-records-controls-card" aria-label="Nutrition record filters">
    <div className="nutrition-records-toolbar">
      <div className="nutrition-record-search"><label htmlFor="nutrition-record-search">Search records</label><span aria-hidden="true">⌕</span><input id="nutrition-record-search" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search name, type, or status"/><button type="button" aria-label="Clear search" onClick={()=>setSearch('')}>×</button></div>
      <div className="nutrition-record-toolbar-actions"><button type="button" className="nutrition-button nutrition-button--outline" onClick={exportCsv}>Export CSV</button></div>
    </div>
    <div className="nutrition-record-type-tabs" role="tablist" aria-label="Record type filters">{['All','Operation Timbang','Adolescent BMI','Adult BMI'].map((label)=>{const count=label==='All'?counts.total:(label==='Operation Timbang'?counts.type?.operation:label==='Adolescent BMI'?counts.type?.adolescent:counts.type?.adult)||0;return <button type="button" role="tab" aria-selected={type===label} className={type===label?'active':''} key={label} onClick={()=>setParam('type',label)}>{label}<span>{count}</span></button>})}</div>
    <div className="nutrition-record-filters"><label>Status<select value={status} onChange={(e)=>setParam('status',e.target.value)}><option value="">All statuses</option><option value="normal">Normal</option><option value="attention">Needs attention</option></select></label><label>Sort<select value={`${sort}:${order}`} onChange={(e)=>{const [s,o]=e.target.value.split(':');setParam('sort',s);setParam('order',o)}}><option value="date:desc">Record date: newest first</option><option value="date:asc">Record date: oldest first</option><option value="name:asc">Resident A-Z</option><option value="status:desc">Needs attention first</option></select></label><label>From<input type="date" value={from} onChange={(e)=>setParam('from',e.target.value)} /></label><label>To<input type="date" value={to} onChange={(e)=>setParam('to',e.target.value)} /></label><label className="nutrition-switch"><input type="checkbox" checked={latestOnly} onChange={(e)=>setParam('latestOnly',e.target.checked?'true':null)} />Latest per resident</label></div>
    {invalidDateRange&&<div className="nutrition-record-error" role="alert"><strong>Invalid date range</strong><p>From date must be on or before To date.</p></div>}
    {filterCount>0&&<div className="nutrition-active-filters" aria-live="polite"><span>{total} matching records</span>{search&&<button onClick={()=>setSearch('')}>Search: {search} ×</button>}{type!=='All'&&<button onClick={()=>setParam('type',null)}>{type} ×</button>}{status&&<button onClick={()=>setParam('status',null)}>{status==='attention'?'Needs attention':'Normal'} ×</button>}{latestOnly&&<button onClick={()=>setParam('latestOnly',null)}>Latest per resident ×</button>}<button className="clear" onClick={clearAll}>Clear all</button></div>}
    </section>
    <section className="nutrition-records-list-card" aria-label="Nutrition records">
      <header className="nutrition-records-list-heading"><div><h2>Nutrition records</h2><p>{total} {total === 1 ? 'record' : 'records'}{filterCount ? ' matching your filters' : ' in the register'}</p></div></header>
    {error?<div className="nutrition-record-error" role="alert"><strong>Unable to load records</strong><p>{error}</p><button type="button" className="nutrition-button nutrition-button--outline" onClick={load}>Try again</button></div>:null}
    <div className="nutrition-record-table-wrap"><table className="nutrition-record-table"><thead><tr><th scope="col" aria-sort={sort==='name'?(order==='asc'?'ascending':'descending'):'none'}>Resident</th><th scope="col">Type</th><th scope="col">Age</th><th scope="col">Measurement</th><th scope="col">Result</th><th scope="col" aria-sort={sort==='date'?(order==='asc'?'ascending':'descending'):'none'}>Record date</th><th scope="col">Recorded by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{loading&&items.length===0?[0,1,2,3].map((key)=><tr className="nutrition-record-skeleton" key={key}>{[0,1,2,3,4,5,6,7].map((col)=><td key={col}><span /></td>)}</tr>):items.map((row)=><tr key={`${typeKey(row.record_type)}-${row.id}`} tabIndex="0" onClick={(e)=>openDrawer(row,e)} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' ')openDrawer(row,e)}}><td><div className="nutrition-record-resident"><span className="nutrition-avatar">{(row.first_name||'?').charAt(0)}</span><div><button type="button" className="nutrition-resident-link" onClick={(e)=>{e.stopPropagation();window.location.assign(`/residents/${row.resident_id}`)}}>{nameFor(row)}</button><small>{row.sex||'Sex unknown'} · {row.household_no?`HH ${row.household_no}`:'No household'}</small></div></div></td><td><span className={`nutrition-type-badge ${typeKey(row.record_type)}`}>{row.record_type==='Operation Timbang'?'▣':row.record_type==='Adolescent BMI'?'◷':'⚖'} {row.record_type}</span></td><td>{ageLabel(row)}</td><td><strong>{Number(row.weight_kg||0).toFixed(1)} kg</strong><small>{Number(row.height_cm||0).toFixed(1)} cm{row.bmi?` · BMI ${Number(row.bmi).toFixed(2)}`:''}</small></td><td><ClassificationBadge status={row.status} severe={/severe|obese|stunted|wasted/i.test(row.status||'')} />{row.record_type==='Operation Timbang'&&<div className="nutrition-indicator-chips">{row.indicators?.map((indicator)=><span title={`${indicator.code}: ${indicator.status}`} key={indicator.code}>{indicator.code}</span>)}</div>}</td><td>{formatDateLabel(row.record_date)}</td><td>{row.recorded_by_name||'Unknown user'}</td><td><div className="nutrition-row-actions"><button type="button" title="View record" aria-label={`View ${row.record_type} for ${nameFor(row)}`} onClick={(e)=>{e.stopPropagation();openDrawer(row,e)}}>👁</button><button type="button" title="Record menu" aria-label={`More actions for ${nameFor(row)}`} onClick={(e)=>{e.stopPropagation();setDeleteRow(row)}}>⋯</button></div></td></tr>)}</tbody></table></div>
    {!loading&&!items.length&&<div className="nutrition-record-empty"><h3>{filterCount?'No matching nutrition records':'No nutrition records yet'}</h3><p>{filterCount?'Try clearing filters or broadening your search.':'Add a measurement from Timbang or BMI computation.'}</p>{filterCount?<button className="nutrition-button nutrition-button--outline" onClick={clearAll}>Clear filters</button>:<><button className="nutrition-button nutrition-button--primary" onClick={()=>window.location.assign('/nutrition?tab=operation-timbang')}>Go to Operation Timbang</button><button className="nutrition-button nutrition-button--outline" onClick={()=>window.location.assign('/nutrition?tab=bmi-computation')}>Go to BMI computation</button></>}</div>}
    <Pagination currentPage={page} totalPages={Math.ceil(total/pageSize)} first={first} last={last} total={total} itemLabel="records" pageSize={pageSize} onPageSizeChange={(size)=>setParam('pageSize',size)} onPageChange={(next)=>setParam('page',next)} />
    </section>
    <ConfirmModal open={Boolean(deleteRow)} title="Delete nutrition record?" message={deleteRow?`Permanently delete the ${deleteRow.record_type} record for ${nameFor(deleteRow)}, recorded ${formatDateLabel(deleteRow.record_date)}?`:''} busy={deleting} onCancel={()=>setDeleteRow(null)} onConfirm={confirmDelete}/>
    {drawer&&<><div className="nutrition-drawer-backdrop" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget){setDrawer(null);setSearchParams((current)=>{const next=new URLSearchParams(current);next.delete('record');return next});rowFocus.current?.focus()}}}/><aside className="nutrition-record-drawer" role="dialog" aria-modal="true" aria-label="Nutrition record details" ref={drawerRef} tabIndex="-1"><header><button type="button" aria-label="Close record details" onClick={()=>{setDrawer(null);setSearchParams((current)=>{const next=new URLSearchParams(current);next.delete('record');return next});rowFocus.current?.focus()}}>×</button><div className="nutrition-record-drawer-title"><span className="nutrition-avatar">{(drawer.first_name||'?').charAt(0)}</span><div><button type="button" className="nutrition-resident-link" onClick={()=>window.location.assign(`/residents/${drawer.resident_id}`)}>{nameFor(drawer)}</button><small>{drawer.record_type} · {formatDateLabel(drawer.record_date)}</small></div></div></header><div className="nutrition-record-drawer-body"><ResultPanel mode={drawer.record_type==='Operation Timbang'?'nutrition':drawer.record_type==='Adult BMI'?'adult-bmi':'bmi'} result={drawer.record_type==='Adolescent BMI'?{bmi:drawer.bmi,bmi_for_age_category:drawer.status,bmi_for_age_zscore:drawer.bmi_for_age_zscore}:drawer.record_type==='Adult BMI'?{bmi:drawer.bmi,bmi_category:drawer.status,weight_kg:drawer.weight_kg}:drawerDetail||drawer} heightCm={Number(drawer.height_cm)} resident={drawer} /><PreviousFallback detail={drawerDetail} onNavigate={navigateFromDrawer}/><TrendChart mode={drawer.record_type==='Adult BMI'?'adult-bmi':drawer.record_type==='Adolescent BMI'?'bmi':'nutrition'} items={drawerDetail?.history||[]} /></div><footer><button className="nutrition-button nutrition-button--outline" onClick={()=>window.location.assign(`/residents/${drawer.resident_id}`)}>View resident</button><button className="nutrition-button nutrition-button--danger" onClick={()=>setDeleteRow(drawer)}>Delete</button></footer></aside></>}
  </div>;
};

const PreviousFallback=({detail,onNavigate})=>detail?.previousId||detail?.nextId?<div className="nutrition-drawer-history-nav"><button type="button" className="nutrition-button nutrition-button--outline" disabled={!detail.previousId} onClick={()=>onNavigate(detail.previousId)}>Previous</button><button type="button" className="nutrition-button nutrition-button--outline" disabled={!detail.nextId} onClick={()=>onNavigate(detail.nextId)}>Next</button></div>:null;
export default NutritionRecordsPage;
