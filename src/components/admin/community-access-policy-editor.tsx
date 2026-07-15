"use client";

import {
  KeyRound,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  updateCommunitySpaceAccessPolicyAdminAction,
  type CommunityActionState,
} from "@/lib/community-actions";
import type { CommunityAccessRuleInput } from "@/lib/community-access";
import {
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

type SubjectType = CommunityAccessRuleInput["subjectType"];
type SubjectRole = NonNullable<CommunityAccessRuleInput["subjectRole"]>;

type NamedOption = Readonly<{
  id: string;
  name: string;
}>;

export type CommunityAccessPolicyEditorData = Readonly<{
  spaces: ReadonlyArray<
    Readonly<{
      id: string;
      accessMode: "open" | "restricted";
      accessRules: readonly CommunityAccessRuleInput[];
    }>
  >;
  users: ReadonlyArray<Readonly<{ id: string; label: string }>>;
  groups: readonly NamedOption[];
  bundles: readonly NamedOption[];
}>;

export type CommunityAccessPolicyEditorProps = Readonly<{
  data: CommunityAccessPolicyEditorData;
  spaceTitles: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  locale: AppLocale;
}>;

type EditableRule = {
  key: string;
  subjectType: SubjectType;
  subjectId: string;
  canView: boolean;
  canPost: boolean;
  canComment: boolean;
};

type SubjectOption = Readonly<{
  value: string;
  label: string;
}>;

const MAX_RULES = 200;
const initialState: CommunityActionState = { ok: null, message: "" };
const subjectTypes: readonly SubjectType[] = ["role", "user", "group", "bundle"];
const selectClassName =
  "focus-ring h-9 min-w-0 rounded-md border border-[#dce1e5] bg-white px-2.5 text-xs text-[#2b3a48] disabled:cursor-not-allowed disabled:bg-[#f3f5f6] disabled:text-[#87919a]";

function subjectIdForRule(rule: CommunityAccessRuleInput) {
  switch (rule.subjectType) {
    case "role":
      return rule.subjectRole ?? "";
    case "user":
      return rule.subjectUserId ?? "";
    case "group":
      return rule.subjectGroupId ?? "";
    case "bundle":
      return rule.subjectBundleId ?? "";
  }
}

function editableRuleFromInput(
  rule: CommunityAccessRuleInput,
  index: number,
): EditableRule {
  return {
    key: `persisted-${index}`,
    subjectType: rule.subjectType,
    subjectId: subjectIdForRule(rule),
    canView: rule.canView || rule.canPost || rule.canComment,
    canPost: rule.canPost,
    canComment: rule.canComment,
  };
}

function serializeRule(rule: EditableRule): CommunityAccessRuleInput {
  const permissions = {
    canView: rule.canView || rule.canPost || rule.canComment,
    canPost: rule.canPost,
    canComment: rule.canComment,
  };
  switch (rule.subjectType) {
    case "role":
      return {
        subjectType: "role",
        subjectRole: rule.subjectId as SubjectRole,
        ...permissions,
      };
    case "user":
      return {
        subjectType: "user",
        subjectUserId: rule.subjectId,
        ...permissions,
      };
    case "group":
      return {
        subjectType: "group",
        subjectGroupId: rule.subjectId,
        ...permissions,
      };
    case "bundle":
      return {
        subjectType: "bundle",
        subjectBundleId: rule.subjectId,
        ...permissions,
      };
  }
}

function subjectIdentity(rule: Pick<EditableRule, "subjectType" | "subjectId">) {
  return `${rule.subjectType}:${rule.subjectId}`;
}

function optionsForType(
  type: SubjectType,
  data: CommunityAccessPolicyEditorData,
  locale: AppLocale,
): readonly SubjectOption[] {
  const copy = getCommunityAdminCopy(locale).access;
  switch (type) {
    case "role":
      return (["member", "trainer", "admin", "owner"] as const).map(
        (value) => ({ value, label: copy.roles[value] }),
      );
    case "user":
      return data.users.map((user) => ({ value: user.id, label: user.label }));
    case "group":
      return data.groups.map((group) => ({ value: group.id, label: group.name }));
    case "bundle":
      return data.bundles.map((bundle) => ({ value: bundle.id, label: bundle.name }));
  }
}

function availableOptions(
  type: SubjectType,
  data: CommunityAccessPolicyEditorData,
  rules: readonly EditableRule[],
  locale: AppLocale,
  currentKey?: string,
) {
  const used = new Set(
    rules
      .filter((rule) => rule.key !== currentKey)
      .map((rule) => subjectIdentity(rule)),
  );
  return optionsForType(type, data, locale).filter(
    (option) => !used.has(`${type}:${option.value}`),
  );
}

function firstAvailableSubject(
  data: CommunityAccessPolicyEditorData,
  rules: readonly EditableRule[],
  locale: AppLocale,
  currentKey?: string,
) {
  const preferredTypes: readonly SubjectType[] = [
    "role",
    "user",
    "group",
    "bundle",
  ];
  for (const type of preferredTypes) {
    const option = availableOptions(type, data, rules, locale, currentKey)[0];
    if (option) return { type, subjectId: option.value };
  }
  return null;
}

function PermissionCheckbox({
  label,
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium text-[#455463] has-disabled:cursor-not-allowed has-disabled:text-[#87919a]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="focus-ring size-4 accent-[#2bb7a9]"
      />
      {label}
    </label>
  );
}

function AccessRuleRow({
  rule,
  rules,
  data,
  pending,
  locale,
  onChange,
  onDelete,
}: {
  rule: EditableRule;
  rules: readonly EditableRule[];
  data: CommunityAccessPolicyEditorData;
  pending: boolean;
  locale: AppLocale;
  onChange: (rule: EditableRule) => void;
  onDelete: () => void;
}) {
  const copy = getCommunityAdminCopy(locale).access;
  const allOptions = optionsForType(rule.subjectType, data, locale);
  const selectableOptions = availableOptions(
    rule.subjectType,
    data,
    rules,
    locale,
    rule.key,
  );
  const currentOption = allOptions.find(
    (option) => option.value === rule.subjectId,
  );
  const currentIsSelectable = selectableOptions.some(
    (option) => option.value === rule.subjectId,
  );
  const displayedOptions = currentIsSelectable
    ? selectableOptions
    : [
        currentOption ?? {
          value: rule.subjectId,
          label: copy.unavailable,
        },
        ...selectableOptions,
      ];
  const viewDependencyId = useId();

  function updatePermission(
    permission: "canView" | "canPost" | "canComment",
    checked: boolean,
  ) {
    if (permission === "canView") {
      onChange({ ...rule, canView: checked });
      return;
    }
    onChange({
      ...rule,
      [permission]: checked,
      canView: checked ? true : rule.canView,
    });
  }

  return (
    <div className="grid gap-3 py-3 lg:grid-cols-[minmax(8rem,0.7fr)_minmax(12rem,1.5fr)_minmax(18rem,1fr)_2.25rem] lg:items-center">
      <label>
        <span className="mb-1 block text-[11px] font-semibold text-[#71808b] lg:sr-only">
          {copy.targetType}
        </span>
        <select
          value={rule.subjectType}
          disabled={pending}
          aria-label={copy.targetTypeAria}
          onChange={(event) => {
            const subjectType = event.target.value as SubjectType;
            const subjectId = availableOptions(
              subjectType,
              data,
              rules,
              locale,
              rule.key,
            )[0]?.value;
            if (subjectId) onChange({ ...rule, subjectType, subjectId });
          }}
          className={`${selectClassName} w-full`}
        >
          {subjectTypes.map((type) => (
            <option
              key={type}
              value={type}
              disabled={
                type !== rule.subjectType &&
                availableOptions(type, data, rules, locale, rule.key).length === 0
              }
            >
              {copy.subjectTypes[type]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="mb-1 block text-[11px] font-semibold text-[#71808b] lg:sr-only">
          {copy.target}
        </span>
        <select
          value={rule.subjectId}
          disabled={pending}
          aria-label={copy.selectTarget(copy.subjectTypes[rule.subjectType])}
          onChange={(event) =>
            onChange({ ...rule, subjectId: event.target.value })
          }
          className={`${selectClassName} w-full`}
        >
          {displayedOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div
        className="grid gap-1 sm:grid-cols-3 sm:gap-x-3"
        role="group"
        aria-label={copy.permissions}
      >
        <PermissionCheckbox
          label={copy.read}
          checked={rule.canView}
          disabled={pending || rule.canPost || rule.canComment}
          describedBy={viewDependencyId}
          onChange={(checked) => updatePermission("canView", checked)}
        />
        <PermissionCheckbox
          label={copy.contribute}
          checked={rule.canPost}
          disabled={pending}
          onChange={(checked) => updatePermission("canPost", checked)}
        />
        <PermissionCheckbox
          label={copy.comment}
          checked={rule.canComment}
          disabled={pending}
          onChange={(checked) => updatePermission("canComment", checked)}
        />
        <span id={viewDependencyId} className="sr-only">
          {copy.readDependency}
        </span>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className="focus-ring grid size-9 place-items-center justify-self-end rounded-md text-[#71808b] hover:bg-[#f9eae7] hover:text-[#b84e42] disabled:cursor-not-allowed disabled:opacity-50 lg:justify-self-center"
        aria-label={copy.removeRule}
        title={copy.removeRule}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function SpaceAccessPolicyForm({
  policy,
  title,
  data,
  locale,
}: {
  policy: CommunityAccessPolicyEditorData["spaces"][number];
  title: string;
  data: CommunityAccessPolicyEditorData;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale).access;
  const [accessMode, setAccessMode] = useState(policy.accessMode);
  const [rules, setRules] = useState<EditableRule[]>(() =>
    policy.accessRules.map(editableRuleFromInput),
  );
  const nextRuleNumber = useRef(rules.length);
  const action = updateCommunitySpaceAccessPolicyAdminAction.bind(
    null,
    policy.id,
  );
  const [state, formAction, pending] = useActionState(action, initialState);
  const nextSubject = firstAvailableSubject(data, rules, locale);
  const identities = rules.map(subjectIdentity);
  const hasDuplicate = new Set(identities).size !== identities.length;
  const hasInvalidSubject = rules.some((rule) => !rule.subjectId);
  const hasEmptyPermission = rules.some(
    (rule) => !rule.canView && !rule.canPost && !rule.canComment,
  );
  const canAddRule = rules.length < MAX_RULES && nextSubject !== null;

  useEffect(() => {
    if (state.ok === true) toast.success(localizeCommunityAdminAction(locale, state));
    if (state.ok === false) toast.error(localizeCommunityAdminAction(locale, state));
  }, [locale, state]);

  function updateRule(updatedRule: EditableRule) {
    setRules((current) =>
      current.map((rule) =>
        rule.key === updatedRule.key ? updatedRule : rule,
      ),
    );
  }

  function addRule() {
    if (!nextSubject || rules.length >= MAX_RULES) return;
    const key = `new-${nextRuleNumber.current}`;
    nextRuleNumber.current += 1;
    setRules((current) => [
      ...current,
      {
        key,
        subjectType: nextSubject.type,
        subjectId: nextSubject.subjectId,
        canView: true,
        canPost: false,
        canComment: false,
      },
    ]);
  }

  return (
    <form action={formAction} className="px-4 py-4 sm:px-5">
      <input type="hidden" name="accessMode" value={accessMode} />
      <input
        type="hidden"
        name="accessRulesJson"
        value={JSON.stringify(rules.map(serializeRule))}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-bold text-[#2b3a48]">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[#7a8690]">
            {accessMode === "open"
              ? copy.openForAll
              : copy.ruleCount(formatCommunityAdminNumber(rules.length, locale))}
          </p>
        </div>
        <div
          className="inline-grid h-9 shrink-0 grid-cols-2 self-start rounded-md border border-[#dce1e5] bg-[#f3f5f6] p-0.5"
          role="group"
          aria-label={copy.accessModeFor(title)}
        >
          <button
            type="button"
            aria-pressed={accessMode === "open"}
            disabled={pending}
            onClick={() => setAccessMode("open")}
            className={`focus-ring rounded px-3 text-xs font-semibold transition-colors ${
              accessMode === "open"
                ? "bg-white text-[#243444] shadow-sm"
                : "text-[#71808b] hover:text-[#354555]"
            }`}
          >
            {copy.open}
          </button>
          <button
            type="button"
            aria-pressed={accessMode === "restricted"}
            disabled={pending}
            onClick={() => setAccessMode("restricted")}
            className={`focus-ring rounded px-3 text-xs font-semibold transition-colors ${
              accessMode === "restricted"
                ? "bg-white text-[#243444] shadow-sm"
                : "text-[#71808b] hover:text-[#354555]"
            }`}
          >
            {copy.restricted}
          </button>
        </div>
      </div>

      {accessMode === "restricted" ? (
        <div className="mt-4 border-t border-[#edf0f2]">
          {rules.length ? (
            <>
              <div className="hidden grid-cols-[minmax(8rem,0.7fr)_minmax(12rem,1.5fr)_minmax(18rem,1fr)_2.25rem] gap-3 py-2 text-[10px] font-bold uppercase text-[#7a8690] lg:grid">
                <span>{copy.targetType}</span>
                <span>{copy.target}</span>
                <span>{copy.permissions}</span>
                <span className="sr-only">{getCommunityAdminCopy(locale).common.actions}</span>
              </div>
              <div className="divide-y divide-[#edf0f2]">
                {rules.map((rule) => (
                  <AccessRuleRow
                    key={rule.key}
                    rule={rule}
                    rules={rules}
                    data={data}
                    pending={pending}
                    locale={locale}
                    onChange={updateRule}
                    onDelete={() =>
                      setRules((current) =>
                        current.filter((item) => item.key !== rule.key),
                      )
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="py-4 text-xs leading-5 text-[#9a5f25]">
              {copy.noRuleWarning}
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-[#edf0f2] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || !canAddRule}
              onClick={addRule}
            >
              <Plus className="size-4" />
              {copy.addRule}
            </Button>
            <span className="text-[11px] text-[#87919a]">
              {formatCommunityAdminNumber(rules.length, locale)} / {formatCommunityAdminNumber(MAX_RULES, locale)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-[#edf0f2] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={`min-h-5 text-xs ${
            hasDuplicate || hasInvalidSubject || hasEmptyPermission
              ? "text-[#b84e42]"
              : state.ok === false
                ? "text-[#b84e42]"
                : "text-[#71808b]"
          }`}
          aria-live="polite"
        >
          {hasDuplicate
            ? copy.duplicate
            : hasInvalidSubject
              ? copy.invalidTarget
              : hasEmptyPermission
                ? copy.missingRead
              : state.ok === false
                 ? localizeCommunityAdminAction(locale, state)
                : ""}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={
            pending || hasDuplicate || hasInvalidSubject || hasEmptyPermission
          }
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {copy.save}
        </Button>
      </div>
    </form>
  );
}

export function CommunityAccessPolicyEditor({
  data,
  spaceTitles,
  locale,
}: CommunityAccessPolicyEditorProps) {
  const copy = getCommunityAdminCopy(locale).access;
  const titlesById = useMemo(
    () => new Map(spaceTitles.map((space) => [space.id, space.title])),
    [spaceTitles],
  );

  return (
    <section
      className="panel overflow-hidden"
      aria-labelledby="community-access-policy-heading"
    >
      <header className="flex items-center gap-2 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <KeyRound className="size-4 text-[#365f8d]" />
        <h2
          id="community-access-policy-heading"
          className="text-sm font-bold text-[#243444]"
        >
          {copy.heading}
        </h2>
        <span className="ml-auto text-[11px] text-[#7a8690]">
          {copy.spaceCount(formatCommunityAdminNumber(data.spaces.length, locale))}
        </span>
      </header>

      {data.spaces.length ? (
        <div className="divide-y divide-[#e8ebee]">
          {data.spaces.map((policy) => (
            <SpaceAccessPolicyForm
              key={policy.id}
              policy={policy}
              title={titlesById.get(policy.id) ?? copy.fallbackSpace}
              data={data}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[#71808b]">
          {copy.empty}
        </p>
      )}
    </section>
  );
}
