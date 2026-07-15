import type { HubLayout } from "@/db/schema";

export const HUB_TEMPLATE_KEYS = [
  "blank",
  "learning_center",
  "onboarding",
  "community",
] as const;

export type HubTemplateKey = (typeof HUB_TEMPLATE_KEYS)[number];

export function createHubTemplateLayout(
  template: HubTemplateKey,
  createId: () => string,
): HubLayout {
  if (template === "blank") return [];

  if (template === "onboarding") {
    return [
      {
        id: createId(),
        category: "Dein Einstieg",
        columns: [
          {
            type: "text",
            title: "Willkommen, {{member.firstName}}",
            description:
              "Hier findest du deine ersten Schritte und persoenlichen Lerninhalte.",
            color: "#2b9188",
          },
          {
            type: "link",
            title: "Deine Kurse",
            description: "Starte mit deinem naechsten freigeschalteten Kurs.",
            href: "/academy/courses",
            color: "#4f7cac",
          },
          {
            type: "contact",
            title: "Profil vervollstaendigen",
            description: "Pruefe deine Angaben und Sicherheitseinstellungen.",
            href: "/academy/profile",
            color: "#b84e42",
          },
        ],
      },
    ];
  }

  if (template === "community") {
    return [
      {
        id: createId(),
        category: "Austausch & Termine",
        columns: [
          {
            type: "link",
            title: "Community",
            description: "Diskutiere, frage nach und teile Erfahrungen.",
            href: "/academy/community",
            color: "#2b9188",
          },
          {
            type: "event",
            title: "Naechste Termine",
            description: "Alle Live-Sessions und Zusagen im Ueberblick.",
            href: "/academy/events",
            color: "#b84e42",
          },
          {
            type: "contact",
            title: "Lernprofil",
            description: "Verwalte deine Profile und Kontoeinstellungen.",
            href: "/academy/profile",
            color: "#4f7cac",
          },
        ],
      },
    ];
  }

  return [
    {
      id: createId(),
      category: "Weiterlernen",
      columns: [
        {
          type: "stat",
          title: "{{course.progress}}% abgeschlossen",
          description: "Fortschritt in {{course.title}}",
          color: "#2b9188",
        },
        {
          type: "link",
          title: "Weiterlernen",
          description: "Setze {{course.title}} an deinem letzten Stand fort.",
          href: "/academy/courses",
          color: "#4f7cac",
        },
        {
          type: "event",
          title: "Lerntermine",
          description: "Behalte Live-Sessions und Fristen im Blick.",
          href: "/academy/events",
          color: "#b84e42",
        },
      ],
    },
    {
      id: createId(),
      category: "Mehr entdecken",
      columns: [
        {
          type: "link",
          title: "Austausch",
          description: "Fragen und Erkenntnisse mit der Community teilen.",
          href: "/academy/community",
          color: "#2b9188",
        },
        {
          type: "link",
          title: "Zertifikate",
          description: "Abschluesse und Nachweise anzeigen.",
          href: "/academy/certificates",
          color: "#4f7cac",
        },
      ],
    },
  ];
}
