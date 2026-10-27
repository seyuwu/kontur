import { LoginForm } from "@/components/auth/login-form";
export const dynamic = "force-dynamic";
export default function LoginPage() { return <LoginForm demoPassword={process.env.DEMO_MODE === "true" ? process.env.DEMO_PASSWORD : undefined} />; }
