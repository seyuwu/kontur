/* Kontur Web Push v2. Only fixed workflow copy is shown outside the cabinet. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
const notificationTemplates = {
  ROUTINE: { title: "Контур · результат получен", body: "Проверьте результат и согласованный план наблюдения в кабинете врача." },
  REVIEW: { title: "Контур · результат для разбора", body: "Откройте исходные данные и рекомендации к разбору в кабинете врача." },
  HIGH: { title: "Контур · обратите внимание", body: "Проверьте новое событие и предложенные действия в кабинете врача." },
  SAFETY: { title: "Контур · проверьте событие", body: "Откройте основание события и рекомендации к контакту в кабинете врача." }
};
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let input; try { input = event.data?.json(); } catch { input = null; }
    const valid = input && ["kontur-test", "kontur-event", "kontur-contact", "kontur-assigned", "kontur-completed", "kontur-medication", "kontur-medication-upcoming", "kontur-assessment-reminder", "kontur-plan", "kontur-appointment", "kontur-appointment-cancelled", "kontur-appointment-reminder"].includes(input.type) && typeof input.deliveryId === "string" && /^[a-z0-9]{1,100}$/i.test(input.deliveryId);
    const test = valid && input.type === "kontur-test";
    const contact = valid && input.type === "kontur-contact";
    const assigned = valid && input.type === "kontur-assigned";
    const completed = valid && input.type === "kontur-completed";
    const appointmentDate = valid && ["kontur-appointment","kontur-appointment-reminder"].includes(input.type) && typeof input.appointmentAt === "string" && Number.isFinite(new Date(input.appointmentAt).getTime()) ? new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",...(input.appointmentHasTime===true?{hour:"2-digit",minute:"2-digit"}:{}),timeZone:"Europe/Moscow"}).format(new Date(input.appointmentAt)) : "";
    const reminderCopy = valid && input.type === "kontur-appointment-cancelled" ? {title:"Контур · приём отменён",body:"Врач отменил запланированный приём. Уточните новую дату в приложении."} : appointmentDate ? {title:input.type === "kontur-appointment-reminder" ? "Контур · скоро приём" : "Контур · назначен приём",body:`Ваш приём — ${appointmentDate}${input.appointmentHasTime===true?" (МСК)":""}. Подробности в приложении.`} : valid && input.type === "kontur-medication-upcoming" ? {title:"Контур · скоро начало приёма",body:"Через два дня начинается приём лекарства по назначению врача. Проверьте препарат, дозу и время в приложении."} : valid && input.type === "kontur-medication" ? {title:"Контур · время приёма лекарства",body:"Проверьте назначение врача на сегодня и отметьте приём в приложении."} : valid && input.type === "kontur-assessment-reminder" ? {title:"Контур · анкета ожидает заполнения",body:"У вас осталась незаполненная анкета. Откройте назначения и проверьте срок."} : valid && input.type === "kontur-plan" ? {title:"Контур · назначения обновлены",body:"Врач обновил ваши назначения. Откройте приложение: все задачи и сроки собраны на главной."} : null;
    const deadline = assigned && typeof input.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) && Number.isFinite(new Date(input.dueDate).getTime()) ? new Intl.DateTimeFormat("ru-RU", {day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(input.dueDate)) : "";
    const copy = valid && typeof input.kind === "string" && Object.prototype.hasOwnProperty.call(notificationTemplates, input.kind) ? notificationTemplates[input.kind] : null;
    const url = safeUrl(valid ? input.url : "/doctor");
    await self.registration.showNotification(reminderCopy?.title ?? (test ? "Контур · проверка уведомлений" : assigned ? "Контур · новая анкета от врача" : contact ? "Контур · просьба связаться" : copy?.title ?? (completed ? "Контур · анкета заполнена" : "Контур · новое событие")), {
      body: reminderCopy?.body ?? (test ? "Уведомления на этом устройстве работают." : assigned ? `Врач назначил анкету.${deadline ? ` Заполните до ${deadline} включительно.` : " Откройте кабинет пациента для заполнения."}` : contact ? "Пациент просит связаться. Откройте карточку в кабинете врача." : copy?.body ?? "Откройте результат и рекомендации в кабинете врача."),
      icon: "/icons/icon-192.png", badge: "/icons/badge.png",
      tag: valid ? `kontur:${input.deliveryId}` : "kontur", renotify: false,
      data: { url }
    });
    if (valid) {
      try { await fetch("/api/push", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shown", deliveryId: input.deliveryId }) }); } catch { /* display is independent of this optional receipt */ }
    }
  })());
});
function safeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || !["/doctor", "/patient"].includes(url.pathname)) return "/doctor";
    const clean = new URL(url.pathname, self.location.origin);
    for (const key of url.pathname === "/patient" ? ["assignment"] : ["patient", "event"]) { const v = url.searchParams.get(key); if (v && /^[a-z0-9-]{1,100}$/i.test(v)) clean.searchParams.set(key, v); }
    return clean.pathname + clean.search;
  } catch { return "/doctor"; }
}
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const path = safeUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(path); await existing.focus(); }
    else await self.clients.openWindow(path);
  })());
});
