export async function command<T = { saved: boolean }>(data: object): Promise<T> {
  return apiCommand<T>("/api/workspace", data);
}
export async function apiCommand<T = { saved: boolean }>(endpoint: "/api/workspace" | "/api/assessments" | "/api/review-events" | "/api/care" | "/api/clinical-profile" | "/api/follow-up" | "/api/documents" | "/api/push" | "/api/summaries", data: object): Promise<T> {
  let response: Response;
  try { response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); }
  catch { throw new Error("Нет связи с сервером. Введённые данные остаются здесь. Проверьте подключение и повторите отправку."); }
  if (response.status === 401) throw new Error("Сессия завершилась. Войдите в аккаунт снова.");
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Сервер временно недоступен. Данные остаются в форме; повторите отправку позже."); }
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить. Попробуйте ещё раз.");
  return result as T;
}
export async function signOut() {
  const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("Не удалось выйти из аккаунта. Повторите попытку.");
  // The server session has already been revoked. Browser cleanup is best-effort.
  if ("serviceWorker" in navigator) await Promise.race([
    navigator.serviceWorker.getRegistration("/").then(async reg => {
      if (!reg) return; (await reg.getNotifications()).forEach(n => n.close());
      await (await reg.pushManager.getSubscription())?.unsubscribe();
    }).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))
  ]);
  window.location.assign("/login");
}
