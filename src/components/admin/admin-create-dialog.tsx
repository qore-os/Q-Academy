"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import {
  Bot,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  LoaderCircle,
  MessageCircleMore,
  PackageOpen,
  Plus,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  createAgentAdminAction,
  createBundleAdminAction,
  createCommunitySpaceAdminAction,
  createEventAdminAction,
  createGroupAdminAction,
  createHubAdminAction,
  createModuleAdminAction,
  type AdminCreateState,
} from "@/lib/admin/create-actions";
import { normalizeEventDateFields } from "@/lib/event-form";
import {
  getAdminEntityCopy,
  type AdminEntityCopy,
} from "@/lib/i18n/admin-entities";
import { getAiManagerCopy } from "@/lib/i18n/ai-manager";
import { getCommunityAdminCopy } from "@/lib/i18n/community-admin";
import { getEventAdminCopy } from "@/lib/i18n/event-admin";
import { getEventCalendarCopy } from "@/lib/i18n/event-calendar";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import {
  DEFAULT_EVENT_TIME_ZONE,
  EVENT_TIME_ZONES,
  eventTimeZoneDisplayName,
} from "@/lib/event-timezone";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";

export type AdminCreateResource =
  "group" | "bundle" | "module" | "hub" | "event" | "agent" | "community-space";

type CreateAction = (
  state: AdminCreateState,
  formData: FormData,
) => Promise<AdminCreateState>;

const initialState: AdminCreateState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48] placeholder:text-[var(--theme-muted-text)]";
const textareaClassName =
  "focus-ring min-h-24 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#2b3a48] placeholder:text-[var(--theme-muted-text)]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#52606d]";
const defaultAdminEntityCopy = getAdminEntityCopy("de");
const defaultAiManagerCopy = getAiManagerCopy("de");
const defaultCommunityAdminCopy = getCommunityAdminCopy("de");
const defaultEventAdminCopy = getEventAdminCopy("de");

const resourceConfig: Record<
  AdminCreateResource,
  {
    action: CreateAction;
    buttonLabel: string;
    title: string;
    eyebrow: string;
    icon: typeof Plus;
  }
> = {
  group: {
    action: createGroupAdminAction,
    buttonLabel: defaultAdminEntityCopy("create.groupButton"),
    title: defaultAdminEntityCopy("create.groupTitle"),
    eyebrow: defaultAdminEntityCopy("group.pageEyebrow"),
    icon: UsersRound,
  },
  bundle: {
    action: createBundleAdminAction,
    buttonLabel: defaultAdminEntityCopy("create.bundleButton"),
    title: defaultAdminEntityCopy("create.bundleTitle"),
    eyebrow: defaultAdminEntityCopy("bundle.pageEyebrow"),
    icon: PackageOpen,
  },
  module: {
    action: createModuleAdminAction,
    buttonLabel: defaultAdminEntityCopy("create.moduleButton"),
    title: defaultAdminEntityCopy("create.moduleTitle"),
    eyebrow: defaultAdminEntityCopy("module.pageEyebrow"),
    icon: Boxes,
  },
  hub: {
    action: createHubAdminAction,
    buttonLabel: defaultAdminEntityCopy("create.hubButton"),
    title: defaultAdminEntityCopy("create.hubTitle"),
    eyebrow: defaultAdminEntityCopy("hub.pageEyebrow"),
    icon: Compass,
  },
  event: {
    action: createEventAdminAction,
    buttonLabel: defaultEventAdminCopy.create.button,
    title: defaultEventAdminCopy.create.title,
    eyebrow: defaultEventAdminCopy.create.eyebrow,
    icon: CalendarDays,
  },
  agent: {
    action: createAgentAdminAction,
    buttonLabel: defaultAiManagerCopy.create.button,
    title: defaultAiManagerCopy.create.title,
    eyebrow: defaultAiManagerCopy.create.eyebrow,
    icon: Bot,
  },
  "community-space": {
    action: createCommunitySpaceAdminAction,
    buttonLabel: defaultCommunityAdminCopy.layout.newSpace,
    title: defaultCommunityAdminCopy.layout.createSpaceTitle,
    eyebrow: defaultCommunityAdminCopy.layout.createSpaceEyebrow,
    icon: MessageCircleMore,
  },
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className={labelClassName}>{children}</span>;
}

function DescriptionField({
  placeholder,
  label,
}: {
  placeholder: string;
  label: string;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        name="description"
        maxLength={5000}
        className={textareaClassName}
        placeholder={placeholder}
      />
    </label>
  );
}

function ColorField({
  defaultValue,
  label,
  accentLabel,
}: {
  defaultValue: string;
  label: string;
  accentLabel: string;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <span className="flex h-10 items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-2">
        <input
          name="color"
          type="color"
          defaultValue={defaultValue}
          className="size-7 cursor-pointer border-0 bg-transparent p-0"
          aria-label={label}
        />
        <span className="text-[10px] text-[#7a8690]">{accentLabel}</span>
      </span>
    </label>
  );
}

function ToggleField({
  name,
  label,
  defaultChecked = true,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-[#dfe4e8] bg-[#f8f9fa] px-3 py-2.5">
      <span className="text-xs font-semibold text-[#52606d]">{label}</span>
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="size-4 accent-[#2b9188]"
      />
    </label>
  );
}

type CommunityAreaOption = { id: string; title: string };

function ResourceFields({
  resource,
  copy,
  locale,
  communityAreas = [],
}: {
  resource: AdminCreateResource;
  copy: AdminEntityCopy;
  locale: AppLocale;
  communityAreas?: CommunityAreaOption[];
}) {
  if (resource === "group")
    return (
      <div className="grid gap-4">
        <label>
          <FieldLabel>{copy("common.name")}</FieldLabel>
          <input
            name="name"
            autoFocus
            required
            maxLength={160}
            className={inputClassName}
            placeholder={copy("create.groupPlaceholder")}
          />
        </label>
        <DescriptionField
          label={copy("common.description")}
          placeholder={copy("create.groupDescription")}
        />
        <ColorField
          defaultValue="#4f7cac"
          label={copy("common.color")}
          accentLabel={copy("create.accent")}
        />
      </div>
    );

  if (resource === "bundle")
    return (
      <div className="grid gap-4">
        <label>
          <FieldLabel>{copy("common.name")}</FieldLabel>
          <input
            name="name"
            autoFocus
            required
            maxLength={180}
            className={inputClassName}
            placeholder={copy("create.bundlePlaceholder")}
          />
        </label>
        <DescriptionField
          label={copy("common.description")}
          placeholder={copy("create.bundleDescription")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField
            defaultValue="#ee6c5d"
            label={copy("common.color")}
            accentLabel={copy("create.accent")}
          />
          <ToggleField name="active" label={copy("create.bundleActive")} />
        </div>
      </div>
    );

  if (resource === "module")
    return (
      <div className="grid gap-4">
        <fieldset>
          <FieldLabel>{copy("create.moduleType")}</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <label className="focus-within:ring-2 focus-within:ring-[#2b9188] has-[:checked]:border-[#2b9188] has-[:checked]:bg-[#edf9f7] flex cursor-pointer items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-3 py-3 transition-colors">
              <input
                name="kind"
                type="radio"
                value="learning"
                defaultChecked
                className="sr-only peer"
              />
              <Boxes className="size-4 text-[#536577] peer-checked:text-[#167e74]" />
              <span className="text-xs font-bold text-[#354555]">
                {copy("create.moduleLearning")}
              </span>
            </label>
            <label className="focus-within:ring-2 focus-within:ring-[#b84e42] has-[:checked]:border-[#d3695e] has-[:checked]:bg-[#fdf0ee] flex cursor-pointer items-center gap-2 rounded-md border border-[#dce1e5] bg-white px-3 py-3 transition-colors">
              <input
                name="kind"
                type="radio"
                value="exam"
                className="sr-only peer"
              />
              <ClipboardCheck className="size-4 text-[#536577] peer-checked:text-[#a34d3f]" />
              <span className="text-xs font-bold text-[#354555]">
                {copy("create.moduleExam")}
              </span>
            </label>
          </div>
        </fieldset>
        <label>
          <FieldLabel>{copy("common.title")}</FieldLabel>
          <input
            name="title"
            autoFocus
            required
            maxLength={220}
            className={inputClassName}
            placeholder={copy("create.moduleTitlePlaceholder")}
          />
        </label>
        <DescriptionField
          label={copy("common.description")}
          placeholder={copy("create.moduleDescription")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{copy("create.moduleFolder")}</FieldLabel>
            <input
              name="folder"
              required
              maxLength={120}
              defaultValue={copy("create.moduleFolderDefault")}
              className={inputClassName}
            />
          </label>
          <label>
            <FieldLabel>{copy("create.moduleDuration")}</FieldLabel>
            <input
              name="estimatedMinutes"
              type="number"
              min={1}
              max={100000}
              defaultValue={30}
              required
              className={inputClassName}
            />
          </label>
        </div>
        <ToggleField name="isReusable" label={copy("create.moduleReusable")} />
      </div>
    );

  if (resource === "hub")
    return (
      <div className="grid gap-4">
        <label>
          <FieldLabel>{copy("common.title")}</FieldLabel>
          <input
            name="title"
            autoFocus
            required
            maxLength={180}
            className={inputClassName}
            placeholder={copy("create.hubPlaceholder")}
          />
        </label>
        <DescriptionField
          label={copy("common.description")}
          placeholder={copy("create.hubDescription")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{copy("create.hubTemplate")}</FieldLabel>
            <select
              name="template"
              defaultValue="learning_center"
              className={inputClassName}
            >
              <option value="learning_center">
                {copy("create.templateLearning")}
              </option>
              <option value="onboarding">
                {copy("create.templateOnboarding")}
              </option>
              <option value="community">
                {copy("create.templateCommunity")}
              </option>
              <option value="blank">{copy("create.templateBlank")}</option>
            </select>
          </label>
          <label>
            <FieldLabel>{copy("create.hubStatus")}</FieldLabel>
            <select
              name="status"
              defaultValue="draft"
              className={inputClassName}
            >
              <option value="draft">{copy("common.draft")}</option>
              <option value="published">{copy("create.publishNow")}</option>
            </select>
          </label>
        </div>
      </div>
    );

  if (resource === "event") {
    const eventCopy = getEventAdminCopy(locale);
    const calendarCopy = getEventCalendarCopy(locale);
    return (
      <div className="grid gap-4">
        <label>
          <FieldLabel>{eventCopy.details.title}</FieldLabel>
          <input
            name="title"
            autoFocus
            required
            maxLength={220}
            className={inputClassName}
            placeholder={eventCopy.create.titlePlaceholder}
          />
        </label>
        <DescriptionField
          label={eventCopy.details.description}
          placeholder={eventCopy.create.descriptionPlaceholder}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{eventCopy.details.type}</FieldLabel>
            <select
              name="type"
              defaultValue="live_call"
              className={inputClassName}
            >
              <option value="live_call">{eventCopy.types.live_call}</option>
              <option value="workshop">{eventCopy.types.workshop}</option>
              <option value="webinar">{eventCopy.types.webinar}</option>
              <option value="deadline">{eventCopy.types.deadline}</option>
            </select>
          </label>
          <ColorField
            defaultValue="#ee6c5d"
            label={eventCopy.details.accent}
            accentLabel={eventCopy.details.accent}
          />
        </div>
        <label>
          <FieldLabel>{calendarCopy.timezone}</FieldLabel>
          <select
            name="timezone"
            defaultValue={DEFAULT_EVENT_TIME_ZONE}
            className={inputClassName}
          >
            {EVENT_TIME_ZONES.map((timeZone) => (
              <option key={timeZone} value={timeZone}>
                {eventTimeZoneDisplayName(
                  timeZone,
                  intlLocale(locale),
                  new Date(),
                )}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-[#7a8690]">
            {calendarCopy.timezoneHint}
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{eventCopy.details.startsAt}</FieldLabel>
            <input
              name="startsAt"
              type="datetime-local"
              required
              className={inputClassName}
            />
          </label>
          <label>
            <FieldLabel>{eventCopy.details.endsAt}</FieldLabel>
            <input
              name="endsAt"
              type="datetime-local"
              required
              className={inputClassName}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{eventCopy.details.meetingUrl}</FieldLabel>
            <input
              name="meetingUrl"
              type="url"
              maxLength={2000}
              className={inputClassName}
              placeholder="https://..."
            />
          </label>
          <label>
            <FieldLabel>{eventCopy.details.location}</FieldLabel>
            <input
              name="location"
              maxLength={200}
              className={inputClassName}
              placeholder={eventCopy.create.locationPlaceholder}
            />
          </label>
        </div>
        <label>
          <FieldLabel>{eventCopy.details.capacity}</FieldLabel>
          <input
            name="capacity"
            type="number"
            min={1}
            max={100000}
            className={inputClassName}
            placeholder={eventCopy.details.unlimited}
          />
        </label>
      </div>
    );
  }

  if (resource === "agent") {
    const aiCopy = getAiManagerCopy(locale);
    return (
      <div className="grid gap-4">
        <label>
          <FieldLabel>{aiCopy.create.name}</FieldLabel>
          <input
            name="name"
            autoFocus
            required
            maxLength={120}
            className={inputClassName}
            placeholder={aiCopy.create.namePlaceholder}
          />
        </label>
        <DescriptionField
          label={aiCopy.common.description}
          placeholder={aiCopy.create.descriptionPlaceholder}
        />
        <label>
          <FieldLabel>{aiCopy.create.systemPrompt}</FieldLabel>
          <textarea
            name="systemPrompt"
            required
            minLength={10}
            maxLength={50000}
            className={cn(textareaClassName, "min-h-36 font-mono text-xs")}
            placeholder={aiCopy.create.systemPlaceholder}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>{aiCopy.create.symbol}</FieldLabel>
            <select
              name="icon"
              defaultValue="sparkles"
              className={inputClassName}
            >
              <option value="sparkles">{aiCopy.icons.sparkles}</option>
              <option value="wand">{aiCopy.icons.wand}</option>
              <option value="bot">{aiCopy.icons.bot}</option>
            </select>
          </label>
          <ColorField
            defaultValue="#2bb7a9"
            label={aiCopy.create.color}
            accentLabel={aiCopy.create.accent}
          />
        </div>
        <p className="text-xs leading-5 text-[#667581]">{aiCopy.create.info}</p>
      </div>
    );
  }

  const communityCopy = getCommunityAdminCopy(locale);
  return (
    <div className="grid gap-4">
      <label>
        <FieldLabel>{communityCopy.common.title}</FieldLabel>
        <input
          name="title"
          autoFocus
          required
          maxLength={160}
          className={inputClassName}
          placeholder={communityCopy.layout.spaceTitlePlaceholder}
        />
      </label>
      <DescriptionField
        label={communityCopy.common.description}
        placeholder={communityCopy.layout.spaceDescriptionPlaceholder}
      />
      {communityAreas.length ? (
        <label>
          <FieldLabel>{communityCopy.layout.area}</FieldLabel>
          <select
            name="areaId"
            defaultValue={communityAreas[0]?.id}
            required
            className={inputClassName}
          >
            {communityAreas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <FieldLabel>{communityCopy.moderation.forumType}</FieldLabel>
        <select name="type" defaultValue="feed" className={inputClassName}>
          <option value="feed">{communityCopy.common.feed}</option>
          <option value="discussion">{communityCopy.common.discussion}</option>
          <option value="announcement">
            {communityCopy.common.announcement}
          </option>
        </select>
      </label>
      <ColorField
        defaultValue="#2bb7a9"
        label={communityCopy.common.accentColor}
        accentLabel={communityCopy.common.accentColor}
      />
    </div>
  );
}

function AdminCreateDialog({
  resource,
  locale,
  onClose,
  communityAreas,
}: {
  resource: AdminCreateResource;
  locale: AppLocale;
  onClose: () => void;
  communityAreas?: CommunityAreaOption[];
}) {
  const copy = getAdminEntityCopy(locale);
  const aiCopy = getAiManagerCopy(locale);
  const communityCopy = getCommunityAdminCopy(locale);
  const eventCopy = getEventAdminCopy(locale);
  const targetResource =
    resource === "group" ||
    resource === "bundle" ||
    resource === "module" ||
    resource === "hub";
  const agentResource = resource === "agent";
  const communityResource = resource === "community-space";
  const eventResource = resource === "event";
  const baseConfig = resourceConfig[resource];
  const config = targetResource
    ? {
        ...baseConfig,
        buttonLabel: copy(`create.${resource}Button`),
        title: copy(`create.${resource}Title`),
        eyebrow: copy(`${resource}.pageEyebrow`),
      }
    : agentResource
      ? {
          ...baseConfig,
          buttonLabel: aiCopy.create.button,
          title: aiCopy.create.title,
          eyebrow: aiCopy.create.eyebrow,
        }
      : communityResource
        ? {
            ...baseConfig,
            buttonLabel: communityCopy.layout.newSpace,
            title: communityCopy.layout.createSpaceTitle,
            eyebrow: communityCopy.layout.createSpaceEyebrow,
          }
        : eventResource
          ? {
              ...baseConfig,
              buttonLabel: eventCopy.create.button,
              title: eventCopy.create.title,
              eyebrow: eventCopy.create.eyebrow,
            }
          : baseConfig;
  const preparedAction = useCallback<CreateAction>(
    (state, formData) =>
      resourceConfig[resource].action(
        state,
        resource === "event" ? normalizeEventDateFields(formData) : formData,
      ),
    [resource],
  );
  const [state, action, pending] = useActionState(preparedAction, initialState);
  const Icon = config.icon;

  const successMessage = targetResource
    ? copy(`create.${resource}Success`)
    : agentResource
      ? aiCopy.create.successMessage
      : communityResource
        ? communityCopy.layout.createSuccess
        : eventResource
          ? eventCopy.messages[state.code ?? "eventCreated"]("0")
          : copy("create.success");
  const errorMessage = targetResource
    ? copy("create.error")
    : agentResource
      ? aiCopy.create.error
      : communityResource
        ? communityCopy.layout.createError
        : eventResource
          ? eventCopy.messages[state.code ?? "eventCreateFailed"]("0")
          : copy("create.error");
  const dialogClose = targetResource
    ? copy("create.dialogClose")
    : agentResource
      ? aiCopy.common.dialogClose
      : communityResource
        ? communityCopy.common.closeDialog
        : eventResource
          ? eventCopy.common.closeDialog
          : copy("create.dialogClose");
  const successTitle = targetResource
    ? copy("create.success")
    : agentResource
      ? aiCopy.create.success
      : communityResource
        ? copy("create.success")
        : eventResource
          ? eventCopy.create.successTitle
          : copy("create.success");
  const doneLabel = targetResource
    ? copy("create.done")
    : agentResource
      ? aiCopy.create.done
      : communityResource
        ? copy("create.done")
        : eventResource
          ? eventCopy.create.done
          : copy("create.done");
  const cancelLabel = targetResource
    ? copy("common.cancel")
    : agentResource
      ? aiCopy.common.cancel
      : communityResource
        ? communityCopy.common.cancel
        : eventResource
          ? eventCopy.create.cancel
          : copy("common.cancel");
  const creatingLabel = targetResource
    ? copy("create.creating")
    : agentResource
      ? aiCopy.create.creating
      : communityResource
        ? copy("create.creating")
        : eventResource
          ? eventCopy.create.creating
          : copy("create.creating");
  const submitLabel = targetResource
    ? copy("create.submit")
    : agentResource
      ? aiCopy.create.submit
      : communityResource
        ? communityCopy.common.create
        : eventResource
          ? eventCopy.create.submit
          : copy("create.submit");

  useEffect(() => {
    if (state.ok === true) toast.success(successMessage);
    if (state.ok === false) toast.error(errorMessage);
  }, [errorMessage, state.ok, successMessage]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-5">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px] disabled:cursor-wait"
        aria-label={dialogClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={config.title}
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e8ebee] bg-white px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
              <Icon className="size-4.5" />
            </span>
            <div>
              <p className="text-[9px] font-bold uppercase text-[#2b9188]">
                {config.eyebrow}
              </p>
              <h2 className="text-base font-bold text-[#243444]">
                {config.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3] disabled:cursor-wait disabled:opacity-45"
            aria-label={dialogClose}
          >
            <X className="size-4.5" />
          </button>
        </header>
        {state.ok ? (
          <div className="grid place-items-center px-5 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
              <CheckCircle2 className="size-6" />
            </span>
            <h3 className="mt-4 text-base font-bold text-[#243444]">
              {successTitle}
            </h3>
            <p className="mt-1 text-sm text-[#66727f]">{successMessage}</p>
            <Button type="button" className="mt-5" onClick={onClose}>
              {doneLabel}
            </Button>
          </div>
        ) : (
          <form action={action} className="p-4 sm:p-5">
            <ResourceFields
              resource={resource}
              copy={copy}
              locale={locale}
              communityAreas={communityAreas}
            />
            {state.ok === false ? (
              <p
                className="mt-4 rounded-md bg-[#fdf0ee] p-3 text-xs text-[#a94339]"
                role="alert"
              >
                {errorMessage}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={pending}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {pending ? creatingLabel : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function AdminCreateButton({
  resource,
  label,
  variant = "primary",
  className,
  communityAreas,
  locale,
}: {
  resource: AdminCreateResource;
  label?: string;
  variant?: ButtonProps["variant"];
  className?: string;
  communityAreas?: CommunityAreaOption[];
  locale: AppLocale;
}) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const copy = getAdminEntityCopy(locale);
  const aiCopy = getAiManagerCopy(locale);
  const communityCopy = getCommunityAdminCopy(locale);
  const eventCopy = getEventAdminCopy(locale);
  const config = resourceConfig[resource];
  const localizedLabel =
    resource === "group" ||
    resource === "bundle" ||
    resource === "module" ||
    resource === "hub"
      ? copy(`create.${resource}Button`)
      : resource === "agent"
        ? aiCopy.create.button
        : resource === "community-space"
          ? communityCopy.layout.newSpace
          : resource === "event"
            ? eventCopy.create.button
            : config.buttonLabel;
  return (
    <>
      <Button
        variant={variant}
        className={className}
        disabled={!hydrated}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        {label ?? localizedLabel}
      </Button>
      {open ? (
        <AdminCreateDialog
          resource={resource}
          locale={locale}
          onClose={() => setOpen(false)}
          communityAreas={communityAreas}
        />
      ) : null}
    </>
  );
}
