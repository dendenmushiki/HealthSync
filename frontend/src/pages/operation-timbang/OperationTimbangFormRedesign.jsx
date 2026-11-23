import React, { useEffect, useMemo, useRef, useState } from 'react';
import ResidentPicker from '../../components/nutrition/ResidentPicker';
import ResidentSummaryCard from '../../components/nutrition/ResidentSummaryCard';
import MeasurementInput from '../../components/nutrition/MeasurementInput';
import ResultPanel from '../../components/nutrition/ResultPanel';
import PreviousMeasurements from '../../components/nutrition/PreviousMeasurements';
import TrendChart from '../../components/nutrition/TrendChart';
import ConfirmModal from '../../components/common/ConfirmModal';
import { calculateOperationTimbang, createOperationTimbang, getPreviousOperationTimbang } from '../../services/api/operationTimbangService';
import { getLocalDateInputValue, formatDateLabel } from '../../utils/dateUtils';
import { normalizeResidentId } from '../../utils/residentUtils';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const initialForm = () => ({ resident_id: '', date_recorded: getLocalDateInputValue(), weight_kg: '', measurement_cm: '', measurement_type: '' });

export const getAgeInMonths = (birthdate, dateRecorded, today = getLocalDateInputValue()) => {
  const parse = (value) => { const match = /^\d{4}-\d{2}-\d{2}$/.exec(String(value || '')); if (!match) return null; const [y,m,d] = String(value).split('-').map(Number); const date = new Date(Date.UTC(y,m-1,d)); return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d ? {y,m,d,date} : null; };
  const birth=parse(birthdate), record=parse(dateRecorded), current=parse(today);
  if (!birth || !record || !current || birth.date > current.date || record.date > current.date || record.date < birth.date) return null;
  let months=(record.y-birth.y)*12+record.m-birth.m; if(record.d<birth.d) months-=1; return months;
};

const FormIcon = ({ children }) => <span className="nutrition-card-icon" aria-hidden="true">{children}</span>;

const OperationTimbangFormRedesign = ({ onSaved }) => {
  const [form, setForm] = useState(initialForm); const [resident, setResident] = useState(null);
  const [preview, setPreview] = useState(null); const [savedResult, setSavedResult] = useState(null);
  const [calculating, setCalculating] = useState(false); const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]); const [historyLoading, setHistoryLoading] = useState(false);
  const [errors, setErrors] = useState({}); const [toast, setToast] = useState(null); const [duplicate, setDuplicate] = useState(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pickerRef = useRef(null);
  const ageMonths = useMemo(() => getAgeInMonths(resident?.birthdate, form.date_recorded), [resident, form.date_recorded]);
  const outOfRange = resident && ageMonths !== null && ageMonths >= 60 ? `This resident is ${Math.floor(ageMonths / 12)} years old. Use BMI computation` : null;

  useEffect(() => {
    if (!resident || form.resident_id !== resident.resident_id) { setHistory([]); return undefined; }
    let active=true; setHistoryLoading(true);
    getPreviousOperationTimbang(resident.resident_id, 12).then((response)=>{ if(active && response?.success) setHistory(response.data||[]); }).catch(()=>{ if(active) setHistory([]); }).finally(()=>{ if(active) setHistoryLoading(false); });
    return () => { active=false; };
  }, [resident, form.resident_id]);

  useEffect(() => {
    if (!ageMonths === false) {}
    if (resident && ageMonths !== null) setForm((current) => ({...current, measurement_type: current.measurement_type || (ageMonths < 24 ? 'length' : 'height')}));
  }, [resident, ageMonths]);

  const complete = resident && ageMonths !== null && ageMonths < 60 && form.date_recorded && form.weight_kg !== '' && form.measurement_cm !== '' && form.measurement_type;
  useEffect(() => {
    if (!complete) { setPreview(null); setCalculating(false); return undefined; }
    let active=true; const timer=window.setTimeout(async()=>{ setCalculating(true); setErrors({}); try { const response=await calculateOperationTimbang({resident_id:normalizeResidentId(form.resident_id),date_recorded:form.date_recorded,weight_kg:Number(form.weight_kg),measurement_cm:Number(form.measurement_cm),measurement_type:form.measurement_type}); if(active && response?.success) setPreview(response.data); } catch(error){ if(active){ const responseErrors=error.response?.data?.errors; setErrors(responseErrors||{measurement_cm:error.response?.data?.message||'Unable to calculate assessment.'}); setPreview(null); } } finally{ if(active) setCalculating(false); } },300);
    return()=>{active=false;window.clearTimeout(timer);};
  }, [complete, form]);

  const dirty = Boolean(resident || form.weight_kg || form.measurement_cm || form.measurement_type);
  useEffect(()=>{ const handler=(event)=>{ if(!dirty) return; event.preventDefault(); event.returnValue=''; }; window.addEventListener('beforeunload',handler); return()=>window.removeEventListener('beforeunload',handler); },[dirty]);

  const handleChange=(event)=>{ const {name,value}=event.target; setForm((current)=>({...current,[name]:value})); setPreview(null); setSavedResult(null); setErrors((current)=>({...current,[name]:undefined,[measurementField(name)]:undefined})); };
  const measurementField=(name)=>name;
  const blurValidate=(name)=>{ const map={weight_kg:['weight_kg',form.weight_kg,'Weight must be greater than 0.'],measurement_cm:['measurement_cm',form.measurement_cm,'Height or length must be greater than 0.'],date_recorded:['date_recorded',form.date_recorded,'Enter a measurement date.']}; const item=map[name]; if(!item) return; if(item[1]!=='' && (name==='date_recorded'||Number(item[1])>0)) return; setErrors((current)=>({...current,[item[0]]:item[2]})); };
  const amountWarning = (field, value) => { const n=Number(value); if(!n) return null; if(field==='weight_kg'&&(n<1||n>80)) return 'Check measurement: weight is outside the typical child range.'; if(field==='measurement_cm'&&(n<35||n>150)) return 'Check measurement: height/length is outside the typical child range.'; return null; };
  const measurementMismatch = form.measurement_type && ageMonths !== null && ((ageMonths < 24 && form.measurement_type !== 'length') || (ageMonths >= 24 && form.measurement_type !== 'height'));

  const validate=()=>{ const next={}; if(!resident) next.resident_id='Select a child.'; if(!form.date_recorded) next.date_recorded='Select a measurement date.'; else if(form.date_recorded>getLocalDateInputValue()) next.date_recorded='The measurement date cannot be in the future.'; if(!form.weight_kg||Number(form.weight_kg)<=0) next.weight_kg='Enter a weight greater than 0 kg.'; if(!form.measurement_cm||Number(form.measurement_cm)<=0) next.measurement_cm='Enter a height or length greater than 0 cm.'; if(!form.measurement_type) next.measurement_type='Select a measurement type.'; if(ageMonths!==null&&ageMonths>=60) next.resident_id='This child is outside the Operation Timbang age range.'; setErrors(next); return next; };

  const publishToast=(message,link=true)=>{ setToast({message,link}); window.dispatchEvent(new CustomEvent('healthsync:notification',{detail:{title:'Operation Timbang',description:message}})); };
  const submit=async(addNext=false)=>{ const nextErrors=validate(); const first=Object.keys(nextErrors)[0]; if(first){ const fieldId=first==='resident_id'?'operation-timbang-resident':`operation-timbang-${first}`; window.setTimeout(()=>document.getElementById(fieldId)?.focus(),0); publishToast('Please correct the highlighted fields.'); return; } const sameDay=history.find((item)=>String(item.date_recorded).slice(0,10)===form.date_recorded); const sameMonth=history.find((item)=>String(item.date_recorded).slice(0,7)===form.date_recorded.slice(0,7)); if(sameDay||sameMonth){ setDuplicate(sameDay||sameMonth); setConfirmDuplicate(true); return; } await performSave(addNext); };
  const performSave=async(addNext)=>{ setSaving(true); try{ const response=await createOperationTimbang({resident_id:normalizeResidentId(form.resident_id),date_recorded:form.date_recorded,weight_kg:Number(form.weight_kg),measurement_cm:Number(form.measurement_cm),measurement_type:form.measurement_type}); if(!response?.success) throw new Error(response?.message||'Unable to save measurement.'); const data=response.data||{}; const worst=data.wfa_status||data.hfa_status||data.wflh_status||'Normal'; const offline=response.offline||response.queued; if(!offline) { setSavedResult(data); setPreview(data); publishToast(`Operation Timbang record saved successfully. Overall: ${worst}`); if(onSaved) onSaved(); } else publishToast('Record saved on this device. It will synchronize when the connection is restored.'); if(addNext){setForm((current)=>({...initialForm(),date_recorded:current.date_recorded,measurement_type:current.measurement_type}));setResident(null);setPreview(null);setSavedResult(null);setHistory([]);window.setTimeout(()=>pickerRef.current?.focus(),0);}else{setForm(initialForm());setResident(null);setPreview(null);setHistory([]);} }catch(error){const fieldErrors=error.response?.data?.errors;if(fieldErrors)setErrors(fieldErrors);console.error('Unable to save Operation Timbang record.', error);publishToast(getFriendlyError(error));}finally{setSaving(false);} };

  const displayed=preview||savedResult;
  const needsFollow=displayed&&[displayed.wfa_status,displayed.hfa_status,displayed.wflh_status].some((status)=>String(status||'').toLowerCase()!=='normal');
  const sameMonthText=duplicate?`Already measured on ${formatDateLabel(duplicate.date_recorded)} - save anyway?`:'';

  return <>
    <div className="nutrition-operation-layout">
      <div className="nutrition-operation-form">
        <section className="nutrition-form-card">
          <header><FormIcon>♙</FormIcon><div><h2>Child</h2><p>Search for the child being measured</p></div></header>
          {!resident ? <ResidentPicker inputId="operation-timbang-resident" value={form.resident_id} selectedResident={null} onBMI={()=>window.location.assign('/nutrition?tab=bmi-computation')} onSelect={(item)=>{setResident(item);setForm((c)=>({...c,resident_id:item?.resident_id||''}));if(item?.birthdate){const months=getAgeInMonths(item.birthdate,form.date_recorded);if(months!==null&&months>=60)setErrors((c)=>({...c,resident_id:'This resident is outside the Operation Timbang age range. Use BMI computation.'}));}}} /> : <ResidentSummaryCard resident={resident} ageMonths={ageMonths} onChange={()=>{setResident(null);setForm((c)=>({...c,resident_id:''}));window.setTimeout(()=>pickerRef.current?.focus(),0);}} />}
          {errors.resident_id&&<div className="nutrition-field-error"><span>!</span>{errors.resident_id}</div>}
        </section>
        {outOfRange&&<div className="nutrition-out-range">{outOfRange} <button type="button" className="nutrition-link-button" onClick={()=>window.location.assign('/nutrition?tab=bmi-computation')}>BMI computation</button></div>}
        <section className="nutrition-form-card">
          <header><FormIcon>⚖</FormIcon><div><h2>Measurement</h2><p>Enter the weighing and measurement details</p></div></header>
          <div className="nutrition-measurement-grid">
            <div className="nutrition-field"><label htmlFor="operation-timbang-date_recorded">Date recorded</label><input id="operation-timbang-date_recorded" name="date_recorded" type="date" max={getLocalDateInputValue()} value={form.date_recorded} onChange={handleChange} onBlur={()=>blurValidate('date_recorded')} aria-invalid={errors.date_recorded?'true':'false'} aria-describedby={errors.date_recorded?'date-recorded-error':undefined}/>{errors.date_recorded&&<div id="date-recorded-error" className="nutrition-field-error"><span>!</span>{errors.date_recorded}</div>}</div>
            <div className="nutrition-field"><label htmlFor="operation-timbang-age">Age at measurement</label><div className="nutrition-age-readonly"><input id="operation-timbang-age" value={ageMonths!==null?`${ageMonths} months`:''} readOnly/><small>Calculated from birthdate</small></div></div>
            <MeasurementInput id="operation-timbang-weight_kg" label="Weight" name="weight_kg" unit="kg" placeholder="e.g. 12.5" value={form.weight_kg} onChange={handleChange} onBlur={()=>blurValidate('weight_kg')} error={errors.weight_kg} step="0.1" min="0" max="80" />
            <MeasurementInput id="operation-timbang-measurement_cm" label="Height / length" name="measurement_cm" unit="cm" placeholder="e.g. 86.5" value={form.measurement_cm} onChange={handleChange} onBlur={()=>blurValidate('measurement_cm')} error={errors.measurement_cm} step="0.1" min="35" max="150" />
            <div className="nutrition-field"><label htmlFor="operation-timbang-type">Measurement type</label><select id="operation-timbang-type" name="measurement_type" value={form.measurement_type} onChange={handleChange} aria-invalid={errors.measurement_type?'true':'false'}><option value="" disabled>Select type</option><option value="length">Recumbent length</option><option value="height">Standing height</option></select>{errors.measurement_type&&<div className="nutrition-field-error"><span>!</span>{errors.measurement_type}</div>}</div>
          </div>
          {(amountWarning('weight_kg',form.weight_kg)||amountWarning('measurement_cm',form.measurement_cm))&&<div className="nutrition-plausibility-warning"><span aria-hidden="true">⚠</span>{amountWarning('weight_kg',form.weight_kg)||amountWarning('measurement_cm',form.measurement_cm)}</div>}
          {measurementMismatch&&<div className="nutrition-plausibility-warning"><span aria-hidden="true">⚠</span>{ageMonths<24?'Standing height is unusual under 24 months. Recumbent length is suggested.':'Recumbent length is unusual from 24 months. Standing height is suggested.'}</div>}
        </section>
      </div>
      <div className="nutrition-operation-side"><ResultPanel result={displayed} calculating={calculating}/><PreviousMeasurements items={history} loading={historyLoading}/><TrendChart items={history}/></div>
    </div>
    <div className="nutrition-mobile-summary"><button type="button" onClick={()=>setDetailsOpen(true)}><strong>Overall: {needsFollow?'Needs follow-up':'Normal'}</strong><span>Tap for details</span></button></div>
    {detailsOpen&&<div className="nutrition-bottom-sheet-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDetailsOpen(false);}}><div className="nutrition-bottom-sheet" role="dialog" aria-modal="true" aria-label="Assessment details"><button type="button" className="nutrition-sheet-close" onClick={()=>setDetailsOpen(false)}>Close</button><ResultPanel result={displayed} calculating={calculating}/></div></div>}
    <div className="nutrition-action-bar"><div className="nutrition-today-counter"><strong>{history.length}</strong><span>previous visits</span></div><div className="nutrition-action-buttons"><button type="button" className="nutrition-button nutrition-button--secondary" onClick={()=>{setForm(initialForm());setResident(null);setPreview(null);setSavedResult(null);setErrors({});}}>Discard</button><button type="button" className="nutrition-button nutrition-button--primary" disabled={saving||calculating||!complete||Object.keys(errors).length>0} onClick={()=>submit(false)}>{saving?'Saving…':'Save'}</button></div></div>
    {toast&&<div className="nutrition-toast" role="status"><span>{toast.message}</span>{toast.link&&<button type="button" onClick={()=>window.location.assign('/nutrition?tab=recent-records')}>View in recent records</button>}<button type="button" aria-label="Dismiss" onClick={()=>setToast(null)}>×</button></div>}
    <ConfirmModal open={confirmDuplicate} title="Duplicate measurement" message={sameMonthText} confirmLabel="Save anyway" busy={saving} onCancel={()=>setConfirmDuplicate(false)} onConfirm={async()=>{setConfirmDuplicate(false);await performSave(false);}}/>
  </>;
};

export default OperationTimbangFormRedesign;
