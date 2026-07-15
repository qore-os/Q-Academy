# KI-Agenten-Policy, Credits und Insights

Die tenantweite Policy liegt versioniert unter dem Key `ai_agent_policy` in
`platform_settings`. Sie steuert:

- globale Freigabe der KI-Agenten,
- Credits pro UTC-Kalendermonat (`100` bis `1.000.000`),
- optionales Stundenlimit je Mitglied (`1` bis `500`).

Ein Credit entspricht einer vor dem Provider-Aufruf reservierten
Mitgliedernachricht. Eine reservierte Anfrage bleibt auch bei einem spaeteren
Providerfehler verbraucht. Die nicht persistierende Admin-Vorschau verwendet
keine Kundencredits.

## Durchsetzung

`sendAiConversationMessage` ist die zentrale Durchsetzungsstelle fuer Member-UI,
Lesson-/Hub-Einbettungen und REST-Chats. Die Reservierung nutzt
`auth_rate_limits` und zwei HMAC-pseudonymisierte Buckets:

- einen gemeinsam geteilten Monatsbucket je Tenant,
- bei aktivierter Option einen Stundenbucket je Tenant und Mitglied.

Alle aktiven Buckets werden in einer Datenbanktransaktion beansprucht. Wird ein
Limit ueberschritten, rollt die gesamte Reservierung zurueck und die Anfrage
endet vor dem Provider mit HTTP `429` und `Retry-After`. Eine deaktivierte Policy
endet mit HTTP `403`. Eine ungueltige gespeicherte Policy sperrt KI-Anfragen
fail-closed, kann aber von Ownern und Admins im Agent-Studio repariert werden.

## Transparenz vor externer Verarbeitung

Owner und Admins pflegen in den Plattform-Design-Einstellungen optionale,
serverseitig auf oeffentliche HTTPS-Ziele validierte Links zum kundeneigenen
Datenschutzhinweis und zu einer KI-Transparenzseite. Der Datenschutzhinweis
erscheint tenantgebunden in Login, MFA, Einladung und Passwort-Recovery.

Vor der ersten Q-Coach-Nutzung zeigen Hauptansicht, Concierge sowie eingebettete
Agenten denselben Hinweis. Aus Textfassung und aktuellen Tenant-Links wird ein
SHA-256-Digest gebildet. Die Bestaetigung leitet Tenant und User ausschliesslich
aus der aktiven Session ab und speichert Version, Digest, Link-Snapshots und
Zeitpunkt. Der Unique-Constraint und die Transaktion erzeugen auch bei
Wiederholungen nur einen Datensatz und ein
`ai.external_use.acknowledged`-Activity-Event.

`sendAiConversationMessage` prueft die aktuelle Bestaetigung nach der
Zugriffspruefung, aber vor Credit-Reservierung und Provider-Aufruf. Ohne sie
endet auch ein REST-Chat fail-closed mit HTTP `428 precondition_required`.
Aendert sich der Textstand oder ein Tenant-Link, wird ein neuer Digest und damit
eine erneute Bestaetigung erforderlich.

## Datenschutz

Die Usage-Ansicht aggregiert im ausgewaehlten Zeitraum nur:

- Konversationen,
- aktive Nutzende,
- Nachrichten,
- Input- und Output-Tokens.

Die Auswertung selektiert und liefert keine Prompts, Antworten, Zitate,
E-Mail-Adressen oder Mitglieder-/Konversations-IDs. Die Limiter-Tabelle speichert
nur HMAC-Werte, keine Tenant- oder Mitglieder-IDs im Klartext. Policy-Aenderungen
werden als `ai.agent_policy.updated` ohne Nachrichteninhalte auditiert.
