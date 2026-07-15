"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  Bookmark,
  BookOpen,
  Boxes,
  BrainCircuit,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare,
  ChevronDown,
  CircleHelp,
  CodeXml,
  Compass,
  DoorOpen,
  GraduationCap,
  Home,
  LayoutDashboard,
  LibraryBig,
  Mail,
  Menu,
  Megaphone,
  MessageCircleMore,
  PlugZap,
  PackageOpen,
  Orbit,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { User } from "@/db/schema";
import { TenantFavicon } from "@/components/branding/tenant-favicon";
import { logoutAction } from "@/lib/actions";
import {
  brandingCssVariables,
  type TenantBranding,
} from "@/lib/branding-model";
import { roleLabels, cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Logo } from "@/components/ui/logo";
import { NotificationCenter } from "@/components/layout/notification-center";
import type { NotificationCenterData } from "@/lib/notifications";
import { GlobalNavigationSearch } from "@/components/layout/global-navigation-search";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import type { AppLocale } from "@/lib/i18n/model";
import { SupportLauncher } from "@/components/layout/support-launcher";
import type { SupportLauncherConfiguration } from "@/lib/support";
import {
  teamPermissionAllows,
  type TeamPermissionKey,
} from "@/lib/team-permission-policy";
import type { MemberSidebarLinkView } from "@/lib/member-sidebar-links";
import { getSystemExperienceCopy } from "@/lib/i18n/system-experience";
import { memberSidebarLinkIconComponents } from "@/components/member-sidebar-link-icons";

export type NavigationShellUser = Pick<
  User,
  "email" | "firstName" | "lastName" | "avatarUrl" | "role"
>;

const adminGroups = [
  {
    label: "Home",
    items: [{ href: "/admin", label: "Uebersicht", icon: LayoutDashboard }],
  },
  {
    label: "Inhalts-Management",
    items: [
      { href: "/admin/courses", label: "Kurse", icon: LibraryBig, permission: "courses.view" },
      {
        href: "/admin/modules",
        label: "Module",
        icon: Boxes,
        adminOnly: true,
        permission: "courses.view",
      },
      { href: "/admin/tasks", label: "Aufgaben-Center", icon: CheckSquare, permission: "courses.view" },
    ],
  },
  {
    label: "Mitglieder-Management",
    items: [
      { href: "/admin/members", label: "Mitglieder", icon: Users, permission: "members.view" },
      { href: "/admin/groups", label: "Gruppen", icon: UsersRound, permission: "members.view" },
      { href: "/admin/bundles", label: "Bundles", icon: PackageOpen, permission: "members.view" },
      { href: "/admin/certificates", label: "Zertifikate", icon: Award, permission: "members.view" },
    ],
  },
  {
    label: "Erlebnis",
    items: [
      { href: "/admin/community", label: "Community", icon: MessageCircleMore, permission: "community.view" },
      { href: "/admin/hubs", label: "Hubs", icon: Compass, permission: "settings.view" },
      { href: "/admin/events", label: "Event-Plan", icon: CalendarDays, permission: "events.view" },
      {
        href: "/admin/announcements",
        label: "Ankuendigungen",
        icon: Megaphone,
        permission: "community.view",
      },
      {
        href: "/admin/email",
        label: "E-Mail-Center",
        icon: Mail,
        adminOnly: true,
        permission: "settings.view",
      },
    ],
  },
  {
    label: "KI & Auswertung",
    items: [
      { href: "/admin/ai", label: "KI-Agenten", icon: BrainCircuit, permission: "ai.view" },
      {
        href: "/admin/analytics",
        label: "Statistiken",
        icon: ChartNoAxesCombined,
        adminOnly: true,
        permission: "analytics.view",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/admin/privacy",
        label: "Datenschutz",
        icon: ShieldCheck,
        ownerOnly: true,
      },
      {
        href: "/admin/integrations",
        label: "Integrationen",
        icon: PlugZap,
        permission: "integrations.view",
      },
      { href: "/admin/api", label: "API & Webhooks", icon: CodeXml, permission: "api.view" },
      { href: "/admin/settings", label: "Einstellungen", icon: Settings, permission: "settings.view" },
      { href: "/admin/settings/roles", label: "Rollen & Rechte", icon: ShieldCheck, ownerOnly: true },
      { href: "/academy", label: "Mitgliederbereich", icon: GraduationCap },
    ],
  },
];

const memberGroups = [
  {
    label: "Lernen",
    items: [
      { href: "/academy", label: "Dashboard", icon: Home },
      { href: "/academy/courses", label: "Meine Kurse", icon: BookOpen },
      { href: "/academy/bookmarks", label: "Lesezeichen", icon: Bookmark },
      { href: "/academy/certificates", label: "Zertifikate", icon: Award },
      { href: "/academy/hub", label: "AI Tool Center", icon: Compass },
    ],
  },
  {
    label: "Austausch",
    items: [
      {
        href: "/academy/community",
        label: "Community",
        icon: MessageCircleMore,
      },
      { href: "/academy/events", label: "Event-Plan", icon: CalendarDays },
      { href: "/academy/ai", label: "Q-Coach", icon: Sparkles },
    ],
  },
];

type NavigationCopy = ReturnType<typeof getCoreDictionary>["navigation"];

const groupMessageKeys: Record<string, keyof NavigationCopy["groups"]> = {
  Home: "home",
  "Inhalts-Management": "content",
  "Mitglieder-Management": "members",
  Erlebnis: "experience",
  "KI & Auswertung": "ai",
  System: "system",
  Lernen: "learning",
  Austausch: "exchange",
};

const itemMessageKeys: Record<string, keyof NavigationCopy["items"]> = {
  "/admin": "overview",
  "/admin/courses": "courses",
  "/admin/modules": "modules",
  "/admin/tasks": "tasks",
  "/admin/members": "members",
  "/admin/groups": "groups",
  "/admin/bundles": "bundles",
  "/admin/certificates": "certificates",
  "/admin/community": "community",
  "/admin/hubs": "hubs",
  "/admin/events": "events",
  "/admin/announcements": "announcements",
  "/admin/email": "email",
  "/admin/ai": "agents",
  "/admin/analytics": "analytics",
  "/admin/privacy": "privacy",
  "/admin/integrations": "integrations",
  "/admin/api": "api",
  "/admin/settings": "settings",
  "/academy": "dashboard",
  "/academy/courses": "myCourses",
  "/academy/bookmarks": "bookmarks",
  "/academy/certificates": "certificates",
  "/academy/hub": "aiTools",
  "/academy/community": "community",
  "/academy/events": "events",
  "/academy/ai": "coach",
};

function NavContent({
  mode,
  pathname,
  userRole,
  teamPermissions,
  locale,
  onNavigate,
  memberSidebarLinks = [],
}: {
  mode: "admin" | "member";
  pathname: string;
  userRole: User["role"];
  teamPermissions?: readonly TeamPermissionKey[];
  locale: AppLocale;
  onNavigate?: () => void;
  memberSidebarLinks?: MemberSidebarLinkView[];
}) {
  const groups = mode === "admin" ? adminGroups : memberGroups;
  const copy = getCoreDictionary(locale).navigation;
  const systemCopy = getSystemExperienceCopy(locale).shell;
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[9px] font-bold uppercase text-[#8a949d]">
            {copy.groups[groupMessageKeys[group.label] ?? "home"]}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              if (
                mode === "admin" &&
                "permission" in item &&
                item.permission &&
                !teamPermissionAllows(
                  teamPermissions ?? [],
                  item.permission as TeamPermissionKey,
                )
              ) {
                return null;
              }
              if (
                "ownerOnly" in item &&
                item.ownerOnly &&
                userRole !== "owner"
              ) {
                return null;
              }
              if (
                "adminOnly" in item &&
                item.adminOnly &&
                userRole !== "owner" &&
                userRole !== "admin"
              ) {
                return null;
              }
              if (
                item.href === "/admin/announcements" &&
                userRole !== "owner" &&
                userRole !== "admin"
              ) {
                return null;
              }
              const active =
                item.href === (mode === "admin" ? "/admin" : "/academy")
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              const label =
                item.href === "/admin/settings/roles"
                  ? systemCopy.rolesAndPermissions
                  : copy.items[itemMessageKeys[item.href] ?? "overview"];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={label}
                  onClick={onNavigate}
                  className={cn(
                    "brand-radius focus-ring flex h-9 items-center gap-3 px-3 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-[var(--brand-primary)] text-white"
                      : "text-[#52606d] hover:bg-[#edf1f3] hover:text-[var(--brand-primary)]",
                  )}
                >
                  <Icon className="size-[17px] shrink-0" strokeWidth={1.9} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {mode === "member" && memberSidebarLinks.length ? (
        <div>
          <p className="mb-1.5 px-3 text-[9px] font-bold uppercase text-[#8a949d]">
            {systemCopy.customLinks}
          </p>
          <div className="space-y-0.5">
            {memberSidebarLinks.map((item) => {
              const Icon = memberSidebarLinkIconComponents[item.icon] ?? memberSidebarLinkIconComponents.link;
              const className = "brand-radius focus-ring flex min-h-11 items-center gap-3 px-3 py-2 text-[#52606d] transition-colors hover:bg-[#edf1f3] hover:text-[var(--brand-primary)]";
              const content = (
                <>
                  <Icon className="size-[17px] shrink-0" strokeWidth={1.9} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{item.label}</span>
                    {item.description ? <span className="block truncate text-[9px] text-[#87919a]">{item.description}</span> : null}
                  </span>
                </>
              );
              return item.href.startsWith("https://") ? (
                <a key={item.id} href={item.href} target="_blank" rel="noreferrer noopener" onClick={onNavigate} className={className} title={item.description ?? item.label}>{content}</a>
              ) : (
                <Link key={item.id} href={item.href} onClick={onNavigate} className={className} title={item.description ?? item.label}>{content}</Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

export function NavigationShell({
  mode,
  locale,
  user,
  branding,
  notificationData,
  support,
  teamPermissions,
  memberSidebarLinks = [],
  children,
}: {
  mode: "admin" | "member";
  locale: AppLocale;
  user: NavigationShellUser;
  branding: TenantBranding;
  notificationData: NotificationCenterData;
  support: SupportLauncherConfiguration | null;
  teamPermissions?: readonly TeamPermissionKey[];
  memberSidebarLinks?: MemberSidebarLinkView[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [rememberedAccounts, setRememberedAccounts] = useState<string[]>([]);
  const dictionary = getCoreDictionary(locale);
  const copy = dictionary.navigation;
  const accountCopy = dictionary.experience.account;
  const rememberedAccountKey = `q-academy:remembered-accounts:${branding.organizationId ?? branding.organizationSlug ?? "default"}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(rememberedAccountKey) ?? "[]",
        );
        const safeStored = Array.isArray(stored)
          ? stored.filter(
              (entry): entry is string =>
                typeof entry === "string" &&
                entry.length <= 255 &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry),
            )
          : [];
        const next = [
          user.email,
          ...safeStored.filter((email) => email !== user.email),
        ].slice(0, 5);
        window.localStorage.setItem(rememberedAccountKey, JSON.stringify(next));
        setRememberedAccounts(next);
      } catch {
        setRememberedAccounts([user.email]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rememberedAccountKey, user.email]);

  async function logout() {
    setLoggingOut(true);
    try {
      const destination = await logoutAction();
      window.location.assign(destination);
    } catch {
      setLoggingOut(false);
    }
  }

  async function switchAccount(email?: string) {
    setLoggingOut(true);
    try {
      const destination = new URL(await logoutAction(), window.location.origin);
      if (email) destination.searchParams.set("account", email);
      window.location.assign(destination.toString());
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#f5f6f7]"
      lang={locale}
      data-tenant-branding={branding.organizationSlug ?? "default"}
      style={brandingCssVariables(branding)}
    >
      <TenantFavicon href={branding.faviconUrl} />
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-[#e4e7ea] bg-white lg:flex">
        <div className="flex h-[72px] items-center border-b border-[#edf0f2] px-5">
          <Logo
            href={mode === "admin" ? "/admin" : "/academy"}
            branding={branding}
            locale={locale}
          />
        </div>
        <NavContent mode={mode} pathname={pathname} userRole={user.role} teamPermissions={teamPermissions} locale={locale} memberSidebarLinks={memberSidebarLinks} />
        <div className="border-t border-[#edf0f2] p-3">
          <Link
            href={mode === "admin" ? "/admin/tasks" : "/academy/ai"}
            className="brand-radius focus-ring flex items-center gap-3 bg-[#f1f5f7] p-3 text-xs text-[#52606d] hover:bg-[#e9eff2]"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white text-[#4f7cac]">
              <CircleHelp className="size-4" />
            </span>
            <span>
              <strong className="block text-[#243444]">
                {mode === "admin" ? copy.help.adminTitle : copy.help.memberTitle}
              </strong>
              <span>
                {mode === "admin"
                  ? copy.help.adminBody
                  : copy.help.memberBody}
              </span>
            </span>
          </Link>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-[#0f263c]/45"
            onClick={() => setMobileOpen(false)}
            aria-label={copy.close}
          />
          <aside className="relative flex h-full w-[min(88vw,320px)] flex-col bg-white shadow-2xl">
            <div className="flex h-[64px] items-center justify-between border-b border-[#edf0f2] px-4">
              <Logo
                href={mode === "admin" ? "/admin" : "/academy"}
                branding={branding}
                locale={locale}
              />
              <button
                className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                onClick={() => setMobileOpen(false)}
                aria-label={copy.close}
              >
                <X className="size-5" />
              </button>
            </div>
            <NavContent
              mode={mode}
              pathname={pathname}
              userRole={user.role}
              teamPermissions={teamPermissions}
              locale={locale}
              onNavigate={() => setMobileOpen(false)}
              memberSidebarLinks={memberSidebarLinks}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-[#e5e8eb] bg-white/95 px-4 backdrop-blur md:px-6 lg:h-[72px] lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={copy.open}
            >
              <Menu className="size-5" />
            </button>
            <GlobalNavigationSearch mode={mode} locale={locale} />
          </div>
          <div className="flex items-center gap-1.5">
            <SupportLauncher configuration={support} />
            <NotificationCenter
              key={`${notificationData.unreadCount}:${notificationData.notifications.map((item) => `${item.id}:${item.read}`).join(",")}`}
              locale={locale}
              {...notificationData}
            />
            <details className="relative">
              <summary className="focus-ring ml-1 flex cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[#f1f3f5]">
                <Avatar
                  firstName={user.firstName}
                  lastName={user.lastName}
                  src={user.avatarUrl}
                  size="md"
                />
                <span className="hidden text-left xl:block">
                  <span className="block max-w-32 truncate text-xs font-semibold text-[#243444]">
                    {user.firstName} {user.lastName}
                  </span>
                  <span className="block text-[10px] text-[#7a8691]">
                    {copy.roles[user.role] ?? roleLabels[user.role]}
                  </span>
                </span>
                <ChevronDown className="hidden size-3.5 text-[#7a8691] xl:block" />
              </summary>
              <div className="absolute right-0 top-12 w-56 rounded-md border border-[#dfe4e8] bg-white p-1.5 shadow-xl">
                <div className="border-b border-[#edf0f2] px-2.5 py-2">
                  <p className="truncate text-xs font-semibold text-[#243444]">
                    {user.email}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[#7a8691]">
                    {branding.platformName}
                  </p>
                </div>
                {user.role !== "member" ? (
                  <Link
                    href={mode === "admin" ? "/academy" : "/admin"}
                    className="mt-1 flex items-center gap-2 rounded px-2.5 py-2 text-xs text-[#52606d] hover:bg-[#f1f3f5]"
                  >
                    <DoorOpen className="size-4" />
                    {mode === "admin" ? copy.memberArea : copy.adminArea}
                  </Link>
                ) : null}
                <Link
                  href="/academy/profile"
                  className="mt-1 flex items-center gap-2 rounded px-2.5 py-2 text-xs text-[#52606d] hover:bg-[#f1f3f5]"
                >
                  <UserRound className="size-4" />
                  {copy.profile}
                </Link>
                <Link
                  href="/orbit"
                  className="mt-1 flex items-center gap-2 rounded px-2.5 py-2 text-xs text-[#52606d] hover:bg-[#f1f3f5]"
                >
                  <Orbit className="size-4" />
                  Orbit Control Plane
                </Link>
                <div className="mt-1 border-t border-[#edf0f2] pt-1">
                  {rememberedAccounts.length > 1 ? (
                    <p className="px-2.5 py-1 text-[9px] font-bold uppercase text-[#8a949d]">
                      {accountCopy.remembered}
                    </p>
                  ) : null}
                  {rememberedAccounts
                    .filter((email) => email !== user.email)
                    .map((email) => (
                      <button
                        key={email}
                        type="button"
                        disabled={loggingOut}
                        onClick={() => switchAccount(email)}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-[#52606d] hover:bg-[#f1f3f5] disabled:opacity-50"
                        title={accountCopy.switchTo}
                      >
                        <UsersRound className="size-4 shrink-0" />
                        <span className="truncate">{email}</span>
                      </button>
                    ))}
                  <button
                    type="button"
                    disabled={loggingOut}
                    onClick={() => switchAccount()}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#52606d] hover:bg-[#f1f3f5] disabled:opacity-50"
                  >
                    <UserRound className="size-4" />
                    {accountCopy.other}
                  </button>
                </div>
                <form action={logout}>
                  <button
                    type="submit"
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#b84e42] hover:bg-[#fdf0ee]"
                  >
                    <PanelLeftClose className="size-4" />
                    {copy.logout}
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main
          className={cn(
            "min-h-[calc(100vh-64px)] p-4 md:p-6 lg:min-h-[calc(100vh-72px)] lg:p-8",
            mode === "member" &&
              "pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-8",
          )}
        >
          {children}
        </main>
      </div>

      {mode === "member" ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-6 items-center border-t border-[#e1e5e8] bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label={copy.mobile}
        >
          {memberGroups
            .flatMap((group) => group.items)
            .filter((item) => ["/academy", "/academy/courses", "/academy/bookmarks", "/academy/community", "/academy/events"].includes(item.href))
            .map((item) => {
              const Icon = item.icon;
              const label = copy.items[itemMessageKeys[item.href] ?? "dashboard"];
              const active =
                item.href === "/academy"
                  ? pathname === "/academy"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "brand-radius focus-ring flex min-w-0 flex-col items-center gap-1 px-1 py-1 text-[9px] font-semibold",
                    active ? "text-[var(--brand-primary)]" : "text-[#7b8791]",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      active && "text-[var(--brand-accent)]",
                    )}
                  />
                  <span className="max-w-full truncate">
                    {label}
                  </span>
                </Link>
              );
            })}
        </nav>
      ) : null}
    </div>
  );
}
