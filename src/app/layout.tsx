import type { Metadata, Viewport } from "next";
import "@fontsource/manrope/cyrillic-400.css";
import "@fontsource/manrope/cyrillic-500.css";
import "@fontsource/manrope/cyrillic-600.css";
import "@fontsource/manrope/cyrillic-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#2d604b" };
export const metadata: Metadata = { icons: { apple: "/icons/apple-touch-icon.png" }, appleWebApp: { capable: true, title: "Контур", statusBarStyle: "default" }, title: "Контур — сопровождение пациента", description: "Рабочее пространство врача и пациента. Демонстрационный контур на синтетических данных.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><a className="skip-link" href="#main-content">Перейти к содержимому</a>{children}</body></html>;
}
