import { RegisterForm } from "@/components/auth/register-form";
export default async function RegisterPage({searchParams}:{searchParams:Promise<{role?:string}>}) {
 const {role}=await searchParams;
 const doctorRegistrationAllowed=process.env.DEMO_MODE==="true";
 return <RegisterForm doctorRegistrationAllowed={doctorRegistrationAllowed} initialRole={doctorRegistrationAllowed&&role==="doctor"?"DOCTOR":"PATIENT"}/>;
}
