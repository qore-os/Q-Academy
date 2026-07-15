import type { AppLocale } from "@/lib/i18n/model";

type NotificationCopy = {
  center: {
    title: string;
    close: string;
    updateFailed: string;
    invalid: string;
    notFound: string;
    unread: (count: number) => string;
    trigger: (count: number) => string;
    allCurrent: string;
    markAllRead: string;
    unreadItem: string;
    markRead: (title: string) => string;
    markReadTitle: string;
    remove: (title: string) => string;
    removeTitle: string;
    emptyTitle: string;
    emptyBody: string;
  };
  push: {
    channelName: string;
    channelDescription: string;
    enabled: string;
    enableFailed: string;
    disabled: string;
    disableFailed: string;
    blocked: string;
    blockedTitle: string;
    toggle: (active: boolean) => string;
    toggleTitle: (active: boolean) => string;
    label: string;
  };
};

const copies: Record<AppLocale, NotificationCopy> = {
  de: {
    center: {
      title: "Benachrichtigungen",
      close: "Benachrichtigungen schliessen",
      updateFailed: "Die Benachrichtigung konnte nicht aktualisiert werden.",
      invalid: "Ungueltige Benachrichtigung.",
      notFound: "Benachrichtigung nicht gefunden.",
      unread: (count) => `${count} ungelesen`,
      trigger: (count) => `Benachrichtigungen${count ? `, ${count} ungelesen` : ""}`,
      allCurrent: "Alles auf dem neuesten Stand",
      markAllRead: "Alle gelesen",
      unreadItem: "Ungelesen",
      markRead: (title) => `${title} als gelesen markieren`,
      markReadTitle: "Als gelesen markieren",
      remove: (title) => `${title} loeschen`,
      removeTitle: "Loeschen",
      emptyTitle: "Keine Benachrichtigungen",
      emptyBody: "Neue Aktivitaeten erscheinen hier.",
    },
    push: {
      channelName: "Academy-Updates",
      channelDescription: "Kurs-, Event- und Community-Benachrichtigungen",
      enabled: "Push-Benachrichtigungen sind aktiv.",
      enableFailed: "Push-Benachrichtigungen konnten nicht aktiviert werden.",
      disabled: "Push-Benachrichtigungen sind deaktiviert.",
      disableFailed: "Push-Benachrichtigungen konnten nicht deaktiviert werden.",
      blocked: "Push-Benachrichtigungen sind im Browser blockiert",
      blockedTitle: "Push ist im Browser blockiert",
      toggle: (active) => `Push-Benachrichtigungen ${active ? "deaktivieren" : "aktivieren"}`,
      toggleTitle: (active) => `Push ${active ? "deaktivieren" : "aktivieren"}`,
      label: "Push",
    },
  },
  en: {
    center: {
      title: "Notifications",
      close: "Close notifications",
      updateFailed: "The notification could not be updated.",
      invalid: "Invalid notification.",
      notFound: "Notification not found.",
      unread: (count) => `${count} unread`,
      trigger: (count) => `Notifications${count ? `, ${count} unread` : ""}`,
      allCurrent: "You are all caught up",
      markAllRead: "Mark all read",
      unreadItem: "Unread",
      markRead: (title) => `Mark ${title} as read`,
      markReadTitle: "Mark as read",
      remove: (title) => `Delete ${title}`,
      removeTitle: "Delete",
      emptyTitle: "No notifications",
      emptyBody: "New activity will appear here.",
    },
    push: {
      channelName: "Academy updates",
      channelDescription: "Course, event and community notifications",
      enabled: "Push notifications are enabled.",
      enableFailed: "Push notifications could not be enabled.",
      disabled: "Push notifications are disabled.",
      disableFailed: "Push notifications could not be disabled.",
      blocked: "Push notifications are blocked in the browser",
      blockedTitle: "Push is blocked in the browser",
      toggle: (active) => `${active ? "Disable" : "Enable"} push notifications`,
      toggleTitle: (active) => `${active ? "Disable" : "Enable"} push`,
      label: "Push",
    },
  },
  it: {
    center: {
      title: "Notifiche",
      close: "Chiudi notifiche",
      updateFailed: "Non e stato possibile aggiornare la notifica.",
      invalid: "Notifica non valida.",
      notFound: "Notifica non trovata.",
      unread: (count) => `${count} non lette`,
      trigger: (count) => `Notifiche${count ? `, ${count} non lette` : ""}`,
      allCurrent: "Tutto aggiornato",
      markAllRead: "Segna tutte come lette",
      unreadItem: "Non letta",
      markRead: (title) => `Segna ${title} come letta`,
      markReadTitle: "Segna come letta",
      remove: (title) => `Elimina ${title}`,
      removeTitle: "Elimina",
      emptyTitle: "Nessuna notifica",
      emptyBody: "Le nuove attivita appariranno qui.",
    },
    push: {
      channelName: "Aggiornamenti Academy",
      channelDescription: "Notifiche su corsi, eventi e community",
      enabled: "Le notifiche push sono attive.",
      enableFailed: "Non e stato possibile attivare le notifiche push.",
      disabled: "Le notifiche push sono disattivate.",
      disableFailed: "Non e stato possibile disattivare le notifiche push.",
      blocked: "Le notifiche push sono bloccate nel browser",
      blockedTitle: "Le notifiche push sono bloccate nel browser",
      toggle: (active) => `${active ? "Disattiva" : "Attiva"} notifiche push`,
      toggleTitle: (active) => `${active ? "Disattiva" : "Attiva"} push`,
      label: "Push",
    },
  },
  es: {
    center: {
      title: "Notificaciones",
      close: "Cerrar notificaciones",
      updateFailed: "No se pudo actualizar la notificacion.",
      invalid: "Notificacion no valida.",
      notFound: "No se encontro la notificacion.",
      unread: (count) => `${count} sin leer`,
      trigger: (count) => `Notificaciones${count ? `, ${count} sin leer` : ""}`,
      allCurrent: "Todo esta al dia",
      markAllRead: "Marcar todas como leidas",
      unreadItem: "Sin leer",
      markRead: (title) => `Marcar ${title} como leida`,
      markReadTitle: "Marcar como leida",
      remove: (title) => `Eliminar ${title}`,
      removeTitle: "Eliminar",
      emptyTitle: "Sin notificaciones",
      emptyBody: "La nueva actividad aparecera aqui.",
    },
    push: {
      channelName: "Novedades de Academy",
      channelDescription: "Notificaciones de cursos, eventos y comunidad",
      enabled: "Las notificaciones push estan activadas.",
      enableFailed: "No se pudieron activar las notificaciones push.",
      disabled: "Las notificaciones push estan desactivadas.",
      disableFailed: "No se pudieron desactivar las notificaciones push.",
      blocked: "Las notificaciones push estan bloqueadas en el navegador",
      blockedTitle: "Las notificaciones push estan bloqueadas en el navegador",
      toggle: (active) => `${active ? "Desactivar" : "Activar"} notificaciones push`,
      toggleTitle: (active) => `${active ? "Desactivar" : "Activar"} push`,
      label: "Push",
    },
  },
  fr: {
    center: {
      title: "Notifications",
      close: "Fermer les notifications",
      updateFailed: "La notification n'a pas pu etre mise a jour.",
      invalid: "Notification non valide.",
      notFound: "Notification introuvable.",
      unread: (count) => `${count} non lues`,
      trigger: (count) => `Notifications${count ? `, ${count} non lues` : ""}`,
      allCurrent: "Tout est a jour",
      markAllRead: "Tout marquer comme lu",
      unreadItem: "Non lue",
      markRead: (title) => `Marquer ${title} comme lue`,
      markReadTitle: "Marquer comme lue",
      remove: (title) => `Supprimer ${title}`,
      removeTitle: "Supprimer",
      emptyTitle: "Aucune notification",
      emptyBody: "Les nouvelles activites apparaitront ici.",
    },
    push: {
      channelName: "Actualites Academy",
      channelDescription: "Notifications de cours, d'evenements et de communaute",
      enabled: "Les notifications push sont activees.",
      enableFailed: "Les notifications push n'ont pas pu etre activees.",
      disabled: "Les notifications push sont desactivees.",
      disableFailed: "Les notifications push n'ont pas pu etre desactivees.",
      blocked: "Les notifications push sont bloquees dans le navigateur",
      blockedTitle: "Les notifications push sont bloquees dans le navigateur",
      toggle: (active) => `${active ? "Desactiver" : "Activer"} les notifications push`,
      toggleTitle: (active) => `${active ? "Desactiver" : "Activer"} le push`,
      label: "Push",
    },
  },
};

export function getNotificationCopy(locale: AppLocale) {
  return copies[locale];
}
