import {z} from "zod";
export const medicationTime=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const medicationRegimenSchema=z.strictObject({everyDays:z.number().int().min(0).max(365),timesPerDay:z.number().int().min(1).max(12),timeMode:z.enum(["PATIENT","FIXED"]),times:z.array(medicationTime).max(12)}).superRefine((r,c)=>{if(r.timeMode==="FIXED"&&(r.times.length!==r.timesPerDay||new Set(r.times).size!==r.times.length))c.addIssue({code:"custom",message:"Укажите отдельное время для каждого приёма."});if(r.timeMode==="PATIENT"&&r.times.length)c.addIssue({code:"custom",message:"В свободном расписании время выбирает пациент."});});
export type MedicationRegimen=z.infer<typeof medicationRegimenSchema>;
export function regimenLabel(r:MedicationRegimen){const n=r.timesPerDay;return `${r.everyDays===0?"В день начала":r.everyDays===1?"Ежедневно":`Каждые ${r.everyDays} дн.`} · ${n} ${n===1?"приём":n>=2&&n<=4?"приёма":"приёмов"}`;}
const dayNumber=(s:string)=>Math.floor(new Date(`${s}T12:00:00Z`).getTime()/86400000);
export function medicationActiveDay(start:string,everyDays:number,date:string){const diff=dayNumber(date)-dayNumber(start);return diff>=0&&(everyDays===0?diff===0:diff%everyDays===0);}
export function nextMedicationDay(start:string,everyDays:number,today:string){const diff=dayNumber(today)-dayNumber(start);if(diff<=0)return start;if(everyDays===0)return null;const day=dayNumber(start)+Math.ceil(diff/everyDays)*everyDays;return new Date(day*86400000).toISOString().slice(0,10);}
export function medicationTimes(r:MedicationRegimen,chosen?:string[]){const times=r.timeMode==="FIXED"?r.times:chosen??[];return times.length===r.timesPerDay&&new Set(times).size===times.length&&times.every(t=>medicationTime.safeParse(t).success)?[...times].sort():[];}
