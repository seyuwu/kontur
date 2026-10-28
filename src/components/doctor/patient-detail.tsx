"use client";
import { AppointmentCard } from "./appointment-card";
import { PrescriptionWorkspace } from "./prescription-workspace";
import { LlmSummary } from "@/components/assessments/llm-summary";
import { Concerns } from "@/components/follow-up/concerns";
import { Referrals, type ReferralCache } from "@/components/follow-up/referrals";
import { useState, type ReactNode } from "react";
import { HistoryPanel } from "@/components/monitoring/history-panel";
import { DoctorAssessments } from "@/components/assessments/doctor-assessments";
import { DoctorCarePlan, type CareEditorDraft } from "@/components/care/doctor-care-plan";
import type { DocumentDraft } from "@/components/clinical-profile/source-import";
import { ClinicalProfileSection, type ProfileDraft } from "@/components/clinical-profile/clinical-profile";
import { ArrowLeft, Check, Link2, CircleHelp } from "lucide-react";
import type { PatientData, PatientTab, ObservationData } from "@/lib/types";
import { dateLabel, age, yearsLabel } from "@/lib/format";
import { Avatar, Badge, Button, TextLink } from "@/components/ui/primitives";
import { Conversation } from "@/components/communication/conversation";
const tabs: { id: PatientTab; label: string }[] = [{ id: "overview", label: "Обзор" }, { id: "data", label: "Данные" }, { id: "dynamics", label: "Динамика" }, { id: "messages", label: "Общение" }];
export function PatientDetail({ patient, tab, actorId, onTab, onBack, onInvite, onNote, onSource, onAcknowledge, refresh, onSuccess, messageDraft, onMessageDraft, reviewPanel, careDraft, onCareDraft, profileDraft, onProfileDraft, referralCache, onReferralCache, documentDraft, onDocumentDraft }: {
  patient: PatientData; tab: PatientTab; actorId: string; onTab: (tab: PatientTab) => void; onBack: () => void; onInvite: () => void; onNote: () => void; reviewPanel?: ReactNode;
  onSource: (observation: ObservationData) => void; onAcknowledge: (id: string) => void; refresh: () => Promise<void>; onSuccess: (message: string) => void; messageDraft: string; onMessageDraft: (text: string) => void;
  careDraft?: CareEditorDraft; onCareDraft: (value: CareEditorDraft | undefined) => void;
  documentDraft?: DocumentDraft; onDocumentDraft: (v: DocumentDraft | undefined) => void;
  referralCache?: ReferralCache; onReferralCache: (value: ReferralCache) => void;
  profileDraft?: ProfileDraft; onProfileDraft: (value: ProfileDraft | undefined) => void;
}) {
  const [prescriptionView, setPrescriptionView] = useState<"questionnaires" | "treatment">("questionnaires");
  const [requestedProfile, setRequestedProfile] = useState<{ patientId: string; id: string }>();
  const openRequests = patient.contactRequests ?? patient.observations.filter(o => o.needsContact && !o.acknowledgedAt);
  const unread = patient.messages.filter(m => m.senderId !== actorId && !m.readAt).length;
  function tabKeys(event: React.KeyboardEvent, index: number) {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length]; onTab(next.id); document.getElementById(`tab-${next.id}`)?.focus();
  }
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={14} />К списку пациентов</button>
    <div className="patient-header"><div className="patient-heading"><Avatar name={patient.name} size="large" /><div><h1>{patient.name}</h1><div className="patient-meta"><span>{yearsLabel(age(patient.birthDate))}</span><span className="dot-separator" /><span>{patient.publicId}</span></div></div></div><div className="page-actions"><Button onClick={onInvite}><Link2 size={15} />{patient.userId ? "Выдать код входа" : "Подключить пациента"}</Button></div></div>
    {openRequests.slice(0, 1).map(observation => <div className="attention-strip" key={observation.id}><CircleHelp size={20} /><div className="attention-strip-content"><strong>Пациент просит связаться</strong><p>{observation.note || "Откройте общение, чтобы согласовать связь."}</p>{openRequests.length > 1 && <span className="small-text">Всего просьб: {patient.contactRequestCount ?? openRequests.length}</span>}</div><div className="attention-strip-actions"><button className="icon-button" aria-label="Отметить просьбу как просмотренную" onClick={() => onAcknowledge(observation.id)}><Check size={17} /></button></div></div>)}
    <div className="tab-list" role="tablist" aria-label="Разделы карточки">{tabs.map((item, index) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={`tab-button ${tab === item.id ? "is-active" : ""}`} onClick={() => onTab(item.id)} onKeyDown={e => tabKeys(e, index)}>{item.label}{item.id === "messages" && unread > 0 && <span className="tab-count">{unread}</span>}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "overview" && <div className="assessment-workspace-layout">
        <div className="overview-main-flow">
          <PrescriptionWorkspace view={prescriptionView} onView={setPrescriptionView} questionnaires={<DoctorAssessments key={`assignments-${patient.id}`} patientId={patient.id} embedded />} treatment={<DoctorCarePlan key={`care-${patient.id}`} patientId={patient.id} patientName={patient.name} active embedded cached={careDraft} onCache={onCareDraft} onPublished={refresh} onProfileVersion={id => { setRequestedProfile({ patientId: patient.id, id }); onTab("data"); }} sourceVersion={`${patient.clinicalDataVersion}:${patient.currentPlanId}:${patient.nextVisit}`} />} />
          {reviewPanel}
          <LlmSummary key={`summary-${patient.id}`} patientId={patient.id} sourceVersion={patient.clinicalDataVersion} />
        </div>
        <aside className="overview-side" aria-label="Заметка и наблюдение">
          <section className="overview-context"><AppointmentCard key={patient.id} patient={patient} onSaved={refresh} /><div className="overview-context-row"><p className="overview-connection"><Link2 size={15} />{patient.userId ? "Пациент подключён" : "Пациент не подключён"}</p></div></section>
          <section className="surface overview-note" aria-label="Заметка врача"><div className="surface-header"><h2>Заметка врача</h2></div><div className="surface-body">{patient.note && <p className="care-prose">{patient.note}</p>}<Button variant="quiet" onClick={onNote}>{patient.note ? "Редактировать заметку" : "Добавить запись"}</Button></div></section>
          <Referrals key={`referral-${patient.id}`} patientId={patient.id} patientName={patient.name} active doctor compactAction cache={referralCache} onCache={onReferralCache} />
        </aside>
      </div>}
      <div hidden={tab !== "data"}>
        <ClinicalProfileSection documentDraft={documentDraft} onDocumentDraft={onDocumentDraft} key={`profile-${patient.id}`} patientId={patient.id} patientName={patient.name} active={tab === "data"} compact={false} draft={profileDraft} onDraft={onProfileDraft} onSaved={refresh} requestedVersion={requestedProfile?.patientId === patient.id ? requestedProfile.id : undefined} onRequestHandled={() => setRequestedProfile(undefined)} />
        {tab === "data" && <details className="surface integration-downloads"><summary>Экспорт для интеграций</summary><p className="secondary-text small-text">Текущие сведения, план и страница результатов анкет. Контракт версии 1.0; полная история и переписка не включены.</p><div className="care-actions"><a className="button button-secondary" href={`/api/integrations/v1/export?patientId=${encodeURIComponent(patient.id)}&format=json`}>Скачать JSON</a><a className="button button-secondary" href={`/api/integrations/v1/export?patientId=${encodeURIComponent(patient.id)}&format=csv`}>Скачать CSV</a></div></details>}
        {tab === "data" && <section className="surface"><div className="surface-header"><h2>Сведения о пациенте</h2><Badge>Введены врачом</Badge></div><dl className="data-grid"><div className="data-field"><dt>Имя и фамилия</dt><dd>{patient.name}</dd></div><div className="data-field"><dt>Дата рождения</dt><dd>{dateLabel(patient.birthDate, { year: "numeric" })}</dd></div><div className="data-field"><dt>Номер карты</dt><dd>{patient.publicId}</dd></div><div className="data-field"><dt>Ведущий врач</dt><dd>{patient.doctor.name}</dd></div></dl></section>}
      </div>
      {tab === "dynamics" && <div className="detail-main"><Concerns key={`concerns-${patient.id}`} patientId={patient.id} active doctor onConversation={() => onTab("messages")} /><HistoryPanel key={patient.id} patientId={patient.id} onObservation={onSource} /></div>}
      {tab === "messages" && <Conversation key={patient.id} patient={patient} actorId={actorId} refresh={refresh} onSuccess={onSuccess} draft={messageDraft} onDraftChange={onMessageDraft} />}
    </div>
  </>;
}
