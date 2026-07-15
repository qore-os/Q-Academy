import type { AppLocale } from "@/lib/i18n/model";
import {
  getCommunityUiCopy,
  type CommunityUiCopy,
} from "@/lib/i18n/community";
import {
  getCourseBuilderCopy,
  type CourseBuilderCopy,
} from "@/lib/i18n/course-builder";

type PageHeaderCopy = {
  eyebrow: string;
  title: string;
  description: string;
};

type MemberTableCopy = {
  management: string;
  invite: string;
  importMembers: string;
  closeDialog: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  departmentPlaceholder: string;
  openInviteLink: string;
  cancel: string;
  creating: string;
  createInvitation: string;
  csvFile: string;
  chooseCsv: string;
  fileSelected: string;
  noFileSelected: string;
  csvTemplate: string;
  total: string;
  invited: string;
  skipped: string;
  errors: string;
  row: string;
  notice: string;
  close: string;
  importing: string;
  importCsv: string;
  search: (count: number) => string;
  roleFilter: string;
  allRoles: string;
  statusFilter: string;
  allStatuses: string;
  active: string;
  disabled: string;
  export: string;
  import: string;
  member: string;
  area: string;
  role: string;
  access: string;
  average: string;
  lastLogin: string;
  status: string;
  action: string;
  courses: string;
  groups: string;
  never: string;
  currentAccess: string;
  protected: string;
  enable: string;
  disable: string;
  noResults: string;
  entries: (visible: number, total: number) => string;
  page: string;
  exported: (count: number) => string;
  exportFailed: string;
  statusFailed: string;
};

type MainPageBaseDictionary = {
  academy: {
    dashboard: {
      eyebrow: string;
      welcome: (firstName: string) => string;
      activeSummary: (count: number) => string;
      readySummary: string;
      emptySummary: string;
      myCourses: string;
      aiTools: string;
      lastLearned: string;
      completed: string;
      inProgress: string;
      continueLearning: string;
      noCourse: string;
      noCourseDescription: string;
      activeCourses: string;
      communityPoints: string;
      completedCourses: string;
      pathEyebrow: string;
      currentCourses: string;
      allCourses: string;
      progress: (value: number) => string;
      new: string;
      start: string;
      continue: string;
      emptyCourses: string;
      emptyCoursesDescription: string;
      communityEyebrow: string;
      communityTitle: string;
      feed: string;
      noPosts: string;
      noPostsDescription: string;
      community: string;
      events: string;
      upcoming: string;
      noEvents: string;
      noEventsDescription: string;
      eventPlan: string;
    };
    community: {
      eyebrow: string;
      title: string;
      description: string;
      members: string;
      posts: string;
      answers: string;
      ranking: string;
      noPoints: string;
      points: (count: number) => string;
      level: string;
      nextLevel: (count: number, name: string) => string;
      highestLevel: string;
      levelUnavailable: string;
      composerPlaceholder: string;
      composerUnavailable: string;
      newPost: string;
      closeDialog: string;
      announcementTitle: string;
      discussionTitle: string;
      contentPlaceholder: string;
      publishing: string;
      publish: string;
      mentionMember: string;
    };
    certificates: {
      eyebrow: string;
      title: string;
      description: string;
      validCount: string;
      revoked: string;
      valid: string;
      completedOn: (date: string) => string;
      view: string;
      emptyTitle: string;
      emptyDescription: string;
      courses: string;
    };
    coach: { eyebrow: string; available: string };
  };
  admin: {
    dashboard: {
      newThisMonth: (count: number) => string;
      liveCourses: (count: number) => string;
      submissionsToday: (count: number) => string;
      runningEnrollments: string;
      learningActivity: string;
      lastFourteenDays: string;
      current: string;
      quickActions: string;
      frequentTasks: string;
      createContent: string;
      createContentDescription: string;
      reviewSubmissions: string;
      waitingAnswers: (count: number) => string;
      configureAgent: string;
      agentDescription: string;
      recentSubmissions: string;
      recentSubmissionsDescription: string;
      showAll: string;
      noSubmissions: string;
      noSubmissionsDescription: string;
      tasks: string;
      coursePerformance: string;
      averageProgress: string;
      learners: (count: number) => string;
      noCourseData: string;
      noCourseDataDescription: string;
      manageCourses: string;
    };
    headers: {
      courses: PageHeaderCopy;
      members: PageHeaderCopy;
      modules: PageHeaderCopy;
      tasks: PageHeaderCopy;
      events: PageHeaderCopy;
      community: PageHeaderCopy;
      settings: PageHeaderCopy;
    };
    modules: {
      count: (count: number) => string;
      folders: (count: number) => string;
      examModule: string;
      learningModule: string;
      courseCount: (count: number) => string;
      examCount: string;
      lessonCount: (count: number) => string;
      edited: (date: string) => string;
      editInCourse: string;
      assignToCourse: string;
      emptyTitle: string;
      emptyDescription: string;
      createFirst: string;
    };
    community: {
      posts: string;
      activeMembers: string;
      answers: string;
      openReports: string;
    };
    members: MemberTableCopy;
  };
};

type AnalyticsMemberCopy = {
  enrollmentStatus: Record<"not_started" | "in_progress" | "completed", string>;
  courseStatus: Record<"draft" | "published" | "archived", string>;
  memberStatus: Record<"active" | "invited" | "disabled", string>;
  noMeasurement: string;
  closeDialog: string;
  administrativeAction: string;
  resetProgress: string;
  resetSummary: (member: string, course: string) => string;
  lessonStates: (count: number) => string;
  quizAttempts: (count: number) => string;
  submissions: (count: number) => string;
  sharedModuleWarning: string;
  deleteSubmissions: string;
  deleteSubmissionsHelp: string;
  revokeCertificate: string;
  revokeCertificateHelp: (number: string) => string;
  memberConfirmation: string;
  courseConfirmation: string;
  cancel: string;
  resetting: string;
  noCourseAssignment: string;
  accessRevoked: string;
  lastAccess: (date: string) => string;
  activeLearningTime: (value: string) => string;
  progress: string;
  resetFor: (member: string, course: string) => string;
  reset: string;
  readOnly: string;
  title: string;
  description: string;
  search: string;
  searchPlaceholder: string;
  courseFilter: string;
  allCourses: string;
  progressFilter: string;
  allProgress: string;
  noAssignment: string;
  columns: Record<
    | "member"
    | "courses"
    | "average"
    | "lastActivity"
    | "lastLesson"
    | "activeLearningTime"
    | "details",
    string
  >;
  assignedSummary: (assigned: number, completed: number) => string;
  average: string;
  noLesson: string;
  showDetails: string;
  hideDetails: string;
  courseDetailsFor: (member: string, action: string) => string;
  estimatedCompleted: (value: string) => string;
  coursesInProgress: (count: number) => string;
  assignedCompact: (assigned: number, completed: number) => string;
  lastMeasuredActivity: string;
  noMatchingMembers: string;
  noMatchingMembersDescription: string;
  entries: (visible: number, total: number) => string;
  resetAccess: string;
  trainerReadAccess: string;
};

type AdminAnalyticsCopy = {
  title: string;
  eyebrow: string;
  description: string;
  exportReport: string;
  activeAssignments: string;
  activeInProgress: (count: number) => string;
  averageProgress: string;
  acrossActiveAssignments: string;
  completions: string;
  lastThirtyDays: string;
  activeLearningTime: string;
  measuredLastFourteenDays: string;
  activityLog: string;
  activityLogDescription: string;
  progress: string;
  overallProgress: string;
  overallProgressDescription: string;
  liveCoursePerformance: string;
  liveCoursePerformanceDescription: string;
  courseMetrics: (learners: number, completions: number, progress: number) => string;
  activeTime: (value: string) => string;
  noLiveCourses: string;
  activeLearnersByDay: string;
  noActivityData: string;
  activeLearners: string;
  members: AnalyticsMemberCopy;
};

type RichTextCopy = {
  formatText: string;
  blockFormat: string;
  paragraph: string;
  headingTwo: string;
  headingThree: string;
  bold: string;
  italic: string;
  bulletList: string;
  numberedList: string;
  editLink: string;
  removeLink: string;
  undo: string;
  redo: string;
  linkUrl: string;
  applyLink: string;
  unsafeLink: string;
  selectLinkText: string;
  contentLabel: string;
  contentPlaceholder: string;
  plainText: string;
  formatted: string;
  communityContentLabel: string;
};

export type MainPageDictionary = Omit<
  MainPageBaseDictionary,
  "academy" | "admin"
> & {
  academy: MainPageBaseDictionary["academy"] & {
    communityUi: CommunityUiCopy;
    communityProfile: {
      title: string;
      back: string;
      eyebrow: string;
      notProvided: string;
      jobNotProvided: string;
      departmentNotProvided: string;
      points: (count: number) => string;
      pointsNotProvided: string;
      profileInformation: string;
      noPublicInformation: string;
    };
    courseDetail: {
      learningPath: string;
      modules: (count: number) => string;
      certificate: string;
      startCourse: string;
      continueCourse: string;
      courseContent: string;
      modulesAndLessons: string;
      requiredLessons: (completed: number, total: number) => string;
      linkedCourse: string;
      openCourse: string;
      locked: string;
      examModule: string;
      examCount: string;
      lessons: (count: number) => string;
      readOnly: string;
      comingSoon: string;
      submission: string;
      exam: string;
      knowledgeCheck: string;
      lesson: string;
      minutes: (count: number) => string;
      yourProgress: string;
      allRequiredComplete: string;
      requiredRemaining: (count: number) => string;
      courseCertificate: string;
      certificateIssued: string;
      certificatePending: string;
      viewCertificate: string;
      coachTitle: string;
      coachDescription: string;
      safeLearning: string;
      safeLearningDescription: string;
      availableAt: (date: string) => string;
      previousModule: string;
      previousLesson: string;
      accessLocked: string;
      notReleased: string;
      goalsAndInstructors: string;
      whatYouLearn: string;
      instructors: string;
      courseAuthor: string;
      learnMore: string;
      courseInformation: string;
      aboutCourse: string;
      feedbackTitle: string;
      feedbackPrompt: string;
      rating: string;
      stars: (value: number) => string;
      feedbackPlaceholder: string;
      feedbackError: string;
      feedbackSuccess: string;
      testimonialConsent: string;
      sending: string;
      sendFeedback: string;
      accessRequested: string;
      withdrawRequest: string;
      requestAccess: string;
      message: string;
      requestMessagePlaceholder: string;
      sendRequest: string;
      disableLessonNotification: string;
      enableLessonNotification: string;
      doNotNotify: string;
      notify: string;
    };
    lessonReader: {
      backToCourse: string;
      minutes: (count: number) => string;
      completed: string;
      readOnly: string;
      exam: string;
      inProgress: string;
      courseContent: string;
      examModule: string;
      courseNavigation: string;
      previous: string;
      next: string;
      courseOverview: string;
    };
  };
  admin: MainPageBaseDictionary["admin"] & {
    analytics: AdminAnalyticsCopy;
    memberDetail: {
      backToMembers: string;
      back: string;
      eyebrow: string;
      status: Record<"active" | "invited" | "disabled", string>;
      noPosition: string;
      since: (date: string) => string;
      courses: string;
      groups: string;
      points: string;
      learningProgress: string;
      dataProfiles: {
        createTitle: string;
        closeDialog: string;
        close: string;
        template: string;
        profileName: string;
        profileNamePlaceholder: string;
        cancel: string;
        create: string;
        title: string;
        setActive: string;
        archive: string;
        newProfile: string;
        navigation: string;
      };
    };
    courseEditor: CourseBuilderCopy;
  };
  editor: { richText: RichTextCopy };
};

const de: MainPageBaseDictionary = {
  academy: {
    dashboard: {
      eyebrow: "Dein Lern-Dashboard", welcome: (name) => `Willkommen zurueck, ${name}.`, activeSummary: (count) => `${count} ${count === 1 ? "Lernpfad ist" : "Lernpfade sind"} gerade aktiv. Setze dort fort, wo du zuletzt aufgehoert hast.`, readySummary: "Deine Lernpfade sind bereit. Starte mit dem Kurs, der gerade am besten zu deinem Ziel passt.", emptySummary: "Sobald dir ein Lernpfad freigeschaltet wurde, findest du ihn hier.", myCourses: "Meine Kurse", aiTools: "AI Tool Center", lastLearned: "Zuletzt gelernt", completed: "Abgeschlossen", inProgress: "In Bearbeitung", continueLearning: "Weiterlernen", noCourse: "Noch kein Kurs zugewiesen", noCourseDescription: "Sobald dein Team einen Lernpfad freigibt, erscheint er an dieser Stelle.", activeCourses: "Aktive Kurse", communityPoints: "Community-Punkte", completedCourses: "Abgeschlossene Kurse", pathEyebrow: "Dein Lernpfad", currentCourses: "Aktuelle Kurse", allCourses: "Alle Kurse", progress: (value) => `${value}% Fortschritt`, new: "Neu", start: "Starten", continue: "Fortsetzen", emptyCourses: "Dein Kursbereich ist noch leer", emptyCoursesDescription: "Freigeschaltete Lernpfade werden hier automatisch angezeigt.", communityEyebrow: "Aus der Community", communityTitle: "Was andere gerade lernen", feed: "Zum Feed", noPosts: "Noch keine Community-Beitraege", noPostsDescription: "Im Community-Bereich erscheinen Fragen, Erfahrungen und neue Diskussionen.", community: "Zur Community", events: "Event-Plan", upcoming: "Demnaechst", noEvents: "Keine Termine geplant", noEventsDescription: "Neue Live-Sessions und Fristen werden hier angekuendigt.", eventPlan: "Zum Event-Plan",
    },
    community: { eyebrow: "Gemeinsam besser lernen", title: "Q-Community", description: "Teile Praxisbeispiele, verbessere Prompts und lerne von den Erfahrungen anderer.", members: "Mitglieder", posts: "Beitraege", answers: "Antworten", ranking: "Community-Ranking", noPoints: "Noch keine Punkte gesammelt.", points: (count) => `${count} Punkte`, level: "Community-Level", nextLevel: (count, name) => `Noch ${count} Punkte bis ${name}.`, highestLevel: "Du hast das hoechste Community-Level erreicht.", levelUnavailable: "Das Community-Level ist derzeit nicht verfuegbar.", composerPlaceholder: "Teile eine Frage, Idee oder Erkenntnis...", composerUnavailable: "Noch kein Community-Bereich eingerichtet", newPost: "Neuer Beitrag", closeDialog: "Dialog schliessen", announcementTitle: "Titel der Ankuendigung", discussionTitle: "Titel der Diskussion", contentPlaceholder: "Was moechtest du mit der Community teilen?", publishing: "Wird veroeffentlicht", publish: "Veroeffentlichen", mentionMember: "Mitglied erwaehnen" },
    certificates: { eyebrow: "Lernerfolge", title: "Meine Zertifikate", description: "Deine Nachweise fuer vollstaendig abgeschlossene Kurse.", validCount: "Gueltige Nachweise", revoked: "Widerrufen", valid: "Gueltig", completedOn: (date) => `Abschluss am ${date}`, view: "Zertifikat ansehen", emptyTitle: "Noch keine Zertifikate", emptyDescription: "Sobald du einen Kurs mit aktivierter Zertifizierung vollstaendig abschliesst, erscheint der Nachweis hier.", courses: "Zu meinen Kursen" },
    coach: { eyebrow: "KI-Lernbegleiter", available: "Verfuegbar" },
  },
  admin: {
    dashboard: { newThisMonth: (count) => `${count} in diesem Monat`, liveCourses: (count) => `${count} davon live`, submissionsToday: (count) => `${count} heute eingegangen`, runningEnrollments: "Laufende Einschreibungen", learningActivity: "Lernaktivitaet", lastFourteenDays: "Interaktionen der letzten 14 Tage", current: "Aktuell", quickActions: "Schnellaktionen", frequentTasks: "Haeufige Aufgaben", createContent: "Lerninhalt erstellen", createContentDescription: "Kurs, Modul oder Lektion", reviewSubmissions: "Abgaben pruefen", waitingAnswers: (count) => `${count} Antworten warten`, configureAgent: "KI-Agent konfigurieren", agentDescription: "Q-Coach und Prompt Reviewer", recentSubmissions: "Aktuelle Abgaben", recentSubmissionsDescription: "Zuletzt eingereichte Antworten", showAll: "Alle anzeigen", noSubmissions: "Noch keine Abgaben", noSubmissionsDescription: "Eingereichte Aufgaben und Pruefantworten werden hier zur Bearbeitung gesammelt.", tasks: "Zum Aufgaben-Center", coursePerformance: "Kurs-Performance", averageProgress: "Durchschnittlicher Lernfortschritt", learners: (count) => `${count} Lernende`, noCourseData: "Noch keine Kursdaten", noCourseDataDescription: "Sobald ein Kurs veroeffentlicht ist, erscheint sein Lernfortschritt in dieser Auswertung.", manageCourses: "Kurse verwalten" },
    headers: {
      courses: { eyebrow: "Inhalts-Management", title: "Kurse", description: "Strukturiere deine Lernangebote, Kategorien und Veroeffentlichungen." },
      members: { eyebrow: "Mitglieder-Management", title: "Mitglieder", description: "Verwalte Zugaenge, Gruppen und den Lernfortschritt deiner Academy." },
      modules: { eyebrow: "Inhalts-Management", title: "Wiederverwendbare Module", description: "Ein Modul kann synchron in mehreren Kursen verwendet werden." },
      tasks: { eyebrow: "Trainer-Workflow", title: "Aufgaben-Center", description: "Bearbeite Pruefungen, Abgaben und Rueckmeldungen deiner freigegebenen Kurse." },
      events: { eyebrow: "Live Learning", title: "Event-Plan", description: "Plane Calls, Workshops und Deadlines fuer deine Zielgruppen." },
      community: { eyebrow: "Social Learning", title: "Community", description: "Behalte Aktivitaet, Bereiche und Moderation im Blick." },
      settings: { eyebrow: "System", title: "Einstellungen", description: "Passe Plattformdesign und Mitgliederprofile deiner Academy an." },
    },
    modules: { count: (count) => `${count} Module`, folders: (count) => `In ${count} Ordnern organisiert`, examModule: "Pruefungsmodul", learningModule: "Lernmodul", courseCount: (count) => `${count} Kurse`, examCount: "1 Pruefung", lessonCount: (count) => `${count} Lektionen`, edited: (date) => `Bearbeitet ${date}`, editInCourse: "In Kurs bearbeiten", assignToCourse: "Einem Kurs zuordnen", emptyTitle: "Noch keine Module", emptyDescription: "Lege ein Lern- oder Pruefungsmodul an und verwende es anschliessend in deinen Kursen.", createFirst: "Erstes Modul erstellen" },
    community: { posts: "Beitraege", activeMembers: "Aktive Mitglieder", answers: "Antworten", openReports: "Offene Meldungen" },
    members: { management: "Nutzerverwaltung", invite: "Mitglied einladen", importMembers: "Mitglieder importieren", closeDialog: "Dialog schliessen", firstName: "Vorname", lastName: "Nachname", email: "E-Mail-Adresse", department: "Bereich", departmentPlaceholder: "z. B. Marketing", openInviteLink: "Einladungslink oeffnen", cancel: "Abbrechen", creating: "Wird angelegt", createInvitation: "Einladung anlegen", csvFile: "CSV-Datei", chooseCsv: "CSV-Datei auswaehlen", fileSelected: "Datei ausgewaehlt", noFileSelected: "Keine Datei ausgewaehlt", csvTemplate: "CSV-Vorlage", total: "Gesamt", invited: "Eingeladen", skipped: "Uebersprungen", errors: "Fehler", row: "Zeile", notice: "Hinweis", close: "Schliessen", importing: "Import laeuft", importCsv: "CSV importieren", search: (count) => `${count} Mitglieder durchsuchen`, roleFilter: "Nach Rolle filtern", allRoles: "Alle Rollen", statusFilter: "Nach Status filtern", allStatuses: "Alle Status", active: "Aktiv", disabled: "Deaktiviert", export: "Export", import: "Import", member: "Mitglied", area: "Bereich", role: "Rolle", access: "Zugriff", average: "Durchschnitt", lastLogin: "Letzter Login", status: "Status", action: "Aktion", courses: "Kurse", groups: "Gruppen", never: "Noch nie", currentAccess: "Aktueller Zugang", protected: "Geschuetzt", enable: "Aktivieren", disable: "Deaktivieren", noResults: "Keine Mitglieder fuer diese Filter gefunden.", entries: (visible, total) => `${visible} von ${total} Eintraegen`, page: "Seite 1 von 1", exported: (count) => `${count} Mitglieder exportiert.`, exportFailed: "Der CSV-Export konnte nicht erstellt werden.", statusFailed: "Der Mitgliederstatus konnte nicht geaendert werden." },
  },
};

const en: MainPageBaseDictionary = {
  academy: {
    dashboard: { eyebrow: "Your learning dashboard", welcome: (name) => `Welcome back, ${name}.`, activeSummary: (count) => `${count} learning ${count === 1 ? "path is" : "paths are"} active. Continue where you left off.`, readySummary: "Your learning paths are ready. Start with the course that best matches your goal.", emptySummary: "Assigned learning paths will appear here.", myCourses: "My courses", aiTools: "AI Tool Centre", lastLearned: "Last studied", completed: "Completed", inProgress: "In progress", continueLearning: "Continue learning", noCourse: "No course assigned yet", noCourseDescription: "A learning path will appear here as soon as your team releases it.", activeCourses: "Active courses", communityPoints: "Community points", completedCourses: "Completed courses", pathEyebrow: "Your learning path", currentCourses: "Current courses", allCourses: "All courses", progress: (value) => `${value}% progress`, new: "New", start: "Start", continue: "Continue", emptyCourses: "Your course area is empty", emptyCoursesDescription: "Released learning paths are shown here automatically.", communityEyebrow: "From the community", communityTitle: "What others are learning", feed: "Open feed", noPosts: "No community posts yet", noPostsDescription: "Questions, experiences and new discussions will appear in the community.", community: "Open community", events: "Events", upcoming: "Coming up", noEvents: "No events scheduled", noEventsDescription: "New live sessions and deadlines will be announced here.", eventPlan: "Open events" },
    community: { eyebrow: "Learn better together", title: "Q-Community", description: "Share practical examples, improve prompts and learn from other members.", members: "Members", posts: "Posts", answers: "Answers", ranking: "Community ranking", noPoints: "No points collected yet.", points: (count) => `${count} points`, level: "Community level", nextLevel: (count, name) => `${count} points to ${name}.`, highestLevel: "You reached the highest community level.", levelUnavailable: "Community levels are currently unavailable.", composerPlaceholder: "Share a question, idea or insight...", composerUnavailable: "No community space has been set up", newPost: "New post", closeDialog: "Close dialog", announcementTitle: "Announcement title", discussionTitle: "Discussion title", contentPlaceholder: "What would you like to share with the community?", publishing: "Publishing", publish: "Publish", mentionMember: "Mention member" },
    certificates: { eyebrow: "Achievements", title: "My certificates", description: "Your credentials for fully completed courses.", validCount: "Valid credentials", revoked: "Revoked", valid: "Valid", completedOn: (date) => `Completed on ${date}`, view: "View certificate", emptyTitle: "No certificates yet", emptyDescription: "A certificate will appear here after you fully complete a course with certification enabled.", courses: "Go to my courses" },
    coach: { eyebrow: "AI learning assistant", available: "Available" },
  },
  admin: {
    dashboard: { newThisMonth: (count) => `${count} this month`, liveCourses: (count) => `${count} live`, submissionsToday: (count) => `${count} received today`, runningEnrollments: "Ongoing enrolments", learningActivity: "Learning activity", lastFourteenDays: "Interactions over the last 14 days", current: "Current", quickActions: "Quick actions", frequentTasks: "Frequent tasks", createContent: "Create learning content", createContentDescription: "Course, module or lesson", reviewSubmissions: "Review submissions", waitingAnswers: (count) => `${count} answers waiting`, configureAgent: "Configure AI agent", agentDescription: "Q-Coach and Prompt Reviewer", recentSubmissions: "Recent submissions", recentSubmissionsDescription: "Latest submitted answers", showAll: "Show all", noSubmissions: "No submissions yet", noSubmissionsDescription: "Submitted tasks and exam answers are collected here for review.", tasks: "Open task centre", coursePerformance: "Course performance", averageProgress: "Average learning progress", learners: (count) => `${count} learners`, noCourseData: "No course data yet", noCourseDataDescription: "Published courses and their learning progress will appear here.", manageCourses: "Manage courses" },
    headers: { courses: { eyebrow: "Content management", title: "Courses", description: "Organise learning offers, categories and publications." }, members: { eyebrow: "Member management", title: "Members", description: "Manage access, groups and learning progress in your academy." }, modules: { eyebrow: "Content management", title: "Reusable modules", description: "A module can be reused and synchronised across multiple courses." }, tasks: { eyebrow: "Trainer workflow", title: "Task centre", description: "Review exams, submissions and feedback for your assigned courses." }, events: { eyebrow: "Live learning", title: "Events", description: "Plan calls, workshops and deadlines for your audiences." }, community: { eyebrow: "Social learning", title: "Community", description: "Monitor activity, spaces and moderation." }, settings: { eyebrow: "System", title: "Settings", description: "Customise your academy design and member profiles." } },
    modules: { count: (count) => `${count} modules`, folders: (count) => `Organised in ${count} folders`, examModule: "Exam module", learningModule: "Learning module", courseCount: (count) => `${count} courses`, examCount: "1 exam", lessonCount: (count) => `${count} lessons`, edited: (date) => `Edited ${date}`, editInCourse: "Edit in course", assignToCourse: "Assign to a course", emptyTitle: "No modules yet", emptyDescription: "Create a learning or exam module and reuse it in your courses.", createFirst: "Create first module" },
    community: { posts: "Posts", activeMembers: "Active members", answers: "Answers", openReports: "Open reports" },
    members: { management: "User management", invite: "Invite member", importMembers: "Import members", closeDialog: "Close dialog", firstName: "First name", lastName: "Last name", email: "Email address", department: "Department", departmentPlaceholder: "e.g. Marketing", openInviteLink: "Open invitation link", cancel: "Cancel", creating: "Creating", createInvitation: "Create invitation", csvFile: "CSV file", chooseCsv: "Choose CSV file", fileSelected: "File selected", noFileSelected: "No file selected", csvTemplate: "CSV template", total: "Total", invited: "Invited", skipped: "Skipped", errors: "Errors", row: "Row", notice: "Notice", close: "Close", importing: "Importing", importCsv: "Import CSV", search: (count) => `Search ${count} members`, roleFilter: "Filter by role", allRoles: "All roles", statusFilter: "Filter by status", allStatuses: "All statuses", active: "Active", disabled: "Disabled", export: "Export", import: "Import", member: "Member", area: "Department", role: "Role", access: "Access", average: "Average", lastLogin: "Last login", status: "Status", action: "Action", courses: "Courses", groups: "Groups", never: "Never", currentAccess: "Current access", protected: "Protected", enable: "Enable", disable: "Disable", noResults: "No members match these filters.", entries: (visible, total) => `${visible} of ${total} entries`, page: "Page 1 of 1", exported: (count) => `${count} members exported.`, exportFailed: "The CSV export could not be created.", statusFailed: "The member status could not be changed." },
  },
};

const it: MainPageBaseDictionary = {
  academy: {
    dashboard: { eyebrow: "La tua dashboard", welcome: (name) => `Bentornato, ${name}.`, activeSummary: (count) => `${count} ${count === 1 ? "percorso è attivo" : "percorsi sono attivi"}. Riprendi da dove eri rimasto.`, readySummary: "I tuoi percorsi sono pronti. Inizia dal corso più adatto al tuo obiettivo.", emptySummary: "I percorsi assegnati appariranno qui.", myCourses: "I miei corsi", aiTools: "Centro strumenti IA", lastLearned: "Ultimo corso", completed: "Completato", inProgress: "In corso", continueLearning: "Continua", noCourse: "Nessun corso assegnato", noCourseDescription: "Il percorso apparirà qui quando il tuo team lo pubblicherà.", activeCourses: "Corsi attivi", communityPoints: "Punti community", completedCourses: "Corsi completati", pathEyebrow: "Il tuo percorso", currentCourses: "Corsi attuali", allCourses: "Tutti i corsi", progress: (value) => `${value}% completato`, new: "Nuovo", start: "Inizia", continue: "Continua", emptyCourses: "La tua area corsi è vuota", emptyCoursesDescription: "I percorsi disponibili vengono mostrati qui automaticamente.", communityEyebrow: "Dalla community", communityTitle: "Cosa stanno imparando gli altri", feed: "Apri feed", noPosts: "Nessun post", noPostsDescription: "Domande, esperienze e discussioni appariranno nella community.", community: "Apri community", events: "Eventi", upcoming: "In arrivo", noEvents: "Nessun evento pianificato", noEventsDescription: "Le nuove sessioni live e le scadenze saranno annunciate qui.", eventPlan: "Apri eventi" },
    community: { eyebrow: "Imparare meglio insieme", title: "Q-Community", description: "Condividi esempi pratici, migliora i prompt e impara dagli altri.", members: "Membri", posts: "Post", answers: "Risposte", ranking: "Classifica community", noPoints: "Nessun punto raccolto.", points: (count) => `${count} punti`, level: "Livello community", nextLevel: (count, name) => `Ancora ${count} punti per ${name}.`, highestLevel: "Hai raggiunto il livello più alto.", levelUnavailable: "I livelli non sono disponibili.", composerPlaceholder: "Condividi una domanda, idea o scoperta...", composerUnavailable: "Nessuno spazio community configurato", newPost: "Nuovo post", closeDialog: "Chiudi finestra", announcementTitle: "Titolo dell'annuncio", discussionTitle: "Titolo della discussione", contentPlaceholder: "Cosa vuoi condividere con la community?", publishing: "Pubblicazione", publish: "Pubblica", mentionMember: "Menziona membro" },
    certificates: { eyebrow: "Risultati", title: "I miei certificati", description: "Le tue attestazioni per i corsi completati.", validCount: "Attestazioni valide", revoked: "Revocato", valid: "Valido", completedOn: (date) => `Completato il ${date}`, view: "Vedi certificato", emptyTitle: "Nessun certificato", emptyDescription: "Il certificato apparirà dopo aver completato un corso con certificazione.", courses: "Vai ai miei corsi" },
    coach: { eyebrow: "Assistente IA", available: "Disponibile" },
  },
  admin: {
    dashboard: { newThisMonth: (count) => `${count} questo mese`, liveCourses: (count) => `${count} live`, submissionsToday: (count) => `${count} ricevute oggi`, runningEnrollments: "Iscrizioni in corso", learningActivity: "Attività didattica", lastFourteenDays: "Interazioni degli ultimi 14 giorni", current: "Attuale", quickActions: "Azioni rapide", frequentTasks: "Attività frequenti", createContent: "Crea contenuto", createContentDescription: "Corso, modulo o lezione", reviewSubmissions: "Rivedi consegne", waitingAnswers: (count) => `${count} risposte in attesa`, configureAgent: "Configura agente IA", agentDescription: "Q-Coach e Prompt Reviewer", recentSubmissions: "Consegne recenti", recentSubmissionsDescription: "Ultime risposte inviate", showAll: "Mostra tutto", noSubmissions: "Nessuna consegna", noSubmissionsDescription: "Le attività e le risposte inviate vengono raccolte qui.", tasks: "Apri centro attività", coursePerformance: "Rendimento corsi", averageProgress: "Progresso medio", learners: (count) => `${count} partecipanti`, noCourseData: "Nessun dato corso", noCourseDataDescription: "I corsi pubblicati e il loro progresso appariranno qui.", manageCourses: "Gestisci corsi" },
    headers: { courses: { eyebrow: "Gestione contenuti", title: "Corsi", description: "Organizza offerte formative, categorie e pubblicazioni." }, members: { eyebrow: "Gestione membri", title: "Membri", description: "Gestisci accessi, gruppi e progressi della tua academy." }, modules: { eyebrow: "Gestione contenuti", title: "Moduli riutilizzabili", description: "Un modulo può essere sincronizzato in più corsi." }, tasks: { eyebrow: "Flusso formatore", title: "Centro attività", description: "Gestisci esami, consegne e feedback dei corsi assegnati." }, events: { eyebrow: "Apprendimento live", title: "Eventi", description: "Pianifica call, workshop e scadenze per i destinatari." }, community: { eyebrow: "Social learning", title: "Community", description: "Controlla attività, spazi e moderazione." }, settings: { eyebrow: "Sistema", title: "Impostazioni", description: "Personalizza il design e i profili dei membri." } },
    modules: { count: (count) => `${count} moduli`, folders: (count) => `Organizzati in ${count} cartelle`, examModule: "Modulo d'esame", learningModule: "Modulo didattico", courseCount: (count) => `${count} corsi`, examCount: "1 esame", lessonCount: (count) => `${count} lezioni`, edited: (date) => `Modificato ${date}`, editInCourse: "Modifica nel corso", assignToCourse: "Assegna a un corso", emptyTitle: "Nessun modulo", emptyDescription: "Crea un modulo didattico o d'esame e riutilizzalo nei corsi.", createFirst: "Crea il primo modulo" },
    community: { posts: "Post", activeMembers: "Membri attivi", answers: "Risposte", openReports: "Segnalazioni aperte" },
    members: { management: "Gestione utenti", invite: "Invita membro", importMembers: "Importa membri", closeDialog: "Chiudi finestra", firstName: "Nome", lastName: "Cognome", email: "Indirizzo email", department: "Reparto", departmentPlaceholder: "es. Marketing", openInviteLink: "Apri link invito", cancel: "Annulla", creating: "Creazione", createInvitation: "Crea invito", csvFile: "File CSV", chooseCsv: "Scegli file CSV", fileSelected: "File selezionato", noFileSelected: "Nessun file selezionato", csvTemplate: "Modello CSV", total: "Totale", invited: "Invitati", skipped: "Ignorati", errors: "Errori", row: "Riga", notice: "Nota", close: "Chiudi", importing: "Importazione", importCsv: "Importa CSV", search: (count) => `Cerca tra ${count} membri`, roleFilter: "Filtra per ruolo", allRoles: "Tutti i ruoli", statusFilter: "Filtra per stato", allStatuses: "Tutti gli stati", active: "Attivo", disabled: "Disattivato", export: "Esporta", import: "Importa", member: "Membro", area: "Reparto", role: "Ruolo", access: "Accesso", average: "Media", lastLogin: "Ultimo accesso", status: "Stato", action: "Azione", courses: "Corsi", groups: "Gruppi", never: "Mai", currentAccess: "Accesso attuale", protected: "Protetto", enable: "Attiva", disable: "Disattiva", noResults: "Nessun membro corrisponde ai filtri.", entries: (visible, total) => `${visible} di ${total} voci`, page: "Pagina 1 di 1", exported: (count) => `${count} membri esportati.`, exportFailed: "Impossibile creare l'esportazione CSV.", statusFailed: "Impossibile cambiare lo stato del membro." },
  },
};

const es: MainPageBaseDictionary = {
  academy: {
    dashboard: { eyebrow: "Tu panel de aprendizaje", welcome: (name) => `Te damos la bienvenida, ${name}.`, activeSummary: (count) => `${count} ${count === 1 ? "ruta está activa" : "rutas están activas"}. Continúa donde lo dejaste.`, readySummary: "Tus rutas están listas. Empieza por el curso que mejor se adapte a tu objetivo.", emptySummary: "Las rutas asignadas aparecerán aquí.", myCourses: "Mis cursos", aiTools: "Centro de herramientas IA", lastLearned: "Último curso", completed: "Completado", inProgress: "En curso", continueLearning: "Continuar", noCourse: "Aún no hay cursos asignados", noCourseDescription: "La ruta aparecerá cuando tu equipo la publique.", activeCourses: "Cursos activos", communityPoints: "Puntos de comunidad", completedCourses: "Cursos completados", pathEyebrow: "Tu ruta", currentCourses: "Cursos actuales", allCourses: "Todos los cursos", progress: (value) => `${value}% de progreso`, new: "Nuevo", start: "Empezar", continue: "Continuar", emptyCourses: "Tu área de cursos está vacía", emptyCoursesDescription: "Las rutas disponibles se muestran aquí automáticamente.", communityEyebrow: "De la comunidad", communityTitle: "Lo que aprenden los demás", feed: "Abrir feed", noPosts: "Aún no hay publicaciones", noPostsDescription: "Las preguntas, experiencias y debates aparecerán en la comunidad.", community: "Abrir comunidad", events: "Eventos", upcoming: "Próximamente", noEvents: "No hay eventos programados", noEventsDescription: "Las nuevas sesiones y fechas límite se anunciarán aquí.", eventPlan: "Abrir eventos" },
    community: { eyebrow: "Aprender mejor juntos", title: "Q-Community", description: "Comparte ejemplos, mejora prompts y aprende de otras personas.", members: "Miembros", posts: "Publicaciones", answers: "Respuestas", ranking: "Clasificación", noPoints: "Aún no hay puntos.", points: (count) => `${count} puntos`, level: "Nivel de comunidad", nextLevel: (count, name) => `Faltan ${count} puntos para ${name}.`, highestLevel: "Has alcanzado el nivel más alto.", levelUnavailable: "Los niveles no están disponibles.", composerPlaceholder: "Comparte una pregunta, idea o aprendizaje...", composerUnavailable: "No hay espacios configurados", newPost: "Nueva publicación", closeDialog: "Cerrar diálogo", announcementTitle: "Título del anuncio", discussionTitle: "Título del debate", contentPlaceholder: "¿Qué quieres compartir con la comunidad?", publishing: "Publicando", publish: "Publicar", mentionMember: "Mencionar miembro" },
    certificates: { eyebrow: "Logros", title: "Mis certificados", description: "Tus acreditaciones de cursos completados.", validCount: "Acreditaciones válidas", revoked: "Revocado", valid: "Válido", completedOn: (date) => `Completado el ${date}`, view: "Ver certificado", emptyTitle: "Aún no hay certificados", emptyDescription: "El certificado aparecerá al completar un curso con certificación.", courses: "Ir a mis cursos" },
    coach: { eyebrow: "Asistente de aprendizaje IA", available: "Disponible" },
  },
  admin: {
    dashboard: { newThisMonth: (count) => `${count} este mes`, liveCourses: (count) => `${count} publicados`, submissionsToday: (count) => `${count} recibidas hoy`, runningEnrollments: "Inscripciones activas", learningActivity: "Actividad de aprendizaje", lastFourteenDays: "Interacciones de los últimos 14 días", current: "Actual", quickActions: "Acciones rápidas", frequentTasks: "Tareas frecuentes", createContent: "Crear contenido", createContentDescription: "Curso, módulo o lección", reviewSubmissions: "Revisar entregas", waitingAnswers: (count) => `${count} respuestas pendientes`, configureAgent: "Configurar agente IA", agentDescription: "Q-Coach y Prompt Reviewer", recentSubmissions: "Entregas recientes", recentSubmissionsDescription: "Últimas respuestas enviadas", showAll: "Mostrar todo", noSubmissions: "Aún no hay entregas", noSubmissionsDescription: "Las tareas y respuestas enviadas se recopilan aquí.", tasks: "Abrir centro de tareas", coursePerformance: "Rendimiento de cursos", averageProgress: "Progreso medio", learners: (count) => `${count} participantes`, noCourseData: "Aún no hay datos", noCourseDataDescription: "Los cursos publicados y su progreso aparecerán aquí.", manageCourses: "Gestionar cursos" },
    headers: { courses: { eyebrow: "Gestión de contenidos", title: "Cursos", description: "Organiza ofertas formativas, categorías y publicaciones." }, members: { eyebrow: "Gestión de miembros", title: "Miembros", description: "Gestiona accesos, grupos y progreso de tu academy." }, modules: { eyebrow: "Gestión de contenidos", title: "Módulos reutilizables", description: "Un módulo puede sincronizarse en varios cursos." }, tasks: { eyebrow: "Flujo del formador", title: "Centro de tareas", description: "Gestiona exámenes, entregas y comentarios de tus cursos." }, events: { eyebrow: "Aprendizaje en directo", title: "Eventos", description: "Planifica llamadas, talleres y fechas límite." }, community: { eyebrow: "Aprendizaje social", title: "Comunidad", description: "Supervisa actividad, espacios y moderación." }, settings: { eyebrow: "Sistema", title: "Ajustes", description: "Personaliza el diseño y los perfiles de miembros." } },
    modules: { count: (count) => `${count} módulos`, folders: (count) => `Organizados en ${count} carpetas`, examModule: "Módulo de examen", learningModule: "Módulo didáctico", courseCount: (count) => `${count} cursos`, examCount: "1 examen", lessonCount: (count) => `${count} lecciones`, edited: (date) => `Editado ${date}`, editInCourse: "Editar en curso", assignToCourse: "Asignar a un curso", emptyTitle: "Aún no hay módulos", emptyDescription: "Crea un módulo didáctico o de examen y reutilízalo en tus cursos.", createFirst: "Crear primer módulo" },
    community: { posts: "Publicaciones", activeMembers: "Miembros activos", answers: "Respuestas", openReports: "Denuncias abiertas" },
    members: { management: "Gestión de usuarios", invite: "Invitar miembro", importMembers: "Importar miembros", closeDialog: "Cerrar diálogo", firstName: "Nombre", lastName: "Apellidos", email: "Correo electrónico", department: "Área", departmentPlaceholder: "p. ej. Marketing", openInviteLink: "Abrir enlace de invitación", cancel: "Cancelar", creating: "Creando", createInvitation: "Crear invitación", csvFile: "Archivo CSV", chooseCsv: "Elegir archivo CSV", fileSelected: "Archivo seleccionado", noFileSelected: "Ningún archivo seleccionado", csvTemplate: "Plantilla CSV", total: "Total", invited: "Invitados", skipped: "Omitidos", errors: "Errores", row: "Fila", notice: "Aviso", close: "Cerrar", importing: "Importando", importCsv: "Importar CSV", search: (count) => `Buscar entre ${count} miembros`, roleFilter: "Filtrar por rol", allRoles: "Todos los roles", statusFilter: "Filtrar por estado", allStatuses: "Todos los estados", active: "Activo", disabled: "Desactivado", export: "Exportar", import: "Importar", member: "Miembro", area: "Área", role: "Rol", access: "Acceso", average: "Promedio", lastLogin: "Último acceso", status: "Estado", action: "Acción", courses: "Cursos", groups: "Grupos", never: "Nunca", currentAccess: "Acceso actual", protected: "Protegido", enable: "Activar", disable: "Desactivar", noResults: "Ningún miembro coincide con los filtros.", entries: (visible, total) => `${visible} de ${total} entradas`, page: "Página 1 de 1", exported: (count) => `${count} miembros exportados.`, exportFailed: "No se pudo crear la exportación CSV.", statusFailed: "No se pudo cambiar el estado del miembro." },
  },
};

const fr: MainPageBaseDictionary = {
  academy: {
    dashboard: { eyebrow: "Votre tableau d'apprentissage", welcome: (name) => `Bon retour, ${name}.`, activeSummary: (count) => `${count} ${count === 1 ? "parcours est actif" : "parcours sont actifs"}. Reprenez où vous vous êtes arrêté.`, readySummary: "Vos parcours sont prêts. Commencez par le cours qui correspond à votre objectif.", emptySummary: "Les parcours attribués apparaîtront ici.", myCourses: "Mes cours", aiTools: "Centre d'outils IA", lastLearned: "Dernier cours", completed: "Terminé", inProgress: "En cours", continueLearning: "Continuer", noCourse: "Aucun cours attribué", noCourseDescription: "Le parcours apparaîtra lorsque votre équipe le publiera.", activeCourses: "Cours actifs", communityPoints: "Points communauté", completedCourses: "Cours terminés", pathEyebrow: "Votre parcours", currentCourses: "Cours actuels", allCourses: "Tous les cours", progress: (value) => `${value}% de progression`, new: "Nouveau", start: "Commencer", continue: "Continuer", emptyCourses: "Votre espace de cours est vide", emptyCoursesDescription: "Les parcours disponibles sont affichés ici automatiquement.", communityEyebrow: "De la communauté", communityTitle: "Ce que les autres apprennent", feed: "Ouvrir le fil", noPosts: "Aucune publication", noPostsDescription: "Les questions, expériences et discussions apparaîtront dans la communauté.", community: "Ouvrir la communauté", events: "Événements", upcoming: "À venir", noEvents: "Aucun événement prévu", noEventsDescription: "Les nouvelles sessions et échéances seront annoncées ici.", eventPlan: "Ouvrir les événements" },
    community: { eyebrow: "Mieux apprendre ensemble", title: "Q-Community", description: "Partagez des exemples, améliorez vos prompts et apprenez des autres.", members: "Membres", posts: "Publications", answers: "Réponses", ranking: "Classement communauté", noPoints: "Aucun point pour le moment.", points: (count) => `${count} points`, level: "Niveau communauté", nextLevel: (count, name) => `Encore ${count} points avant ${name}.`, highestLevel: "Vous avez atteint le niveau le plus élevé.", levelUnavailable: "Les niveaux ne sont pas disponibles.", composerPlaceholder: "Partagez une question, une idée ou un apprentissage...", composerUnavailable: "Aucun espace communauté configuré", newPost: "Nouvelle publication", closeDialog: "Fermer la fenêtre", announcementTitle: "Titre de l'annonce", discussionTitle: "Titre de la discussion", contentPlaceholder: "Que souhaitez-vous partager avec la communauté ?", publishing: "Publication", publish: "Publier", mentionMember: "Mentionner un membre" },
    certificates: { eyebrow: "Réussites", title: "Mes certificats", description: "Vos justificatifs pour les cours entièrement terminés.", validCount: "Justificatifs valides", revoked: "Révoqué", valid: "Valide", completedOn: (date) => `Terminé le ${date}`, view: "Voir le certificat", emptyTitle: "Aucun certificat", emptyDescription: "Le certificat apparaîtra après avoir terminé un cours avec certification.", courses: "Voir mes cours" },
    coach: { eyebrow: "Assistant d'apprentissage IA", available: "Disponible" },
  },
  admin: {
    dashboard: { newThisMonth: (count) => `${count} ce mois-ci`, liveCourses: (count) => `${count} publiés`, submissionsToday: (count) => `${count} reçues aujourd'hui`, runningEnrollments: "Inscriptions en cours", learningActivity: "Activité d'apprentissage", lastFourteenDays: "Interactions des 14 derniers jours", current: "Actuel", quickActions: "Actions rapides", frequentTasks: "Tâches fréquentes", createContent: "Créer du contenu", createContentDescription: "Cours, module ou leçon", reviewSubmissions: "Examiner les travaux", waitingAnswers: (count) => `${count} réponses en attente`, configureAgent: "Configurer l'agent IA", agentDescription: "Q-Coach et Prompt Reviewer", recentSubmissions: "Travaux récents", recentSubmissionsDescription: "Dernières réponses envoyées", showAll: "Tout afficher", noSubmissions: "Aucun travail", noSubmissionsDescription: "Les tâches et réponses envoyées sont rassemblées ici.", tasks: "Ouvrir le centre de tâches", coursePerformance: "Performance des cours", averageProgress: "Progression moyenne", learners: (count) => `${count} participants`, noCourseData: "Aucune donnée de cours", noCourseDataDescription: "Les cours publiés et leur progression apparaîtront ici.", manageCourses: "Gérer les cours" },
    headers: { courses: { eyebrow: "Gestion des contenus", title: "Cours", description: "Organisez les offres, catégories et publications." }, members: { eyebrow: "Gestion des membres", title: "Membres", description: "Gérez les accès, groupes et progressions de votre academy." }, modules: { eyebrow: "Gestion des contenus", title: "Modules réutilisables", description: "Un module peut être synchronisé dans plusieurs cours." }, tasks: { eyebrow: "Flux formateur", title: "Centre de tâches", description: "Gérez examens, travaux et retours de vos cours." }, events: { eyebrow: "Apprentissage en direct", title: "Événements", description: "Planifiez appels, ateliers et échéances." }, community: { eyebrow: "Apprentissage social", title: "Communauté", description: "Suivez l'activité, les espaces et la modération." }, settings: { eyebrow: "Système", title: "Paramètres", description: "Personnalisez le design et les profils des membres." } },
    modules: { count: (count) => `${count} modules`, folders: (count) => `Organisés dans ${count} dossiers`, examModule: "Module d'examen", learningModule: "Module pédagogique", courseCount: (count) => `${count} cours`, examCount: "1 examen", lessonCount: (count) => `${count} leçons`, edited: (date) => `Modifié ${date}`, editInCourse: "Modifier dans le cours", assignToCourse: "Attribuer à un cours", emptyTitle: "Aucun module", emptyDescription: "Créez un module pédagogique ou d'examen et réutilisez-le dans vos cours.", createFirst: "Créer le premier module" },
    community: { posts: "Publications", activeMembers: "Membres actifs", answers: "Réponses", openReports: "Signalements ouverts" },
    members: { management: "Gestion des utilisateurs", invite: "Inviter un membre", importMembers: "Importer des membres", closeDialog: "Fermer la fenêtre", firstName: "Prénom", lastName: "Nom", email: "Adresse e-mail", department: "Service", departmentPlaceholder: "p. ex. Marketing", openInviteLink: "Ouvrir le lien d'invitation", cancel: "Annuler", creating: "Création", createInvitation: "Créer l'invitation", csvFile: "Fichier CSV", chooseCsv: "Choisir un fichier CSV", fileSelected: "Fichier sélectionné", noFileSelected: "Aucun fichier sélectionné", csvTemplate: "Modèle CSV", total: "Total", invited: "Invités", skipped: "Ignorés", errors: "Erreurs", row: "Ligne", notice: "Remarque", close: "Fermer", importing: "Importation", importCsv: "Importer CSV", search: (count) => `Rechercher parmi ${count} membres`, roleFilter: "Filtrer par rôle", allRoles: "Tous les rôles", statusFilter: "Filtrer par statut", allStatuses: "Tous les statuts", active: "Actif", disabled: "Désactivé", export: "Exporter", import: "Importer", member: "Membre", area: "Service", role: "Rôle", access: "Accès", average: "Moyenne", lastLogin: "Dernière connexion", status: "Statut", action: "Action", courses: "Cours", groups: "Groupes", never: "Jamais", currentAccess: "Accès actuel", protected: "Protégé", enable: "Activer", disable: "Désactiver", noResults: "Aucun membre ne correspond aux filtres.", entries: (visible, total) => `${visible} sur ${total} entrées`, page: "Page 1 sur 1", exported: (count) => `${count} membres exportés.`, exportFailed: "Impossible de créer l'export CSV.", statusFailed: "Impossible de modifier le statut du membre." },
  },
};

type MainPageExtension = {
  academy: Pick<
    MainPageDictionary["academy"],
    "communityUi" | "communityProfile" | "courseDetail" | "lessonReader"
  >;
  admin: Pick<
    MainPageDictionary["admin"],
    "analytics" | "memberDetail" | "courseEditor"
  >;
  editor: MainPageDictionary["editor"];
};

const detailDe: MainPageExtension = {
  academy: {
    communityUi: getCommunityUiCopy("de"),
    communityProfile: {
      title: "Community-Profil",
      back: "Community",
      eyebrow: "Community-Profil",
      notProvided: "Nicht angegeben",
      jobNotProvided: "Position nicht angegeben",
      departmentNotProvided: "Abteilung nicht angegeben",
      points: (count) => `${count} Punkte`,
      pointsNotProvided: "Punkte nicht angegeben",
      profileInformation: "Profilinformationen",
      noPublicInformation: "Keine weiteren oeffentlichen Profilinformationen freigegeben.",
    },
    courseDetail: {
      learningPath: "Lernpfad",
      modules: (count) => `${count} Module`,
      certificate: "Zertifikat",
      startCourse: "Kurs starten",
      continueCourse: "Kurs fortsetzen",
      courseContent: "Kursinhalt",
      modulesAndLessons: "Module und Lektionen",
      requiredLessons: (completed, total) => `${completed} von ${total} Pflichtlektionen`,
      linkedCourse: "Weiterfuehrender Kurs",
      openCourse: "Kurs oeffnen",
      locked: "Gesperrt",
      examModule: "Pruefungsmodul",
      examCount: "1 Pruefung",
      lessons: (count) => `${count} Lektionen`,
      readOnly: "Nur lesen",
      comingSoon: "Erscheint bald",
      submission: "Praxisabgabe",
      exam: "Pruefung",
      knowledgeCheck: "Wissenscheck",
      lesson: "Lektion",
      minutes: (count) => `${count} Minuten`,
      yourProgress: "Dein Fortschritt",
      allRequiredComplete: "Du hast alle Pflichtlektionen abgeschlossen.",
      requiredRemaining: (count) => `Noch ${count} Pflichtlektionen bis zum Abschluss.`,
      courseCertificate: "Kurszertifikat",
      certificateIssued: "Dein persoenlicher Abschlussnachweis ist ausgestellt.",
      certificatePending: "Der Nachweis wird nach serverseitiger Abschlusspruefung ausgestellt.",
      viewCertificate: "Zertifikat ansehen",
      coachTitle: "Q-Coach im Kurs",
      coachDescription: "Stelle unten rechts Fragen zu dieser Masterclass. Der Q-Coach kennt deine freigeschalteten Inhalte.",
      safeLearning: "Sicher lernen",
      safeLearningDescription: "Dein Fortschritt und deine Abgaben sind nur fuer dich und das Academy-Team sichtbar.",
      availableAt: (date) => `Verfuegbar ab ${date}`,
      previousModule: "Vorheriges Modul zuerst abschliessen",
      previousLesson: "Vorherige Lektion zuerst abschliessen",
      accessLocked: "Zugriff gesperrt",
      notReleased: "Noch nicht freigeschaltet",
      goalsAndInstructors: "Kursziele und Kursleitung",
      whatYouLearn: "Das lernst du",
      instructors: "Kursleitung",
      courseAuthor: "Kursautor:in",
      learnMore: "Mehr erfahren",
      courseInformation: "Kursinformationen",
      aboutCourse: "Zum Kurs",
      feedbackTitle: "Kursfeedback",
      feedbackPrompt: "Wie hilfreich ist dieser Lernpfad fuer deinen Arbeitsalltag?",
      rating: "Bewertung",
      stars: (value) => `${value} von 5 Sternen`,
      feedbackPlaceholder: "Was war hilfreich, was sollte besser werden?",
      feedbackError: "Das Feedback konnte nicht gesendet werden. Bitte pruefe deine Eingaben.",
      feedbackSuccess: "Danke, dein Feedback wurde gesendet.",
      testimonialConsent: "Mein Feedback darf anonymisiert als Testimonial verwendet werden.",
      sending: "Wird gesendet",
      sendFeedback: "Feedback senden",
      accessRequested: "Zugriff angefragt",
      withdrawRequest: "Zurueckziehen",
      requestAccess: "Zugriff anfragen",
      message: "Nachricht",
      requestMessagePlaceholder: "Optionaler Hinweis an die Administration",
      sendRequest: "Anfrage senden",
      disableLessonNotification: "Lektionsbenachrichtigung deaktivieren",
      enableLessonNotification: "Bei Lektionsfreigabe benachrichtigen",
      doNotNotify: "Nicht benachrichtigen",
      notify: "Benachrichtigen",
    },
    lessonReader: {
      backToCourse: "Zurueck zum Kurs",
      minutes: (count) => `${count} Min.`,
      completed: "Abgeschlossen",
      readOnly: "Nur lesen",
      exam: "Pruefung",
      inProgress: "In Bearbeitung",
      courseContent: "Kursinhalt",
      examModule: "Pruefungsmodul",
      courseNavigation: "Kursnavigation",
      previous: "Zurueck",
      next: "Weiter",
      courseOverview: "Kursuebersicht",
    },
  },
  admin: {
    analytics: {
      title: "Statistiken",
      eyebrow: "Learning Analytics",
      description: "Analysiere reale Aktivitaetsdaten, Kursfortschritt und Abschluesse deiner Academy.",
      exportReport: "Bericht exportieren",
      activeAssignments: "Aktive Zuweisungen",
      activeInProgress: (count) => `${count} davon in Bearbeitung`,
      averageProgress: "Durchschnittlicher Fortschritt",
      acrossActiveAssignments: "ueber alle aktiven Zuweisungen",
      completions: "Abschluesse",
      lastThirtyDays: "in den letzten 30 Tagen",
      activeLearningTime: "Aktive Lernzeit",
      measuredLastFourteenDays: "serverseitig gemessen, letzte 14 Tage",
      activityLog: "Aktivitaetsprotokoll",
      activityLogDescription: "Taeglich protokollierte Plattformereignisse der letzten 14 Tage",
      progress: "Fortschritt",
      overallProgress: "Gesamtfortschritt",
      overallProgressDescription: "Arithmetischer Mittelwert aller aktiven Kurszuweisungen von Mitgliedern.",
      liveCoursePerformance: "Performance nach Live-Kurs",
      liveCoursePerformanceDescription: "Aktive Zuweisungen, Abschluesse und gemeldeter Einschreibungsfortschritt",
      courseMetrics: (learners, completions, progress) => `${learners} Lernende | ${completions} Abschluesse | ${progress}% Fortschritt`,
      activeTime: (value) => `Aktive Lernzeit: ${value}`,
      noLiveCourses: "Noch keine Live-Kurse fuer die Auswertung vorhanden.",
      activeLearnersByDay: "Aktive Lernende nach Tag",
      noActivityData: "Keine Aktivitaetsdaten verfuegbar.",
      activeLearners: "Aktive Lernende",
      members: {
        enrollmentStatus: { not_started: "Nicht begonnen", in_progress: "In Bearbeitung", completed: "Abgeschlossen" },
        courseStatus: { draft: "Entwurf", published: "Live", archived: "Archiviert" },
        memberStatus: { active: "Aktiv", invited: "Eingeladen", disabled: "Deaktiviert" },
        noMeasurement: "Noch keine Messung",
        closeDialog: "Dialog schliessen",
        administrativeAction: "Administrative Aktion",
        resetProgress: "Lernfortschritt zuruecksetzen",
        resetSummary: (member, course) => `Der Fortschritt von ${member} im Kurs ${course} wird auf 0 Prozent gesetzt.`,
        lessonStates: (count) => `${count} Lektionsstaende`,
        quizAttempts: (count) => `${count} Quizversuche`,
        submissions: (count) => `${count} Einreichungen`,
        sharedModuleWarning: "Lektionsfortschritt ist pro Lektion gespeichert. Der Reset wird deshalb serverseitig blockiert, wenn ein Modul zugleich in einer weiteren Kurseinschreibung dieses Mitglieds verwendet wird. Punkte und Badges bleiben als historische Vergabe erhalten.",
        deleteSubmissions: "Einreichungen ebenfalls loeschen",
        deleteSubmissionsHelp: "Standardmaessig bleiben Aufgaben, Dateien, Bewertungen und Feedback erhalten.",
        revokeCertificate: "Aktives Zertifikat ausdruecklich widerrufen",
        revokeCertificateHelp: (number) => `${number} bleibt in der Historie erhalten und wird mit Grund, Zeitpunkt und Admin protokolliert.`,
        memberConfirmation: "Mitgliedsname zur Bestaetigung",
        courseConfirmation: "Kurstitel zur Bestaetigung",
        cancel: "Abbrechen",
        resetting: "Wird zurueckgesetzt",
        noCourseAssignment: "Keine Kurszuweisung fuer diesen Filter.",
        accessRevoked: "Zugriff entzogen",
        lastAccess: (date) => `Letzter Zugriff: ${date}`,
        activeLearningTime: (value) => `Aktive Lernzeit: ${value}`,
        progress: "Fortschritt",
        resetFor: (member, course) => `Fortschritt von ${member} in ${course} zuruecksetzen`,
        reset: "Reset",
        readOnly: "Nur Lesezugriff",
        title: "Fortschritt nach Mitglied",
        description: "Aktive Lernzeit wird nur in einer sichtbaren, fokussierten Lektionsansicht serverseitig gemessen. Der abgeschlossene Inhaltsumfang bleibt separat als Schaetzung gekennzeichnet.",
        search: "Mitgliederstatistiken durchsuchen",
        searchPlaceholder: "Name, E-Mail oder Kurs",
        courseFilter: "Nach Kurs filtern",
        allCourses: "Alle Kurse",
        progressFilter: "Nach Fortschritt filtern",
        allProgress: "Alle Fortschritte",
        noAssignment: "Ohne Zuweisung",
        columns: { member: "Mitglied", courses: "Kurse", average: "Durchschnitt", lastActivity: "Letzte Aktivitaet", lastLesson: "Letzte Lektion", activeLearningTime: "Aktive Lernzeit", details: "Details" },
        assignedSummary: (assigned, completed) => `${assigned} zugewiesen, ${completed} abgeschlossen`,
        average: "Durchschnitt",
        noLesson: "Keine Lektion",
        showDetails: "anzeigen",
        hideDetails: "verbergen",
        courseDetailsFor: (member, action) => `Kursdetails fuer ${member} ${action}`,
        estimatedCompleted: (value) => `Geschaetzter abgeschlossener Inhaltsumfang: ${value}`,
        coursesInProgress: (count) => `${count} Kurse in Bearbeitung`,
        assignedCompact: (assigned, completed) => `${assigned} zugewiesen | ${completed} fertig`,
        lastMeasuredActivity: "Letzte gemessene Aktivitaet",
        noMatchingMembers: "Keine passenden Mitglieder",
        noMatchingMembersDescription: "Suche oder Filter liefern aktuell keine Ergebnisse.",
        entries: (visible, total) => `${visible} von ${total} Mitgliedern`,
        resetAccess: "Reset fuer Owner und Admin",
        trainerReadAccess: "Lesezugriff fuer Trainer",
      },
    },
    memberDetail: {
      backToMembers: "Zurueck zu Mitgliedern",
      back: "Zurueck",
      eyebrow: "Mitgliederprofil",
      status: { active: "Aktiv", invited: "Eingeladen", disabled: "Deaktiviert" },
      noPosition: "Keine Position",
      since: (date) => `Seit ${date}`,
      courses: "Kurse",
      groups: "Gruppen",
      points: "Punkte",
      learningProgress: "Lernfortschritt",
      dataProfiles: { createTitle: "Datenprofil anlegen", closeDialog: "Dialog schliessen", close: "Schliessen", template: "Profilvorlage", profileName: "Profilname", profileNamePlaceholder: "z. B. Standort Berlin", cancel: "Abbrechen", create: "Anlegen", title: "Datenprofile", setActive: "Als aktives Profil festlegen", archive: "Profil archivieren", newProfile: "Neues Profil", navigation: "Datenprofile" },
    },
    courseEditor: getCourseBuilderCopy("de"),
  },
  editor: {
    richText: {
      formatText: "Text formatieren",
      blockFormat: "Blockformat",
      paragraph: "Absatz",
      headingTwo: "Ueberschrift 2",
      headingThree: "Ueberschrift 3",
      bold: "Fett",
      italic: "Kursiv",
      bulletList: "Aufzaehlung",
      numberedList: "Nummerierte Liste",
      editLink: "Link bearbeiten",
      removeLink: "Link entfernen",
      undo: "Rueckgaengig",
      redo: "Wiederholen",
      linkUrl: "Link-URL",
      applyLink: "Link anwenden",
      unsafeLink: "Nur sichere HTTP(S)- oder interne Links sind erlaubt.",
      selectLinkText: "Markiere zuerst den Text fuer den Link.",
      contentLabel: "Rich-Text-Inhalt",
      contentPlaceholder: "Lerninhalt eingeben",
      plainText: "Text",
      formatted: "Formatiert",
      communityContentLabel: "Formatierter Community-Inhalt",
    },
  },
};

const detailEn: MainPageExtension = {
  academy: {
    communityUi: getCommunityUiCopy("en"),
    communityProfile: {
      title: "Community profile",
      back: "Community",
      eyebrow: "Community profile",
      notProvided: "Not provided",
      jobNotProvided: "Job title not provided",
      departmentNotProvided: "Department not provided",
      points: (count) => `${count} points`,
      pointsNotProvided: "Points not provided",
      profileInformation: "Profile information",
      noPublicInformation: "No additional public profile information has been shared.",
    },
    courseDetail: {
      learningPath: "Learning path",
      modules: (count) => `${count} modules`,
      certificate: "Certificate",
      startCourse: "Start course",
      continueCourse: "Continue course",
      courseContent: "Course content",
      modulesAndLessons: "Modules and lessons",
      requiredLessons: (completed, total) => `${completed} of ${total} required lessons`,
      linkedCourse: "Follow-up course",
      openCourse: "Open course",
      locked: "Locked",
      examModule: "Exam module",
      examCount: "1 exam",
      lessons: (count) => `${count} lessons`,
      readOnly: "Read only",
      comingSoon: "Coming soon",
      submission: "Practical submission",
      exam: "Exam",
      knowledgeCheck: "Knowledge check",
      lesson: "Lesson",
      minutes: (count) => `${count} minutes`,
      yourProgress: "Your progress",
      allRequiredComplete: "You have completed all required lessons.",
      requiredRemaining: (count) => `${count} required lessons remaining until completion.`,
      courseCertificate: "Course certificate",
      certificateIssued: "Your personal certificate has been issued.",
      certificatePending: "The certificate will be issued after the server-side completion check.",
      viewCertificate: "View certificate",
      coachTitle: "Q-Coach in this course",
      coachDescription: "Ask questions about this masterclass in the bottom-right corner. Q-Coach knows the content available to you.",
      safeLearning: "Learn securely",
      safeLearningDescription: "Your progress and submissions are visible only to you and the academy team.",
      availableAt: (date) => `Available from ${date}`,
      previousModule: "Complete the previous module first",
      previousLesson: "Complete the previous lesson first",
      accessLocked: "Access locked",
      notReleased: "Not yet available",
      goalsAndInstructors: "Course goals and instructors",
      whatYouLearn: "What you will learn",
      instructors: "Course instructors",
      courseAuthor: "Course author",
      learnMore: "Learn more",
      courseInformation: "Course information",
      aboutCourse: "About this course",
      feedbackTitle: "Course feedback",
      feedbackPrompt: "How useful is this learning path in your day-to-day work?",
      rating: "Rating",
      stars: (value) => `${value} of 5 stars`,
      feedbackPlaceholder: "What was useful and what could be improved?",
      feedbackError: "The feedback could not be sent. Check your entries and try again.",
      feedbackSuccess: "Thank you, your feedback was sent.",
      testimonialConsent: "My feedback may be used anonymously as a testimonial.",
      sending: "Sending",
      sendFeedback: "Send feedback",
      accessRequested: "Access requested",
      withdrawRequest: "Withdraw",
      requestAccess: "Request access",
      message: "Message",
      requestMessagePlaceholder: "Optional note to the administration team",
      sendRequest: "Send request",
      disableLessonNotification: "Disable lesson notification",
      enableLessonNotification: "Notify me when the lesson is released",
      doNotNotify: "Do not notify",
      notify: "Notify me",
    },
    lessonReader: {
      backToCourse: "Back to course",
      minutes: (count) => `${count} min`,
      completed: "Completed",
      readOnly: "Read only",
      exam: "Exam",
      inProgress: "In progress",
      courseContent: "Course content",
      examModule: "Exam module",
      courseNavigation: "Course navigation",
      previous: "Previous",
      next: "Next",
      courseOverview: "Course overview",
    },
  },
  admin: {
    analytics: {
      title: "Analytics",
      eyebrow: "Learning analytics",
      description: "Analyse real activity data, course progress and completions across your academy.",
      exportReport: "Export report",
      activeAssignments: "Active assignments",
      activeInProgress: (count) => `${count} currently in progress`,
      averageProgress: "Average progress",
      acrossActiveAssignments: "across all active assignments",
      completions: "Completions",
      lastThirtyDays: "in the last 30 days",
      activeLearningTime: "Active learning time",
      measuredLastFourteenDays: "measured server-side, last 14 days",
      activityLog: "Activity log",
      activityLogDescription: "Daily platform events recorded over the last 14 days",
      progress: "Progress",
      overallProgress: "Overall progress",
      overallProgressDescription: "Arithmetic mean of all active member course assignments.",
      liveCoursePerformance: "Performance by live course",
      liveCoursePerformanceDescription: "Active assignments, completions and reported enrolment progress",
      courseMetrics: (learners, completions, progress) => `${learners} learners | ${completions} completions | ${progress}% progress`,
      activeTime: (value) => `Active learning time: ${value}`,
      noLiveCourses: "No live courses are available for analysis yet.",
      activeLearnersByDay: "Active learners by day",
      noActivityData: "No activity data available.",
      activeLearners: "Active learners",
      members: {
        enrollmentStatus: { not_started: "Not started", in_progress: "In progress", completed: "Completed" },
        courseStatus: { draft: "Draft", published: "Live", archived: "Archived" },
        memberStatus: { active: "Active", invited: "Invited", disabled: "Disabled" },
        noMeasurement: "No measurement yet",
        closeDialog: "Close dialog",
        administrativeAction: "Administrative action",
        resetProgress: "Reset learning progress",
        resetSummary: (member, course) => `${member}'s progress in ${course} will be reset to 0 percent.`,
        lessonStates: (count) => `${count} lesson progress records`,
        quizAttempts: (count) => `${count} quiz attempts`,
        submissions: (count) => `${count} submissions`,
        sharedModuleWarning: "Lesson progress is stored per lesson. The reset is therefore blocked server-side if a module is also used in another course enrolment for this member. Points and badges remain as historical awards.",
        deleteSubmissions: "Delete submissions as well",
        deleteSubmissionsHelp: "Tasks, files, assessments and feedback are retained by default.",
        revokeCertificate: "Explicitly revoke the active certificate",
        revokeCertificateHelp: (number) => `${number} remains in the history and is logged with the reason, time and administrator.`,
        memberConfirmation: "Member name for confirmation",
        courseConfirmation: "Course title for confirmation",
        cancel: "Cancel",
        resetting: "Resetting",
        noCourseAssignment: "No course assignment matches this filter.",
        accessRevoked: "Access revoked",
        lastAccess: (date) => `Last access: ${date}`,
        activeLearningTime: (value) => `Active learning time: ${value}`,
        progress: "Progress",
        resetFor: (member, course) => `Reset ${member}'s progress in ${course}`,
        reset: "Reset",
        readOnly: "Read-only access",
        title: "Progress by member",
        description: "Active learning time is measured server-side only while a lesson view is visible and focused. Completed content volume is shown separately as an estimate.",
        search: "Search member analytics",
        searchPlaceholder: "Name, email or course",
        courseFilter: "Filter by course",
        allCourses: "All courses",
        progressFilter: "Filter by progress",
        allProgress: "All progress states",
        noAssignment: "Without assignment",
        columns: { member: "Member", courses: "Courses", average: "Average", lastActivity: "Last activity", lastLesson: "Last lesson", activeLearningTime: "Active learning time", details: "Details" },
        assignedSummary: (assigned, completed) => `${assigned} assigned, ${completed} completed`,
        average: "Average",
        noLesson: "No lesson",
        showDetails: "show",
        hideDetails: "hide",
        courseDetailsFor: (member, action) => `${action} course details for ${member}`,
        estimatedCompleted: (value) => `Estimated completed content: ${value}`,
        coursesInProgress: (count) => `${count} courses in progress`,
        assignedCompact: (assigned, completed) => `${assigned} assigned | ${completed} completed`,
        lastMeasuredActivity: "Last measured activity",
        noMatchingMembers: "No matching members",
        noMatchingMembersDescription: "The current search or filters return no results.",
        entries: (visible, total) => `${visible} of ${total} members`,
        resetAccess: "Reset available to owners and admins",
        trainerReadAccess: "Read access for trainers",
      },
    },
    memberDetail: {
      backToMembers: "Back to members",
      back: "Back",
      eyebrow: "Member profile",
      status: { active: "Active", invited: "Invited", disabled: "Disabled" },
      noPosition: "No job title",
      since: (date) => `Since ${date}`,
      courses: "Courses",
      groups: "Groups",
      points: "Points",
      learningProgress: "Learning progress",
      dataProfiles: { createTitle: "Create data profile", closeDialog: "Close dialog", close: "Close", template: "Profile template", profileName: "Profile name", profileNamePlaceholder: "e.g. Berlin office", cancel: "Cancel", create: "Create", title: "Data profiles", setActive: "Set as active profile", archive: "Archive profile", newProfile: "New profile", navigation: "Data profiles" },
    },
    courseEditor: getCourseBuilderCopy("en"),
  },
  editor: {
    richText: {
      formatText: "Format text",
      blockFormat: "Block format",
      paragraph: "Paragraph",
      headingTwo: "Heading 2",
      headingThree: "Heading 3",
      bold: "Bold",
      italic: "Italic",
      bulletList: "Bulleted list",
      numberedList: "Numbered list",
      editLink: "Edit link",
      removeLink: "Remove link",
      undo: "Undo",
      redo: "Redo",
      linkUrl: "Link URL",
      applyLink: "Apply link",
      unsafeLink: "Only secure HTTP(S) or internal links are allowed.",
      selectLinkText: "Select the link text first.",
      contentLabel: "Rich-text content",
      contentPlaceholder: "Enter learning content",
      plainText: "Text",
      formatted: "Formatted",
      communityContentLabel: "Formatted community content",
    },
  },
};

const detailIt: MainPageExtension = {
  academy: {
    communityUi: getCommunityUiCopy("it"),
    communityProfile: {
      title: "Profilo community", back: "Community", eyebrow: "Profilo community", notProvided: "Non specificato", jobNotProvided: "Ruolo non specificato", departmentNotProvided: "Reparto non specificato", points: (count) => `${count} punti`, pointsNotProvided: "Punti non specificati", profileInformation: "Informazioni del profilo", noPublicInformation: "Non sono state condivise altre informazioni pubbliche del profilo.",
    },
    courseDetail: {
      learningPath: "Percorso formativo", modules: (count) => `${count} moduli`, certificate: "Certificato", startCourse: "Inizia corso", continueCourse: "Continua corso", courseContent: "Contenuto del corso", modulesAndLessons: "Moduli e lezioni", requiredLessons: (completed, total) => `${completed} di ${total} lezioni obbligatorie`, linkedCourse: "Corso successivo", openCourse: "Apri corso", locked: "Bloccato", examModule: "Modulo d'esame", examCount: "1 esame", lessons: (count) => `${count} lezioni`, readOnly: "Sola lettura", comingSoon: "Prossimamente", submission: "Consegna pratica", exam: "Esame", knowledgeCheck: "Verifica delle conoscenze", lesson: "Lezione", minutes: (count) => `${count} minuti`, yourProgress: "Il tuo progresso", allRequiredComplete: "Hai completato tutte le lezioni obbligatorie.", requiredRemaining: (count) => `Mancano ${count} lezioni obbligatorie al completamento.`, courseCertificate: "Certificato del corso", certificateIssued: "Il tuo certificato personale è stato emesso.", certificatePending: "Il certificato verrà emesso dopo la verifica del completamento lato server.", viewCertificate: "Visualizza certificato", coachTitle: "Q-Coach nel corso", coachDescription: "Fai domande su questa masterclass in basso a destra. Q-Coach conosce i contenuti a cui hai accesso.", safeLearning: "Apprendimento sicuro", safeLearningDescription: "I tuoi progressi e le tue consegne sono visibili solo a te e al team dell'academy.", availableAt: (date) => `Disponibile dal ${date}`, previousModule: "Completa prima il modulo precedente", previousLesson: "Completa prima la lezione precedente", accessLocked: "Accesso bloccato", notReleased: "Non ancora disponibile", goalsAndInstructors: "Obiettivi e docenti", whatYouLearn: "Cosa imparerai", instructors: "Docenti del corso", courseAuthor: "Autore del corso", learnMore: "Scopri di più", courseInformation: "Informazioni sul corso", aboutCourse: "Informazioni sul corso", feedbackTitle: "Feedback sul corso", feedbackPrompt: "Quanto è utile questo percorso nel tuo lavoro quotidiano?", rating: "Valutazione", stars: (value) => `${value} stelle su 5`, feedbackPlaceholder: "Cosa è stato utile e cosa si potrebbe migliorare?", feedbackError: "Non è stato possibile inviare il feedback. Controlla i dati e riprova.", feedbackSuccess: "Grazie, il tuo feedback è stato inviato.", testimonialConsent: "Il mio feedback può essere usato in forma anonima come testimonianza.", sending: "Invio", sendFeedback: "Invia feedback", accessRequested: "Accesso richiesto", withdrawRequest: "Ritira", requestAccess: "Richiedi accesso", message: "Messaggio", requestMessagePlaceholder: "Nota facoltativa per l'amministrazione", sendRequest: "Invia richiesta", disableLessonNotification: "Disattiva notifica lezione", enableLessonNotification: "Avvisami quando la lezione è disponibile", doNotNotify: "Non avvisarmi", notify: "Avvisami",
    },
    lessonReader: {
      backToCourse: "Torna al corso", minutes: (count) => `${count} min`, completed: "Completata", readOnly: "Sola lettura", exam: "Esame", inProgress: "In corso", courseContent: "Contenuto del corso", examModule: "Modulo d'esame", courseNavigation: "Navigazione del corso", previous: "Indietro", next: "Avanti", courseOverview: "Panoramica del corso",
    },
  },
  admin: {
    analytics: {
      title: "Statistiche", eyebrow: "Analisi dell'apprendimento", description: "Analizza i dati reali di attività, i progressi e i completamenti della tua academy.", exportReport: "Esporta rapporto", activeAssignments: "Assegnazioni attive", activeInProgress: (count) => `${count} attualmente in corso`, averageProgress: "Progresso medio", acrossActiveAssignments: "su tutte le assegnazioni attive", completions: "Completamenti", lastThirtyDays: "negli ultimi 30 giorni", activeLearningTime: "Tempo di apprendimento attivo", measuredLastFourteenDays: "misurato lato server, ultimi 14 giorni", activityLog: "Registro attività", activityLogDescription: "Eventi giornalieri della piattaforma registrati negli ultimi 14 giorni", progress: "Progresso", overallProgress: "Progresso complessivo", overallProgressDescription: "Media aritmetica di tutte le assegnazioni attive dei membri.", liveCoursePerformance: "Rendimento per corso pubblicato", liveCoursePerformanceDescription: "Assegnazioni attive, completamenti e progresso delle iscrizioni", courseMetrics: (learners, completions, progress) => `${learners} partecipanti | ${completions} completamenti | ${progress}% di progresso`, activeTime: (value) => `Tempo di apprendimento attivo: ${value}`, noLiveCourses: "Non ci sono ancora corsi pubblicati da analizzare.", activeLearnersByDay: "Partecipanti attivi per giorno", noActivityData: "Nessun dato di attività disponibile.", activeLearners: "Partecipanti attivi",
      members: {
        enrollmentStatus: { not_started: "Non iniziato", in_progress: "In corso", completed: "Completato" }, courseStatus: { draft: "Bozza", published: "Pubblicato", archived: "Archiviato" }, memberStatus: { active: "Attivo", invited: "Invitato", disabled: "Disattivato" }, noMeasurement: "Nessuna misurazione", closeDialog: "Chiudi finestra", administrativeAction: "Azione amministrativa", resetProgress: "Azzera progresso", resetSummary: (member, course) => `Il progresso di ${member} nel corso ${course} verrà riportato allo 0%.`, lessonStates: (count) => `${count} stati lezione`, quizAttempts: (count) => `${count} tentativi quiz`, submissions: (count) => `${count} consegne`, sharedModuleWarning: "Il progresso è memorizzato per lezione. Il ripristino viene quindi bloccato lato server se un modulo è usato anche in un'altra iscrizione dello stesso membro. Punti e badge restano come assegnazioni storiche.", deleteSubmissions: "Elimina anche le consegne", deleteSubmissionsHelp: "Per impostazione predefinita attività, file, valutazioni e feedback vengono conservati.", revokeCertificate: "Revoca esplicitamente il certificato attivo", revokeCertificateHelp: (number) => `${number} resta nella cronologia con motivo, data e amministratore.`, memberConfirmation: "Nome del membro per conferma", courseConfirmation: "Titolo del corso per conferma", cancel: "Annulla", resetting: "Ripristino", noCourseAssignment: "Nessuna assegnazione corrisponde al filtro.", accessRevoked: "Accesso revocato", lastAccess: (date) => `Ultimo accesso: ${date}`, activeLearningTime: (value) => `Tempo di apprendimento attivo: ${value}`, progress: "Progresso", resetFor: (member, course) => `Azzera il progresso di ${member} in ${course}`, reset: "Azzera", readOnly: "Accesso in sola lettura", title: "Progresso per membro", description: "Il tempo attivo viene misurato lato server solo quando la lezione è visibile e attiva. Il contenuto completato è indicato separatamente come stima.", search: "Cerca nelle statistiche membri", searchPlaceholder: "Nome, email o corso", courseFilter: "Filtra per corso", allCourses: "Tutti i corsi", progressFilter: "Filtra per progresso", allProgress: "Tutti gli stati", noAssignment: "Senza assegnazione", columns: { member: "Membro", courses: "Corsi", average: "Media", lastActivity: "Ultima attività", lastLesson: "Ultima lezione", activeLearningTime: "Tempo attivo", details: "Dettagli" }, assignedSummary: (assigned, completed) => `${assigned} assegnati, ${completed} completati`, average: "Media", noLesson: "Nessuna lezione", showDetails: "mostra", hideDetails: "nascondi", courseDetailsFor: (member, action) => `${action} dettagli dei corsi di ${member}`, estimatedCompleted: (value) => `Contenuto completato stimato: ${value}`, coursesInProgress: (count) => `${count} corsi in corso`, assignedCompact: (assigned, completed) => `${assigned} assegnati | ${completed} completati`, lastMeasuredActivity: "Ultima attività misurata", noMatchingMembers: "Nessun membro corrispondente", noMatchingMembersDescription: "La ricerca o i filtri non restituiscono risultati.", entries: (visible, total) => `${visible} di ${total} membri`, resetAccess: "Ripristino per proprietari e admin", trainerReadAccess: "Accesso in lettura per formatori",
      },
    },
    memberDetail: {
      backToMembers: "Torna ai membri", back: "Indietro", eyebrow: "Profilo membro", status: { active: "Attivo", invited: "Invitato", disabled: "Disattivato" }, noPosition: "Nessun ruolo", since: (date) => `Dal ${date}`, courses: "Corsi", groups: "Gruppi", points: "Punti", learningProgress: "Progresso formativo", dataProfiles: { createTitle: "Crea profilo dati", closeDialog: "Chiudi finestra", close: "Chiudi", template: "Modello profilo", profileName: "Nome profilo", profileNamePlaceholder: "es. Sede di Berlino", cancel: "Annulla", create: "Crea", title: "Profili dati", setActive: "Imposta come profilo attivo", archive: "Archivia profilo", newProfile: "Nuovo profilo", navigation: "Profili dati" },
    },
    courseEditor: getCourseBuilderCopy("it"),
  },
  editor: {
    richText: {
      formatText: "Formatta testo", blockFormat: "Formato blocco", paragraph: "Paragrafo", headingTwo: "Titolo 2", headingThree: "Titolo 3", bold: "Grassetto", italic: "Corsivo", bulletList: "Elenco puntato", numberedList: "Elenco numerato", editLink: "Modifica link", removeLink: "Rimuovi link", undo: "Annulla", redo: "Ripeti", linkUrl: "URL del link", applyLink: "Applica link", unsafeLink: "Sono consentiti solo link HTTP(S) sicuri o interni.", selectLinkText: "Seleziona prima il testo del link.", contentLabel: "Contenuto rich text", contentPlaceholder: "Inserisci il contenuto didattico", plainText: "Testo", formatted: "Formattato", communityContentLabel: "Contenuto community formattato",
    },
  },
};

const detailEs: MainPageExtension = {
  academy: {
    communityUi: getCommunityUiCopy("es"),
    communityProfile: {
      title: "Perfil de comunidad", back: "Comunidad", eyebrow: "Perfil de comunidad", notProvided: "No indicado", jobNotProvided: "Puesto no indicado", departmentNotProvided: "Área no indicada", points: (count) => `${count} puntos`, pointsNotProvided: "Puntos no indicados", profileInformation: "Información del perfil", noPublicInformation: "No se ha compartido más información pública del perfil.",
    },
    courseDetail: {
      learningPath: "Ruta de aprendizaje", modules: (count) => `${count} módulos`, certificate: "Certificado", startCourse: "Empezar curso", continueCourse: "Continuar curso", courseContent: "Contenido del curso", modulesAndLessons: "Módulos y lecciones", requiredLessons: (completed, total) => `${completed} de ${total} lecciones obligatorias`, linkedCourse: "Curso de continuación", openCourse: "Abrir curso", locked: "Bloqueado", examModule: "Módulo de examen", examCount: "1 examen", lessons: (count) => `${count} lecciones`, readOnly: "Solo lectura", comingSoon: "Próximamente", submission: "Entrega práctica", exam: "Examen", knowledgeCheck: "Comprobación de conocimientos", lesson: "Lección", minutes: (count) => `${count} minutos`, yourProgress: "Tu progreso", allRequiredComplete: "Has completado todas las lecciones obligatorias.", requiredRemaining: (count) => `Faltan ${count} lecciones obligatorias para completar el curso.`, courseCertificate: "Certificado del curso", certificateIssued: "Se ha emitido tu certificado personal.", certificatePending: "El certificado se emitirá tras comprobar la finalización en el servidor.", viewCertificate: "Ver certificado", coachTitle: "Q-Coach en el curso", coachDescription: "Haz preguntas sobre esta masterclass en la esquina inferior derecha. Q-Coach conoce el contenido disponible para ti.", safeLearning: "Aprendizaje seguro", safeLearningDescription: "Tu progreso y tus entregas solo son visibles para ti y el equipo de la academy.", availableAt: (date) => `Disponible desde ${date}`, previousModule: "Completa primero el módulo anterior", previousLesson: "Completa primero la lección anterior", accessLocked: "Acceso bloqueado", notReleased: "Aún no disponible", goalsAndInstructors: "Objetivos y docentes", whatYouLearn: "Lo que aprenderás", instructors: "Docentes del curso", courseAuthor: "Autor del curso", learnMore: "Más información", courseInformation: "Información del curso", aboutCourse: "Sobre el curso", feedbackTitle: "Comentarios del curso", feedbackPrompt: "¿Qué utilidad tiene esta ruta en tu trabajo diario?", rating: "Valoración", stars: (value) => `${value} de 5 estrellas`, feedbackPlaceholder: "¿Qué fue útil y qué se podría mejorar?", feedbackError: "No se pudieron enviar los comentarios. Revisa los datos e inténtalo de nuevo.", feedbackSuccess: "Gracias, tus comentarios se han enviado.", testimonialConsent: "Mis comentarios pueden utilizarse de forma anónima como testimonio.", sending: "Enviando", sendFeedback: "Enviar comentarios", accessRequested: "Acceso solicitado", withdrawRequest: "Retirar", requestAccess: "Solicitar acceso", message: "Mensaje", requestMessagePlaceholder: "Nota opcional para la administración", sendRequest: "Enviar solicitud", disableLessonNotification: "Desactivar notificación de la lección", enableLessonNotification: "Avisarme cuando se publique la lección", doNotNotify: "No avisarme", notify: "Avisarme",
    },
    lessonReader: {
      backToCourse: "Volver al curso", minutes: (count) => `${count} min`, completed: "Completada", readOnly: "Solo lectura", exam: "Examen", inProgress: "En curso", courseContent: "Contenido del curso", examModule: "Módulo de examen", courseNavigation: "Navegación del curso", previous: "Anterior", next: "Siguiente", courseOverview: "Resumen del curso",
    },
  },
  admin: {
    analytics: {
      title: "Estadísticas", eyebrow: "Analítica de aprendizaje", description: "Analiza datos reales de actividad, progreso y finalización en tu academy.", exportReport: "Exportar informe", activeAssignments: "Asignaciones activas", activeInProgress: (count) => `${count} actualmente en curso`, averageProgress: "Progreso medio", acrossActiveAssignments: "en todas las asignaciones activas", completions: "Finalizaciones", lastThirtyDays: "en los últimos 30 días", activeLearningTime: "Tiempo de aprendizaje activo", measuredLastFourteenDays: "medido en el servidor, últimos 14 días", activityLog: "Registro de actividad", activityLogDescription: "Eventos diarios de la plataforma registrados durante los últimos 14 días", progress: "Progreso", overallProgress: "Progreso general", overallProgressDescription: "Media aritmética de todas las asignaciones activas de miembros.", liveCoursePerformance: "Rendimiento por curso publicado", liveCoursePerformanceDescription: "Asignaciones activas, finalizaciones y progreso informado de las inscripciones", courseMetrics: (learners, completions, progress) => `${learners} participantes | ${completions} finalizaciones | ${progress}% de progreso`, activeTime: (value) => `Tiempo de aprendizaje activo: ${value}`, noLiveCourses: "Aún no hay cursos publicados disponibles para el análisis.", activeLearnersByDay: "Participantes activos por día", noActivityData: "No hay datos de actividad disponibles.", activeLearners: "Participantes activos",
      members: {
        enrollmentStatus: { not_started: "No empezado", in_progress: "En curso", completed: "Completado" }, courseStatus: { draft: "Borrador", published: "Publicado", archived: "Archivado" }, memberStatus: { active: "Activo", invited: "Invitado", disabled: "Desactivado" }, noMeasurement: "Aún no hay medición", closeDialog: "Cerrar diálogo", administrativeAction: "Acción administrativa", resetProgress: "Restablecer progreso", resetSummary: (member, course) => `El progreso de ${member} en ${course} se restablecerá al 0%.`, lessonStates: (count) => `${count} registros de lección`, quizAttempts: (count) => `${count} intentos de cuestionario`, submissions: (count) => `${count} entregas`, sharedModuleWarning: "El progreso se guarda por lección. Por ello, el restablecimiento se bloquea en el servidor si un módulo también se usa en otra inscripción del mismo miembro. Los puntos y distintivos se conservan como asignaciones históricas.", deleteSubmissions: "Eliminar también las entregas", deleteSubmissionsHelp: "De forma predeterminada se conservan tareas, archivos, evaluaciones y comentarios.", revokeCertificate: "Revocar explícitamente el certificado activo", revokeCertificateHelp: (number) => `${number} permanece en el historial con motivo, fecha y administrador.`, memberConfirmation: "Nombre del miembro para confirmar", courseConfirmation: "Título del curso para confirmar", cancel: "Cancelar", resetting: "Restableciendo", noCourseAssignment: "Ninguna asignación coincide con este filtro.", accessRevoked: "Acceso revocado", lastAccess: (date) => `Último acceso: ${date}`, activeLearningTime: (value) => `Tiempo de aprendizaje activo: ${value}`, progress: "Progreso", resetFor: (member, course) => `Restablecer el progreso de ${member} en ${course}`, reset: "Restablecer", readOnly: "Acceso de solo lectura", title: "Progreso por miembro", description: "El tiempo activo solo se mide en el servidor mientras la vista de una lección está visible y enfocada. El contenido completado se muestra por separado como estimación.", search: "Buscar estadísticas de miembros", searchPlaceholder: "Nombre, correo o curso", courseFilter: "Filtrar por curso", allCourses: "Todos los cursos", progressFilter: "Filtrar por progreso", allProgress: "Todos los estados", noAssignment: "Sin asignación", columns: { member: "Miembro", courses: "Cursos", average: "Promedio", lastActivity: "Última actividad", lastLesson: "Última lección", activeLearningTime: "Tiempo activo", details: "Detalles" }, assignedSummary: (assigned, completed) => `${assigned} asignados, ${completed} completados`, average: "Promedio", noLesson: "Ninguna lección", showDetails: "mostrar", hideDetails: "ocultar", courseDetailsFor: (member, action) => `${action} detalles de cursos de ${member}`, estimatedCompleted: (value) => `Contenido completado estimado: ${value}`, coursesInProgress: (count) => `${count} cursos en curso`, assignedCompact: (assigned, completed) => `${assigned} asignados | ${completed} completados`, lastMeasuredActivity: "Última actividad medida", noMatchingMembers: "No hay miembros coincidentes", noMatchingMembersDescription: "La búsqueda o los filtros no devuelven resultados.", entries: (visible, total) => `${visible} de ${total} miembros`, resetAccess: "Restablecimiento para propietarios y administradores", trainerReadAccess: "Acceso de lectura para formadores",
      },
    },
    memberDetail: {
      backToMembers: "Volver a miembros", back: "Volver", eyebrow: "Perfil de miembro", status: { active: "Activo", invited: "Invitado", disabled: "Desactivado" }, noPosition: "Sin puesto", since: (date) => `Desde ${date}`, courses: "Cursos", groups: "Grupos", points: "Puntos", learningProgress: "Progreso de aprendizaje", dataProfiles: { createTitle: "Crear perfil de datos", closeDialog: "Cerrar diálogo", close: "Cerrar", template: "Plantilla de perfil", profileName: "Nombre del perfil", profileNamePlaceholder: "p. ej. Oficina de Berlín", cancel: "Cancelar", create: "Crear", title: "Perfiles de datos", setActive: "Establecer como perfil activo", archive: "Archivar perfil", newProfile: "Nuevo perfil", navigation: "Perfiles de datos" },
    },
    courseEditor: getCourseBuilderCopy("es"),
  },
  editor: {
    richText: {
      formatText: "Dar formato al texto", blockFormat: "Formato de bloque", paragraph: "Párrafo", headingTwo: "Encabezado 2", headingThree: "Encabezado 3", bold: "Negrita", italic: "Cursiva", bulletList: "Lista con viñetas", numberedList: "Lista numerada", editLink: "Editar enlace", removeLink: "Quitar enlace", undo: "Deshacer", redo: "Rehacer", linkUrl: "URL del enlace", applyLink: "Aplicar enlace", unsafeLink: "Solo se permiten enlaces HTTP(S) seguros o internos.", selectLinkText: "Selecciona primero el texto del enlace.", contentLabel: "Contenido de texto enriquecido", contentPlaceholder: "Introduce el contenido didáctico", plainText: "Texto", formatted: "Con formato", communityContentLabel: "Contenido de comunidad con formato",
    },
  },
};

const detailFr: MainPageExtension = {
  academy: {
    communityUi: getCommunityUiCopy("fr"),
    communityProfile: {
      title: "Profil communautaire", back: "Communauté", eyebrow: "Profil communautaire", notProvided: "Non renseigné", jobNotProvided: "Poste non renseigné", departmentNotProvided: "Service non renseigné", points: (count) => `${count} points`, pointsNotProvided: "Points non renseignés", profileInformation: "Informations du profil", noPublicInformation: "Aucune autre information publique du profil n'a été partagée.",
    },
    courseDetail: {
      learningPath: "Parcours d'apprentissage", modules: (count) => `${count} modules`, certificate: "Certificat", startCourse: "Commencer le cours", continueCourse: "Continuer le cours", courseContent: "Contenu du cours", modulesAndLessons: "Modules et leçons", requiredLessons: (completed, total) => `${completed} sur ${total} leçons obligatoires`, linkedCourse: "Cours complémentaire", openCourse: "Ouvrir le cours", locked: "Verrouillé", examModule: "Module d'examen", examCount: "1 examen", lessons: (count) => `${count} leçons`, readOnly: "Lecture seule", comingSoon: "Bientôt disponible", submission: "Travail pratique", exam: "Examen", knowledgeCheck: "Contrôle des connaissances", lesson: "Leçon", minutes: (count) => `${count} minutes`, yourProgress: "Votre progression", allRequiredComplete: "Vous avez terminé toutes les leçons obligatoires.", requiredRemaining: (count) => `Il reste ${count} leçons obligatoires avant la fin.`, courseCertificate: "Certificat du cours", certificateIssued: "Votre certificat personnel a été émis.", certificatePending: "Le certificat sera émis après la vérification de fin côté serveur.", viewCertificate: "Voir le certificat", coachTitle: "Q-Coach dans le cours", coachDescription: "Posez vos questions sur cette masterclass en bas à droite. Q-Coach connaît le contenu auquel vous avez accès.", safeLearning: "Apprendre en toute sécurité", safeLearningDescription: "Votre progression et vos travaux ne sont visibles que par vous et l'équipe de l'academy.", availableAt: (date) => `Disponible à partir du ${date}`, previousModule: "Terminez d'abord le module précédent", previousLesson: "Terminez d'abord la leçon précédente", accessLocked: "Accès verrouillé", notReleased: "Pas encore disponible", goalsAndInstructors: "Objectifs et formateurs", whatYouLearn: "Ce que vous apprendrez", instructors: "Formateurs du cours", courseAuthor: "Auteur du cours", learnMore: "En savoir plus", courseInformation: "Informations du cours", aboutCourse: "À propos du cours", feedbackTitle: "Avis sur le cours", feedbackPrompt: "Quelle est l'utilité de ce parcours dans votre travail quotidien ?", rating: "Évaluation", stars: (value) => `${value} étoiles sur 5`, feedbackPlaceholder: "Qu'est-ce qui a été utile et que faudrait-il améliorer ?", feedbackError: "L'avis n'a pas pu être envoyé. Vérifiez les informations et réessayez.", feedbackSuccess: "Merci, votre avis a été envoyé.", testimonialConsent: "Mon avis peut être utilisé anonymement comme témoignage.", sending: "Envoi", sendFeedback: "Envoyer l'avis", accessRequested: "Accès demandé", withdrawRequest: "Retirer", requestAccess: "Demander l'accès", message: "Message", requestMessagePlaceholder: "Note facultative pour l'administration", sendRequest: "Envoyer la demande", disableLessonNotification: "Désactiver la notification de leçon", enableLessonNotification: "Me prévenir lorsque la leçon est publiée", doNotNotify: "Ne pas me prévenir", notify: "Me prévenir",
    },
    lessonReader: {
      backToCourse: "Retour au cours", minutes: (count) => `${count} min`, completed: "Terminée", readOnly: "Lecture seule", exam: "Examen", inProgress: "En cours", courseContent: "Contenu du cours", examModule: "Module d'examen", courseNavigation: "Navigation du cours", previous: "Précédent", next: "Suivant", courseOverview: "Vue d'ensemble du cours",
    },
  },
  admin: {
    analytics: {
      title: "Statistiques", eyebrow: "Analyse de l'apprentissage", description: "Analysez les données réelles d'activité, la progression et les réussites de votre academy.", exportReport: "Exporter le rapport", activeAssignments: "Attributions actives", activeInProgress: (count) => `${count} actuellement en cours`, averageProgress: "Progression moyenne", acrossActiveAssignments: "sur toutes les attributions actives", completions: "Cours terminés", lastThirtyDays: "au cours des 30 derniers jours", activeLearningTime: "Temps d'apprentissage actif", measuredLastFourteenDays: "mesuré côté serveur, 14 derniers jours", activityLog: "Journal d'activité", activityLogDescription: "Événements quotidiens de la plateforme enregistrés sur les 14 derniers jours", progress: "Progression", overallProgress: "Progression globale", overallProgressDescription: "Moyenne arithmétique de toutes les attributions de cours actives.", liveCoursePerformance: "Performance par cours publié", liveCoursePerformanceDescription: "Attributions actives, réussites et progression déclarée des inscriptions", courseMetrics: (learners, completions, progress) => `${learners} participants | ${completions} réussites | ${progress}% de progression`, activeTime: (value) => `Temps d'apprentissage actif : ${value}`, noLiveCourses: "Aucun cours publié n'est encore disponible pour l'analyse.", activeLearnersByDay: "Participants actifs par jour", noActivityData: "Aucune donnée d'activité disponible.", activeLearners: "Participants actifs",
      members: {
        enrollmentStatus: { not_started: "Non commencé", in_progress: "En cours", completed: "Terminé" }, courseStatus: { draft: "Brouillon", published: "Publié", archived: "Archivé" }, memberStatus: { active: "Actif", invited: "Invité", disabled: "Désactivé" }, noMeasurement: "Aucune mesure", closeDialog: "Fermer la fenêtre", administrativeAction: "Action administrative", resetProgress: "Réinitialiser la progression", resetSummary: (member, course) => `La progression de ${member} dans ${course} sera remise à 0 %.` , lessonStates: (count) => `${count} états de leçon`, quizAttempts: (count) => `${count} tentatives de quiz`, submissions: (count) => `${count} travaux`, sharedModuleWarning: "La progression est enregistrée par leçon. La réinitialisation est donc bloquée côté serveur si un module est aussi utilisé dans une autre inscription de ce membre. Les points et badges restent conservés dans l'historique.", deleteSubmissions: "Supprimer également les travaux", deleteSubmissionsHelp: "Par défaut, les tâches, fichiers, évaluations et retours sont conservés.", revokeCertificate: "Révoquer explicitement le certificat actif", revokeCertificateHelp: (number) => `${number} reste dans l'historique avec le motif, la date et l'administrateur.`, memberConfirmation: "Nom du membre pour confirmation", courseConfirmation: "Titre du cours pour confirmation", cancel: "Annuler", resetting: "Réinitialisation", noCourseAssignment: "Aucune attribution ne correspond à ce filtre.", accessRevoked: "Accès révoqué", lastAccess: (date) => `Dernier accès : ${date}`, activeLearningTime: (value) => `Temps d'apprentissage actif : ${value}`, progress: "Progression", resetFor: (member, course) => `Réinitialiser la progression de ${member} dans ${course}`, reset: "Réinitialiser", readOnly: "Accès en lecture seule", title: "Progression par membre", description: "Le temps actif est mesuré côté serveur uniquement lorsque la vue d'une leçon est visible et active. Le contenu terminé est indiqué séparément comme estimation.", search: "Rechercher dans les statistiques membres", searchPlaceholder: "Nom, e-mail ou cours", courseFilter: "Filtrer par cours", allCourses: "Tous les cours", progressFilter: "Filtrer par progression", allProgress: "Tous les états", noAssignment: "Sans attribution", columns: { member: "Membre", courses: "Cours", average: "Moyenne", lastActivity: "Dernière activité", lastLesson: "Dernière leçon", activeLearningTime: "Temps actif", details: "Détails" }, assignedSummary: (assigned, completed) => `${assigned} attribués, ${completed} terminés`, average: "Moyenne", noLesson: "Aucune leçon", showDetails: "afficher", hideDetails: "masquer", courseDetailsFor: (member, action) => `${action} les détails des cours de ${member}`, estimatedCompleted: (value) => `Contenu terminé estimé : ${value}`, coursesInProgress: (count) => `${count} cours en cours`, assignedCompact: (assigned, completed) => `${assigned} attribués | ${completed} terminés`, lastMeasuredActivity: "Dernière activité mesurée", noMatchingMembers: "Aucun membre correspondant", noMatchingMembersDescription: "La recherche ou les filtres ne renvoient aucun résultat.", entries: (visible, total) => `${visible} sur ${total} membres`, resetAccess: "Réinitialisation pour propriétaires et admins", trainerReadAccess: "Accès en lecture pour formateurs",
      },
    },
    memberDetail: {
      backToMembers: "Retour aux membres", back: "Retour", eyebrow: "Profil du membre", status: { active: "Actif", invited: "Invité", disabled: "Désactivé" }, noPosition: "Aucun poste", since: (date) => `Depuis le ${date}`, courses: "Cours", groups: "Groupes", points: "Points", learningProgress: "Progression d'apprentissage", dataProfiles: { createTitle: "Créer un profil de données", closeDialog: "Fermer la fenêtre", close: "Fermer", template: "Modèle de profil", profileName: "Nom du profil", profileNamePlaceholder: "p. ex. Bureau de Berlin", cancel: "Annuler", create: "Créer", title: "Profils de données", setActive: "Définir comme profil actif", archive: "Archiver le profil", newProfile: "Nouveau profil", navigation: "Profils de données" },
    },
    courseEditor: getCourseBuilderCopy("fr"),
  },
  editor: {
    richText: {
      formatText: "Mettre le texte en forme", blockFormat: "Format de bloc", paragraph: "Paragraphe", headingTwo: "Titre 2", headingThree: "Titre 3", bold: "Gras", italic: "Italique", bulletList: "Liste à puces", numberedList: "Liste numérotée", editLink: "Modifier le lien", removeLink: "Supprimer le lien", undo: "Annuler", redo: "Rétablir", linkUrl: "URL du lien", applyLink: "Appliquer le lien", unsafeLink: "Seuls les liens HTTP(S) sécurisés ou internes sont autorisés.", selectLinkText: "Sélectionnez d'abord le texte du lien.", contentLabel: "Contenu en texte enrichi", contentPlaceholder: "Saisissez le contenu pédagogique", plainText: "Texte", formatted: "Mis en forme", communityContentLabel: "Contenu communautaire mis en forme",
    },
  },
};

const baseDictionaries: Record<AppLocale, MainPageBaseDictionary> = {
  de,
  en,
  it,
  es,
  fr,
};

const detailDictionaries: Record<AppLocale, MainPageExtension> = {
  de: detailDe,
  en: detailEn,
  it: detailIt,
  es: detailEs,
  fr: detailFr,
};

export const MAIN_PAGE_I18N_ROUTES = [
  "/academy",
  "/academy/community",
  "/academy/community/members/[id]",
  "/academy/certificates",
  "/academy/courses/[slug]",
  "/academy/courses/[slug]/learn/[lessonId]",
  "/academy/ai",
  "/admin",
  "/admin/analytics",
  "/admin/courses",
  "/admin/courses/[id]",
  "/admin/members",
  "/admin/members/[id]",
  "/admin/modules",
  "/admin/tasks",
  "/admin/events",
  "/admin/community",
  "/admin/settings",
] as const;

export function getMainPageDictionary(locale: AppLocale): MainPageDictionary {
  const base = baseDictionaries[locale] ?? de;
  const detail = detailDictionaries[locale] ?? detailDe;
  return {
    ...base,
    academy: { ...base.academy, ...detail.academy },
    admin: { ...base.admin, ...detail.admin },
    editor: detail.editor,
  };
}
