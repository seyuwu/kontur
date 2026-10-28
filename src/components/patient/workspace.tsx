"use client";
import { visitLabel } from "@/lib/appointment";
import {useEffect,useState,type CSSProperties} from "react";
import Link from "next/link";
import {CalendarDays,ClipboardList,MessageSquare,LogOut,Link2,Check,RefreshCw,X} from "lucide-react";
import type {WorkspaceData} from "@/lib/types";
import {dateLabel} from "@/lib/format";
import {signOut} from "@/lib/client";
import {useWorkspace} from "@/components/ui/use-workspace";
import {Avatar,Badge,Button,EmptyState} from "@/components/ui/primitives";
import {Brand} from "@/components/ui/brand";
import {PushSettings} from "@/components/doctor/push-settings";
import {Conversation} from "@/components/communication/conversation";
import {PatientAssessments} from "@/components/assessments/patient-assessments";
import {PatientCarePlan} from "@/components/care/patient-care-plan";
import {Referrals} from "@/components/follow-up/referrals";
const sectionFrom=(value?:string|null)=>value==="messages"?"messages":"today";
export function PatientWorkspace({initialData,initialTab,initialAssignment}:{initialData:WorkspaceData;initialTab?:string;initialAssignment?:string}){
  const {data,refresh,connectionError,ready}=useWorkspace(initialData);const patient=data.patients[0];
  const [tab,setTab]=useState(sectionFrom(initialTab)),[messageDraft,setMessageDraft]=useState(""),[toast,setToast]=useState("");
  const [requestedAssignment,setRequestedAssignment]=useState(initialAssignment),[hasReferrals,setHasReferrals]=useState(false);
  function navigate(value:"today"|"messages"){if(tab===value)return;setTab(value);window.history.pushState({},"",value==="today"?"/patient":"/patient?tab=messages");requestAnimationFrame(()=>{window.scrollTo({top:0,behavior:"instant"});document.getElementById("patient-page-title")?.focus({preventScroll:true});});}
  useEffect(()=>{const pop=()=>setTab(sectionFrom(new URLSearchParams(window.location.search).get("tab")));window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop);},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),4200);return()=>clearTimeout(timer);},[toast]);
  const [chatViewport,setChatViewport]=useState<{height:number;bottom:number}>();
  useEffect(()=>{
    if(tab!=="messages"||!patient)return;
    const viewport=window.visualViewport;
    const update=()=>setChatViewport({height:viewport?.height??window.innerHeight,bottom:Math.max(0,window.innerHeight-(viewport?.height??window.innerHeight)-(viewport?.offsetTop??0))});
    update();window.addEventListener("resize",update);viewport?.addEventListener("resize",update);viewport?.addEventListener("scroll",update);
    return()=>{window.removeEventListener("resize",update);viewport?.removeEventListener("resize",update);viewport?.removeEventListener("scroll",update);};
  },[tab,patient?.id]);
  const unread=patient?.messages.filter(m=>m.senderId!==data.actor.id&&!m.readAt).length??0;
  return <div className={`patient-shell${patient&&tab==="messages"?" is-chat-open":""}`} style={tab==="messages"&&chatViewport?{"--chat-viewport-height":`${chatViewport.height}px`,"--chat-keyboard-inset":`${chatViewport.bottom}px`} as CSSProperties:undefined} inert={!ready}><header className="patient-topbar"><div className="patient-topbar-inner"><Brand compact/><nav className="patient-nav" aria-label="Кабинет пациента">
    <button className={tab==="today"?"is-active":""} aria-current={tab==="today"?"page":undefined} onClick={()=>navigate("today")}><ClipboardList size={16}/>Назначения</button>
    <button className={tab==="messages"?"is-active":""} aria-current={tab==="messages"?"page":undefined} onClick={()=>navigate("messages")}><MessageSquare size={16}/>Чат с врачом{unread>0&&<span className="tab-count">{unread}</span>}</button>
  </nav><div className="topbar-actions"><PushSettings audience="patient"/><Avatar name={data.actor.name} size="small"/><button className="icon-button" aria-label="Выйти из аккаунта" onClick={()=>void signOut().catch(e=>setToast(e.message))}><LogOut size={17}/></button></div></div></header>
  {connectionError&&<div className="connection-error" role="status"><RefreshCw size={16}/>Связь прервалась. Новые данные пока не загружены.<button className="text-link" onClick={()=>void refresh()}>Повторить</button></div>}
  <main id="main-content" className="patient-content">{!patient?<section className="surface"><EmptyState icon={<Link2 size={33}/>} title={data.pendingLink?"Врач проверяет подключение":"Подключитесь к своему врачу"} action={!data.pendingLink?<Link href="/connect" className="button button-primary">Ввести код приглашения</Link>:<Button variant="secondary" onClick={()=>void refresh()}>Проверить статус</Button>}>{data.pendingLink?<>{"После подтверждения здесь появятся ваши назначения."}{data.actor.email.endsWith("@accounts.kontur.invalid")&&<><br/>Проверочный номер: <strong>{data.actor.id.slice(-6).toUpperCase()}</strong>. Сообщите его врачу перед подтверждением.</>}</>:"Попросите врача показать QR-код или выдать приглашение."}</EmptyState></section>:<>
    <div className="patient-welcome"><div><h1 id="patient-page-title" tabIndex={-1}>{tab==="today"?"Ваши назначения":"Чат с врачом"}</h1><p>{tab==="today"?dateLabel(new Date().toISOString(),{weekday:"long",month:"long"}):patient.doctor.name}</p>{tab==="today"&&<Link href="/connect" className="text-link">Подключение к врачу</Link>}</div><Badge tone="green">{tab==="today"?patient.name:"Врач подключён"}</Badge></div>
    <div hidden={tab!=="today"}>
      {patient.nextVisit&&<div className="patient-appointment-strip"><CalendarDays size={18}/><span>Следующий приём <strong>{visitLabel(patient.nextVisit,patient.nextVisitHasTime)}</strong></span></div>}
      <section className="surface patient-assignments" aria-label="Назначения врача"><div className="surface-header"><div><h2>Сегодня и ближайшие дни</h2></div></div><div className="patient-assignments-body">
        <PatientCarePlan key={`care-${patient.id}`} patientId={patient.id} active={tab==="today"} embedded/>
        <PatientAssessments key={patient.id} patientId={patient.id} active={tab==="today"} embedded requestedAssignment={requestedAssignment} onRequestedHandled={()=>setRequestedAssignment(undefined)}/>
        <div hidden={!hasReferrals}><Referrals patientId={patient.id} patientName={patient.name} active={tab==="today"} onActiveChange={setHasReferrals}/></div>
      </div></section>
    </div>
    {tab==="messages"&&<Conversation key={patient.id} patient={patient} actorId={data.actor.id} refresh={refresh} onSuccess={setToast} draft={messageDraft} onDraftChange={setMessageDraft}/>}
  </>}</main>
  {toast&&<div className="toast" role="status"><Check size={16}/>{toast}<button className="icon-button" aria-label="Закрыть сообщение" onClick={()=>setToast("")}><X size={14}/></button></div>}
  </div>;
}
