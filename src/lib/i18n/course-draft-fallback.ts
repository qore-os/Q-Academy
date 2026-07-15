import type { AppLocale } from "@/lib/i18n/model";

type CourseDraftFallbackCopy = {
  languageName: string;
  levels: Record<"beginner" | "intermediate" | "advanced" | "mixed", string>;
  tones: Record<"practical" | "professional" | "motivating" | "concise", string>;
  modules: ReadonlyArray<{
    title: string;
    description: string;
    lessons: readonly [string, string, string];
  }>;
  topicFocus: (topic: string) => string;
  sectionTitles: readonly [string, string];
  sectionDescription: (tone: string, audience: string) => string;
  lessonBody: (audience: string, topic: string, goal: string) => string;
  info: { title: string; text: string };
  checklist: { title: string; items: readonly [string, string, string] };
  learningPageTitle: string;
  assessmentPageTitle: string;
  assessments: {
    multipleChoice: {
      title: string;
      prompt: string;
      options: readonly [string, string, string];
      feedback: string;
    };
    trueFalse: { title: string; prompt: string; feedback: string };
    multiSelect: {
      title: string;
      prompt: string;
      options: readonly [string, string, string, string];
      feedback: string;
    };
    fillBlank: {
      title: string;
      prompt: string;
      acceptedAnswers: readonly [string, string];
      feedback: string;
    };
    ordering: {
      title: string;
      prompt: string;
      options: readonly [string, string, string, string];
      feedback: string;
    };
  };
  lessonSummary: (topic: string, audience: string) => string;
  courseTitle: (topic: string) => string;
  shortDescription: (audience: string, topic: string) => string;
  description: (audience: string, topic: string, goal: string) => string;
};

const de: CourseDraftFallbackCopy = {
  languageName: "Deutsch",
  levels: { beginner: "Grundlagen", intermediate: "Fortgeschritten", advanced: "Experte", mixed: "Gemischt" },
  tones: { practical: "praxisnah mit konkreten Arbeitsschritten", professional: "professionell, klar und sachlich", motivating: "aktivierend, ermutigend und zielorientiert", concise: "kompakt, direkt und ohne unnoetige Wiederholungen" },
  modules: [
    { title: "Orientierung und Grundlagen", description: "Schafft ein gemeinsames Verstaendnis und ordnet den Nutzen fuer den Arbeitsalltag ein.", lessons: ["Relevanz und Ausgangslage verstehen", "Zentrale Begriffe sicher einordnen", "Chancen und Grenzen realistisch bewerten"] },
    { title: "Methoden und Anwendung", description: "Uebersetzt das Thema in nachvollziehbare Methoden und konkrete Anwendungssituationen.", lessons: ["Ein tragfaehiges Vorgehen entwickeln", "An einem Praxisfall arbeiten", "Ergebnisse strukturiert verbessern"] },
    { title: "Qualitaet und Transfer", description: "Verankert Qualitaetskriterien und bereitet den nachhaltigen Transfer in eigene Aufgaben vor.", lessons: ["Qualitaet nachvollziehbar pruefen", "Risiken und Fehlerquellen vermeiden", "Den Transfer in den Alltag planen"] },
    { title: "Vertiefung und Umsetzung", description: "Fuehrt die Erkenntnisse zu einem belastbaren Umsetzungsplan mit messbaren naechsten Schritten zusammen.", lessons: ["Komplexe Situationen bearbeiten", "Zusammenarbeit und Standards gestalten", "Einen persoenlichen Aktionsplan erstellen"] },
  ],
  topicFocus: (topic) => `Der Fokus liegt auf ${topic}.`,
  sectionTitles: ["Gemeinsamer Einstieg", "Gefuehrte Umsetzung"],
  sectionDescription: (tone, audience) => `Die Lernschritte sind ${tone} fuer ${audience} aufgebaut.`,
  lessonBody: (audience, topic, goal) => `${audience} erarbeiten in dieser Lektion ${topic} anhand einer klaren Ausgangssituation. Das Lernziel bleibt dabei verbindlich: ${goal}`,
  info: { title: "Praxisfokus", text: "Uebertrage den Inhalt auf eine reale Aufgabe. Halte Annahmen, erwartete Wirkung und ein pruefbares Ergebnis fest, bevor du den naechsten Schritt gehst." },
  checklist: { title: "Naechste Schritte", items: ["Ausgangslage und Ziel in eigenen Worten festhalten", "Methode an einem konkreten Beispiel anwenden", "Ergebnis anhand eines klaren Kriteriums reflektieren"] },
  learningPageTitle: "Lernschritt und Anwendung",
  assessmentPageTitle: "Interaktiver Transfercheck",
  assessments: {
    multipleChoice: { title: "Transfer-Check", prompt: "Welcher Schritt sichert den nachhaltigen Transfer am besten?", options: ["Ein konkretes Ergebnis pruefen und den naechsten Schritt festlegen", "Nur die Begriffe auswendig wiederholen", "Ohne Ziel direkt mit der Umsetzung beginnen"], feedback: "Ein pruefbares Ergebnis und ein klarer naechster Schritt machen den Transfer wirksam." },
    trueFalse: { title: "Qualitaets-Check", prompt: "Eine Umsetzung ist bereits dann belastbar, wenn nur die Aktivitaet dokumentiert wurde.", feedback: "Belastbar wird die Umsetzung erst durch ein Ergebnis und ein nachvollziehbares Pruefkriterium." },
    multiSelect: { title: "Wirksame Transferbausteine", prompt: "Welche Bausteine gehoeren zu einem belastbaren Transfer in den Arbeitsalltag?", options: ["Ein konkretes Ziel festlegen", "Nur Fachbegriffe sammeln", "Ein messbares Ergebnis pruefen", "Ohne Verantwortlichkeit starten"], feedback: "Ein konkretes Ziel und ein messbares Ergebnis verbinden Lernen mit wirksamer Umsetzung." },
    fillBlank: { title: "Begriff sicher anwenden", prompt: "Ergaenze den Satz: Vor der Umsetzung wird ein klares ____ festgelegt, an dem das Ergebnis geprueft wird.", acceptedAnswers: ["Qualitaetskriterium", "Qualitaetsmerkmal"], feedback: "Ein Qualitaetskriterium macht das erwartete Ergebnis vor der Umsetzung pruefbar." },
    ordering: { title: "Transferprozess sortieren", prompt: "Bringe die Schritte fuer eine belastbare Umsetzung in die fachlich richtige Reihenfolge.", options: ["Ausgangslage klaeren", "Ziel und Qualitaetskriterium festlegen", "Methode am Praxisfall anwenden", "Ergebnis pruefen und naechsten Schritt planen"], feedback: "Der Ablauf fuehrt von der geklaerten Ausgangslage ueber Ziel und Anwendung zur Ergebnispruefung." },
  },
  lessonSummary: (topic, audience) => `Diese Lektion verbindet ${topic} mit einer konkreten Anwendung fuer ${audience}.`,
  courseTitle: (topic) => `${topic}: Vom Wissen zur Anwendung`,
  shortDescription: (audience, topic) => `${audience} entwickeln einen sicheren, praxisnahen Zugang zu ${topic}.`,
  description: (audience, topic, goal) => `Dieser Kurs fuehrt ${audience} strukturiert durch ${topic}. Er verbindet Orientierung, praktische Methoden, Qualitaetspruefung und Transfer. Das zentrale Lernziel lautet: ${goal}`,
};

const en: CourseDraftFallbackCopy = {
  languageName: "English",
  levels: { beginner: "Foundation", intermediate: "Intermediate", advanced: "Expert", mixed: "Mixed" },
  tones: { practical: "practical with concrete steps", professional: "professional, clear and factual", motivating: "engaging, encouraging and goal-oriented", concise: "concise, direct and without unnecessary repetition" },
  modules: [
    { title: "Orientation and foundations", description: "Builds shared understanding and connects the value to everyday work.", lessons: ["Understand relevance and the starting point", "Classify key concepts confidently", "Assess opportunities and limits realistically"] },
    { title: "Methods and application", description: "Turns the topic into clear methods and concrete application scenarios.", lessons: ["Develop a viable approach", "Work through a practical case", "Improve results systematically"] },
    { title: "Quality and transfer", description: "Establishes quality criteria and prepares sustainable transfer into real tasks.", lessons: ["Evaluate quality transparently", "Avoid risks and common errors", "Plan transfer into daily work"] },
    { title: "Deepening and implementation", description: "Combines the insights into a robust implementation plan with measurable next steps.", lessons: ["Handle complex situations", "Shape collaboration and standards", "Create a personal action plan"] },
  ],
  topicFocus: (topic) => `The focus is on ${topic}.`,
  sectionTitles: ["Shared introduction", "Guided implementation"],
  sectionDescription: (tone, audience) => `The learning steps are ${tone} for ${audience}.`,
  lessonBody: (audience, topic, goal) => `In this lesson, ${audience} explore ${topic} through a clear starting scenario. The learning goal remains binding: ${goal}`,
  info: { title: "Practical focus", text: "Apply the content to a real task. Record assumptions, the expected impact and a verifiable result before moving to the next step." },
  checklist: { title: "Next steps", items: ["State the starting point and goal in your own words", "Apply the method to a concrete example", "Review the result against a clear criterion"] },
  learningPageTitle: "Learning step and application",
  assessmentPageTitle: "Interactive transfer check",
  assessments: {
    multipleChoice: { title: "Transfer check", prompt: "Which step best secures sustainable transfer?", options: ["Verify a concrete result and define the next step", "Only memorize the terminology", "Start implementation immediately without a goal"], feedback: "A verifiable result and a clear next step make transfer effective." },
    trueFalse: { title: "Quality check", prompt: "An implementation is robust as soon as only the activity has been documented.", feedback: "Implementation becomes robust only through a result and a transparent evaluation criterion." },
    multiSelect: { title: "Effective transfer elements", prompt: "Which elements belong to a robust transfer into everyday work?", options: ["Set a concrete goal", "Only collect technical terms", "Verify a measurable result", "Start without ownership"], feedback: "A concrete goal and measurable result connect learning with effective implementation." },
    fillBlank: { title: "Apply the key term", prompt: "Complete the sentence: Before implementation, a clear ____ is defined against which the result is evaluated.", acceptedAnswers: ["quality criterion", "quality standard"], feedback: "A quality criterion makes the expected result verifiable before implementation." },
    ordering: { title: "Order the transfer process", prompt: "Put the steps for a robust implementation in the correct professional order.", options: ["Clarify the starting point", "Define the goal and quality criterion", "Apply the method to a practical case", "Evaluate the result and plan the next step"], feedback: "The sequence moves from a clarified starting point through goal and application to result evaluation." },
  },
  lessonSummary: (topic, audience) => `This lesson connects ${topic} with a concrete application for ${audience}.`,
  courseTitle: (topic) => `${topic}: From knowledge to application`,
  shortDescription: (audience, topic) => `${audience} develop a confident, practical approach to ${topic}.`,
  description: (audience, topic, goal) => `This course guides ${audience} through ${topic} in a structured way. It combines orientation, practical methods, quality review and transfer. The central learning goal is: ${goal}`,
};

const it: CourseDraftFallbackCopy = {
  languageName: "Italiano",
  levels: { beginner: "Fondamenti", intermediate: "Intermedio", advanced: "Esperto", mixed: "Misto" },
  tones: { practical: "pratico con passaggi concreti", professional: "professionale, chiaro e oggettivo", motivating: "coinvolgente, incoraggiante e orientato agli obiettivi", concise: "conciso, diretto e senza ripetizioni inutili" },
  modules: [
    { title: "Orientamento e fondamenti", description: "Crea una comprensione condivisa e collega il valore al lavoro quotidiano.", lessons: ["Comprendere rilevanza e situazione iniziale", "Inquadrare con sicurezza i concetti chiave", "Valutare realisticamente opportunita e limiti"] },
    { title: "Metodi e applicazione", description: "Traduce il tema in metodi chiari e situazioni applicative concrete.", lessons: ["Sviluppare un approccio sostenibile", "Lavorare su un caso pratico", "Migliorare i risultati in modo strutturato"] },
    { title: "Qualita e trasferimento", description: "Consolida i criteri di qualita e prepara il trasferimento duraturo nei compiti reali.", lessons: ["Valutare la qualita in modo trasparente", "Evitare rischi ed errori comuni", "Pianificare il trasferimento nel lavoro quotidiano"] },
    { title: "Approfondimento e attuazione", description: "Riunisce le conoscenze in un piano di attuazione solido con prossimi passi misurabili.", lessons: ["Gestire situazioni complesse", "Definire collaborazione e standard", "Creare un piano d'azione personale"] },
  ],
  topicFocus: (topic) => `L'attenzione e rivolta a ${topic}.`,
  sectionTitles: ["Introduzione comune", "Attuazione guidata"],
  sectionDescription: (tone, audience) => `I passaggi didattici sono ${tone} per ${audience}.`,
  lessonBody: (audience, topic, goal) => `In questa lezione, ${audience} esplora ${topic} a partire da una situazione chiara. L'obiettivo didattico resta vincolante: ${goal}`,
  info: { title: "Focus pratico", text: "Applica il contenuto a un compito reale. Registra ipotesi, impatto atteso e un risultato verificabile prima di passare alla fase successiva." },
  checklist: { title: "Prossimi passi", items: ["Descrivere con parole proprie la situazione iniziale e l'obiettivo", "Applicare il metodo a un esempio concreto", "Valutare il risultato rispetto a un criterio chiaro"] },
  learningPageTitle: "Passaggio didattico e applicazione",
  assessmentPageTitle: "Verifica interattiva del trasferimento",
  assessments: {
    multipleChoice: { title: "Verifica del trasferimento", prompt: "Quale passaggio garantisce meglio un trasferimento duraturo?", options: ["Verificare un risultato concreto e definire il passo successivo", "Memorizzare soltanto i termini", "Iniziare subito senza un obiettivo"], feedback: "Un risultato verificabile e un passo successivo chiaro rendono efficace il trasferimento." },
    trueFalse: { title: "Verifica della qualita", prompt: "Un'attuazione e solida non appena e stata documentata soltanto l'attivita.", feedback: "L'attuazione diventa solida solo con un risultato e un criterio di verifica trasparente." },
    multiSelect: { title: "Elementi efficaci di trasferimento", prompt: "Quali elementi appartengono a un trasferimento solido nel lavoro quotidiano?", options: ["Definire un obiettivo concreto", "Raccogliere soltanto termini tecnici", "Verificare un risultato misurabile", "Iniziare senza responsabilita"], feedback: "Un obiettivo concreto e un risultato misurabile collegano apprendimento e attuazione efficace." },
    fillBlank: { title: "Applicare il concetto chiave", prompt: "Completa la frase: Prima dell'attuazione viene definito un chiaro ____ con cui valutare il risultato.", acceptedAnswers: ["criterio di qualita", "standard di qualita"], feedback: "Un criterio di qualita rende verificabile il risultato atteso prima dell'attuazione." },
    ordering: { title: "Ordinare il processo di trasferimento", prompt: "Metti i passaggi per un'attuazione solida nel corretto ordine professionale.", options: ["Chiarire la situazione iniziale", "Definire obiettivo e criterio di qualita", "Applicare il metodo a un caso pratico", "Valutare il risultato e pianificare il passo successivo"], feedback: "La sequenza va dalla situazione iniziale chiarita all'obiettivo, all'applicazione e alla verifica del risultato." },
  },
  lessonSummary: (topic, audience) => `Questa lezione collega ${topic} a un'applicazione concreta per ${audience}.`,
  courseTitle: (topic) => `${topic}: Dalla conoscenza all'applicazione`,
  shortDescription: (audience, topic) => `${audience} sviluppa un approccio sicuro e pratico a ${topic}.`,
  description: (audience, topic, goal) => `Questo corso guida ${audience} attraverso ${topic} in modo strutturato. Unisce orientamento, metodi pratici, verifica della qualita e trasferimento. L'obiettivo didattico centrale e: ${goal}`,
};

const es: CourseDraftFallbackCopy = {
  languageName: "Espanol",
  levels: { beginner: "Fundamentos", intermediate: "Intermedio", advanced: "Experto", mixed: "Mixto" },
  tones: { practical: "practico y con pasos concretos", professional: "profesional, claro y objetivo", motivating: "activo, alentador y orientado a objetivos", concise: "conciso, directo y sin repeticiones innecesarias" },
  modules: [
    { title: "Orientacion y fundamentos", description: "Crea una comprension compartida y relaciona el valor con el trabajo diario.", lessons: ["Comprender la relevancia y el punto de partida", "Clasificar con seguridad los conceptos clave", "Evaluar de forma realista oportunidades y limites"] },
    { title: "Metodos y aplicacion", description: "Convierte el tema en metodos claros y situaciones de aplicacion concretas.", lessons: ["Desarrollar un enfoque viable", "Trabajar con un caso practico", "Mejorar los resultados de forma estructurada"] },
    { title: "Calidad y transferencia", description: "Consolida criterios de calidad y prepara una transferencia sostenible a tareas reales.", lessons: ["Evaluar la calidad de forma transparente", "Evitar riesgos y errores frecuentes", "Planificar la transferencia al trabajo diario"] },
    { title: "Profundizacion e implementacion", description: "Reune los conocimientos en un plan de implementacion solido con proximos pasos medibles.", lessons: ["Abordar situaciones complejas", "Definir colaboracion y estandares", "Crear un plan de accion personal"] },
  ],
  topicFocus: (topic) => `El foco esta en ${topic}.`,
  sectionTitles: ["Introduccion compartida", "Implementacion guiada"],
  sectionDescription: (tone, audience) => `Los pasos de aprendizaje son ${tone} para ${audience}.`,
  lessonBody: (audience, topic, goal) => `En esta leccion, ${audience} trabaja ${topic} a partir de una situacion inicial clara. El objetivo de aprendizaje sigue siendo vinculante: ${goal}`,
  info: { title: "Enfoque practico", text: "Aplica el contenido a una tarea real. Registra los supuestos, el impacto esperado y un resultado verificable antes de pasar al siguiente paso." },
  checklist: { title: "Proximos pasos", items: ["Expresar con palabras propias el punto de partida y el objetivo", "Aplicar el metodo a un ejemplo concreto", "Evaluar el resultado con un criterio claro"] },
  learningPageTitle: "Paso de aprendizaje y aplicacion",
  assessmentPageTitle: "Comprobacion interactiva de transferencia",
  assessments: {
    multipleChoice: { title: "Comprobacion de transferencia", prompt: "Que paso garantiza mejor una transferencia sostenible?", options: ["Verificar un resultado concreto y definir el siguiente paso", "Memorizar unicamente los terminos", "Empezar directamente sin un objetivo"], feedback: "Un resultado verificable y un siguiente paso claro hacen efectiva la transferencia." },
    trueFalse: { title: "Comprobacion de calidad", prompt: "Una implementacion ya es solida cuando solo se ha documentado la actividad.", feedback: "La implementacion solo es solida con un resultado y un criterio de evaluacion transparente." },
    multiSelect: { title: "Elementos eficaces de transferencia", prompt: "Que elementos forman parte de una transferencia solida al trabajo diario?", options: ["Definir un objetivo concreto", "Recopilar solo terminos tecnicos", "Verificar un resultado medible", "Empezar sin responsabilidad"], feedback: "Un objetivo concreto y un resultado medible conectan el aprendizaje con una implementacion eficaz." },
    fillBlank: { title: "Aplicar el concepto clave", prompt: "Completa la frase: Antes de la implementacion se define un ____ claro con el que se evalua el resultado.", acceptedAnswers: ["criterio de calidad", "estandar de calidad"], feedback: "Un criterio de calidad permite verificar el resultado esperado antes de la implementacion." },
    ordering: { title: "Ordenar el proceso de transferencia", prompt: "Ordena los pasos para una implementacion solida en la secuencia profesional correcta.", options: ["Aclarar el punto de partida", "Definir el objetivo y el criterio de calidad", "Aplicar el metodo a un caso practico", "Evaluar el resultado y planificar el siguiente paso"], feedback: "La secuencia va del punto de partida aclarado al objetivo, la aplicacion y la evaluacion del resultado." },
  },
  lessonSummary: (topic, audience) => `Esta leccion conecta ${topic} con una aplicacion concreta para ${audience}.`,
  courseTitle: (topic) => `${topic}: Del conocimiento a la aplicacion`,
  shortDescription: (audience, topic) => `${audience} desarrolla un enfoque seguro y practico de ${topic}.`,
  description: (audience, topic, goal) => `Este curso guia a ${audience} de forma estructurada por ${topic}. Combina orientacion, metodos practicos, evaluacion de calidad y transferencia. El objetivo central de aprendizaje es: ${goal}`,
};

const fr: CourseDraftFallbackCopy = {
  languageName: "Francais",
  levels: { beginner: "Fondamentaux", intermediate: "Intermediaire", advanced: "Expert", mixed: "Mixte" },
  tones: { practical: "pratique avec des etapes concretes", professional: "professionnel, clair et factuel", motivating: "dynamique, encourageant et oriente vers les objectifs", concise: "concis, direct et sans repetitions inutiles" },
  modules: [
    { title: "Orientation et fondamentaux", description: "Cree une comprehension commune et relie la valeur au travail quotidien.", lessons: ["Comprendre la pertinence et la situation initiale", "Classer les concepts cles avec assurance", "Evaluer les opportunites et les limites avec realisme"] },
    { title: "Methodes et application", description: "Traduit le sujet en methodes claires et en situations d'application concretes.", lessons: ["Developper une approche viable", "Travailler sur un cas pratique", "Ameliorer les resultats de maniere structuree"] },
    { title: "Qualite et transfert", description: "Ancre les criteres de qualite et prepare un transfert durable vers les taches reelles.", lessons: ["Evaluer la qualite de maniere transparente", "Eviter les risques et les erreurs frequentes", "Planifier le transfert dans le travail quotidien"] },
    { title: "Approfondissement et mise en oeuvre", description: "Reunit les acquis dans un plan de mise en oeuvre solide avec des prochaines etapes mesurables.", lessons: ["Traiter des situations complexes", "Definir la collaboration et les standards", "Creer un plan d'action personnel"] },
  ],
  topicFocus: (topic) => `L'accent est mis sur ${topic}.`,
  sectionTitles: ["Introduction commune", "Mise en oeuvre guidee"],
  sectionDescription: (tone, audience) => `Les etapes d'apprentissage sont ${tone} pour ${audience}.`,
  lessonBody: (audience, topic, goal) => `Dans cette lecon, ${audience} explore ${topic} a partir d'une situation initiale claire. L'objectif d'apprentissage reste contraignant : ${goal}`,
  info: { title: "Focus pratique", text: "Appliquez le contenu a une tache reelle. Notez les hypotheses, l'impact attendu et un resultat verifiable avant de passer a l'etape suivante." },
  checklist: { title: "Prochaines etapes", items: ["Formuler la situation initiale et l'objectif avec vos propres mots", "Appliquer la methode a un exemple concret", "Evaluer le resultat selon un critere clair"] },
  learningPageTitle: "Etape d'apprentissage et application",
  assessmentPageTitle: "Verification interactive du transfert",
  assessments: {
    multipleChoice: { title: "Verification du transfert", prompt: "Quelle etape garantit le mieux un transfert durable ?", options: ["Verifier un resultat concret et definir l'etape suivante", "Memoriser uniquement les termes", "Commencer directement sans objectif"], feedback: "Un resultat verifiable et une etape suivante claire rendent le transfert efficace." },
    trueFalse: { title: "Verification de la qualite", prompt: "Une mise en oeuvre est solide des que seule l'activite a ete documentee.", feedback: "La mise en oeuvre devient solide seulement grace a un resultat et a un critere d'evaluation transparent." },
    multiSelect: { title: "Elements efficaces du transfert", prompt: "Quels elements appartiennent a un transfert solide vers le travail quotidien ?", options: ["Definir un objectif concret", "Recueillir uniquement des termes techniques", "Verifier un resultat mesurable", "Commencer sans responsabilite"], feedback: "Un objectif concret et un resultat mesurable relient l'apprentissage a une mise en oeuvre efficace." },
    fillBlank: { title: "Appliquer le concept cle", prompt: "Completez la phrase : Avant la mise en oeuvre, un ____ clair est defini pour evaluer le resultat.", acceptedAnswers: ["critere de qualite", "standard de qualite"], feedback: "Un critere de qualite rend le resultat attendu verifiable avant la mise en oeuvre." },
    ordering: { title: "Ordonner le processus de transfert", prompt: "Placez les etapes d'une mise en oeuvre solide dans le bon ordre professionnel.", options: ["Clarifier la situation initiale", "Definir l'objectif et le critere de qualite", "Appliquer la methode a un cas pratique", "Evaluer le resultat et planifier l'etape suivante"], feedback: "La sequence va de la situation initiale clarifiee a l'objectif, a l'application puis a l'evaluation du resultat." },
  },
  lessonSummary: (topic, audience) => `Cette lecon relie ${topic} a une application concrete pour ${audience}.`,
  courseTitle: (topic) => `${topic} : De la connaissance a l'application`,
  shortDescription: (audience, topic) => `${audience} developpe une approche sure et pratique de ${topic}.`,
  description: (audience, topic, goal) => `Ce cours guide ${audience} de maniere structuree a travers ${topic}. Il combine orientation, methodes pratiques, evaluation de la qualite et transfert. L'objectif d'apprentissage central est : ${goal}`,
};

const COURSE_DRAFT_FALLBACK_COPY: Record<AppLocale, CourseDraftFallbackCopy> = {
  de,
  en,
  it,
  es,
  fr,
};

export function getCourseDraftFallbackCopy(locale: AppLocale) {
  return COURSE_DRAFT_FALLBACK_COPY[locale];
}
