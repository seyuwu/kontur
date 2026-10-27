export type PushSettingsData = { enabled: boolean; publicKey: string; workerReady?: boolean; devices: { id: string; endpointHash: string; label: string; currentSession: boolean; sessionActive: boolean; keyCurrent: boolean; lastDelivery: { status: string; at: string; test: boolean } | null }[] };
export const pushLabels: Record<string, string> = {
  PENDING: "Ожидает отправки", SENDING: "Передаётся push-сервису", ACCEPTED: "Push-сервис принял уведомление",
  SHOWN: "Браузер сообщил о показе", FAILED: "Не удалось передать", UNCERTAIN: "Результат передачи неизвестен", CANCELLED: "Отправка отменена"
};
export function pushSupportIssue(capabilities: { secure: boolean; notifications: boolean; serviceWorker: boolean; pushManager: boolean; ios: boolean; standalone: boolean }) {
  if (!capabilities.secure) return "Уведомления недоступны по этому HTTP-адресу. На этом ПК откройте http://localhost:3000 в Chrome или Edge. Для другого компьютера или телефона нужен HTTPS с доверенным сертификатом.";
  if (capabilities.ios && !capabilities.standalone) return "На iPhone или iPad добавьте сайт на экран «Домой» через меню «Поделиться», затем откройте с новой иконки. Нужны iOS/iPadOS 16.4 или новее.";
  if (!capabilities.notifications || !capabilities.serviceWorker || !capabilities.pushManager) return "В этом браузере отсутствует API уведомлений, Service Worker или PushManager. Откройте этот же адрес в обычном окне Chrome, Edge или Firefox, вне встроенного просмотра приложения и приватного режима.";
  return "";
}
