"use client";
import {PatientMedication} from "./patient-medication";
import {useEffect,useRef,useState} from "react";
import {Pill,ClipboardCheck} from "lucide-react";
import type {CareWorkspace} from "@/lib/care";
import type {DailyJournal} from "@/lib/follow-up";
import {apiCommand} from "@/lib/client";
import {dateLabel} from "@/lib/format";
import {moscowDate} from "@/lib/assessment-deadline";
import {patientTaskSchedule} from "@/lib/patient-tasks";
import {Badge,Button,Drawer} from "@/components/ui/primitives";
import {useCareResource} from "@/components/assessments/use-care-resource";
export function PatientCarePlan({patientId,active,embedded=false}:{patientId:string;active:boolean;embedded?:boolean;onAssignment?:(id:string)=>void}){
  const resource=useCareResource<CareWorkspace>(`/api/care?patientId=${encodeURIComponent(patientId)}`,active);
  const plan=resource.data?.current;
  const daily=useCareResource<DailyJournal>(`/api/follow-up?patientId=${patientId}&view=daily&planVersionId=${plan?.id??""}`,active&&!!plan?.tasks.some(t=>t.repeat&&!t.medication?.regimen));
  const [now,setNow]=useState(()=>new Date());useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);
  const [selected,setSelected]=useState<{id:string;planId:string;date:string;revision:number}>();
  const [state,setState]=useState<"DONE"|"NOT_DONE"|"PARTIAL"|"UNSURE">("DONE"),[note,setNote]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");const key=useRef<string|null>(null);
  const task=plan?.tasks.find(t=>t.id===selected?.id);
  useEffect(()=>{if(!active)setSelected(undefined);},[active]);
  const todayReport=(id:string)=>daily.data?.tasks.find(t=>t.id===id)?.days.find(d=>d.date===moscowDate(now))?.report;
  const tasks=(plan?.tasks??[]).filter(task=>!task.medication?.regimen).map(task=>({task,schedule:patientTaskSchedule(task,plan!.confirmedAt,todayReport(task.id)?.state==="DONE",now)})).filter(row=>row.schedule).sort((a,b)=>a.schedule!.date.localeCompare(b.schedule!.date)||(a.task.time??"").localeCompare(b.task.time??""));
  async function save(){
    if(!selected||!task||!plan||busy)return;setBusy(true);setError("");key.current??=crypto.randomUUID();
    try{
      if(task.repeat)await apiCommand("/api/follow-up",{action:"daily-report",patientId,planVersionId:selected.planId,taskId:task.id,date:selected.date,revision:selected.revision,state,note,needsContact:false,requestKey:key.current});
      else await apiCommand("/api/care",{action:"report",patientId,planVersionId:selected.planId,taskId:task.id,revision:selected.revision,state,note,requestKey:key.current});
      setSelected(undefined);setNotice("Отметка сохранена.");await Promise.all([resource.refresh(),...(task.repeat?[daily.refresh()]:[])]);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(!plan&&!resource.error)return null;
  return <section className={embedded?"patient-treatment":"surface assessment-section"} hidden={!active} aria-label="Лечение и задачи">
    <h2 className="patient-task-section-title">Лечение и задачи</h2>
    {resource.error&&<p className="form-error" role="alert">{resource.error}<Button variant="quiet" onClick={()=>void resource.refresh()}>Повторить</Button></p>}
    {daily.error&&<p className="form-error" role="alert">{daily.error}<Button variant="quiet" onClick={()=>void daily.refresh()}>Повторить</Button></p>}
    {notice&&<p className="form-success" role="status">{notice}</p>}
    <div className="patient-questionnaire-grid">{plan?.tasks.filter(task=>!!task.medication?.regimen).map(task=><PatientMedication key={task.id} task={task} patientId={patientId} planId={plan.id} now={now} refresh={resource.refresh}/>)}{tasks.map(({task,schedule})=><button type="button" className={`patient-questionnaire-card${schedule!.upcoming?" is-upcoming":""}`} key={task.id} onClick={()=>{setSelected({id:task.id,planId:plan!.id,date:schedule!.upcoming?schedule!.date:moscowDate(now),revision:task.repeat?todayReport(task.id)?.revision??0:task.report?.revision??0});setState("DONE");setNote("");setError("");key.current=null;}}>
      <span className="patient-questionnaire-heading"><span className="patient-questionnaire-icon">{task.kind==="MEDICATION"?<Pill size={21}/>:<ClipboardCheck size={21}/>}</span><Badge tone={schedule!.upcoming?"neutral":"green"}>{schedule!.label}{task.time?` · ${task.time}`:""}</Badge></span>
      <strong className="patient-questionnaire-title">{task.medication?.name??task.title}</strong>{task.medication&&<span className="patient-dose">{task.medication.dose}</span>}
      <span className="patient-questionnaire-meta">{task.repeat?"Ежедневно":"Однократно"}{task.time?" · время Москвы":""}</span>
      {task.details&&<span className="care-prose patient-task-details">{task.details}</span>}
      <span className="patient-questionnaire-footer"><span>{dateLabel(schedule!.date)}{task.repeat&&task.dueDate?` · до ${dateLabel(task.dueDate)}`:""}</span><span className="patient-questionnaire-action">{schedule!.canReport?(task.kind==="MEDICATION"?"Отметить приём":"Отметить выполнение"):"Посмотреть"}</span></span>
    </button>)}</div>
    {plan&&<details className="patient-plan-note"><summary>Памятка врача</summary><h3>{plan.goal}</h3><p className="care-prose">{plan.instructions}</p><p className="secondary-text small-text">{plan.confirmedBy} · {dateLabel(plan.confirmedAt)}</p></details>}
    <Drawer open={active&&!!task&&!!selected} title={task?.medication?.name??task?.title??"Назначение врача"} dismissDisabled={busy} onClose={()=>setSelected(undefined)}>
      {task&&selected&&plan&&<><p className="patient-dose">{task.medication?.dose}</p><p>{task.startDate?`С ${dateLabel(task.startDate)}`:""}{task.time?` · ${task.time} (Москва)`:""}{task.repeat?" · ежедневно":""}{task.dueDate?` · до ${dateLabel(task.dueDate)}`:""}</p><p className="care-prose">{task.details}</p>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {patientTaskSchedule(task,plan.confirmedAt,false,now)?.canReport&&selected.planId===plan.id&&selected.date===moscowDate(now)?<form onSubmit={e=>{e.preventDefault();void save();}}>
        <label className="field"><span>{task.kind==="MEDICATION"?"Как прошёл приём?":"Выполнение"}</span><select value={state} disabled={busy} onChange={e=>{setState(e.target.value as typeof state);key.current=null;}}><option value="DONE">{task.kind==="MEDICATION"?"Принял(а)":"Выполнено"}</option><option value="NOT_DONE">{task.kind==="MEDICATION"?"Не принял(а)":"Не выполнено"}</option>{task.repeat&&<><option value="PARTIAL">Частично</option><option value="UNSURE">Не помню</option></>}</select></label>
        <label className="field"><span>Комментарий · необязательно</span><textarea value={note} maxLength={2000} rows={3} disabled={busy} onChange={e=>{setNote(e.target.value);key.current=null;}}/></label><div className="form-footer"><Button type="submit" busy={busy}>Сохранить отметку</Button></div>
      </form>:<p className="hint">Запланировано на {dateLabel(selected.date)}. Отметка будет доступна в этот день.</p>}</>}
    </Drawer>
  </section>;
}
