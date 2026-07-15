"use client";

import {
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Trophy,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateCommunityLevelsAdminAction,
  updateCommunityModerationPolicyAdminAction,
  type CommunityGovernanceActionState,
} from "@/lib/community-governance-actions";
import type {
  CommunityGovernanceAdminDto,
  CommunityModerationPolicyDto,
} from "@/lib/community-governance";
import {
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: CommunityGovernanceActionState = {
  ok: null,
  message: "",
};

const inputClassName =
  "h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-sm text-[#344454] outline-none transition focus:border-[#2b9188] focus:ring-2 focus:ring-[#2b9188]/15 disabled:bg-[#f3f5f6]";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold text-[#566574]">
      {children}
    </span>
  );
}

function ActionMessage({ state, locale }: { state: CommunityGovernanceActionState; locale: AppLocale }) {
  if (state.ok === null) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-xs font-medium ${state.ok ? "text-[#237d73]" : "text-[#b84e42]"}`}
    >
      {localizeCommunityAdminAction(locale, state)}
    </p>
  );
}

function ModerationPolicyForm({
  policy,
  locale,
}: {
  policy: CommunityModerationPolicyDto;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale).governance;
  const approvalLabels = copy.approvals;
  const automationLabels = copy.automations;
  const action = updateCommunityModerationPolicyAdminAction.bind(
    null,
    policy.spaceId,
  );
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="p-4 sm:p-5">
      <input type="hidden" name="expectedVersion" value={policy.version} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label>
          <FieldLabel>{copy.posts}</FieldLabel>
          <select
            name="postApproval"
            defaultValue={policy.postApproval}
            className={inputClassName}
            disabled={pending}
          >
            {Object.entries(approvalLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>{copy.comments}</FieldLabel>
          <select
            name="commentApproval"
            defaultValue={policy.commentApproval}
            className={inputClassName}
            disabled={pending}
          >
            {Object.entries(approvalLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>{copy.automation}</FieldLabel>
          <select
            name="automationMode"
            defaultValue={policy.automationMode}
            className={inputClassName}
            disabled={pending}
          >
            {Object.entries(automationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>{copy.reportsUntilHold}</FieldLabel>
          <input
            name="reportThreshold"
            type="number"
            min={2}
            max={20}
            defaultValue={policy.reportThreshold ?? ""}
            placeholder={copy.disabled}
            className={inputClassName}
            disabled={pending}
          />
        </label>
        <label>
          <FieldLabel>{copy.duplicateWindow}</FieldLabel>
          <input
            name="duplicateWindowMinutes"
            type="number"
            min={0}
            max={1440}
            defaultValue={policy.duplicateWindowMinutes}
            className={inputClassName}
            disabled={pending}
          />
        </label>
        <label>
          <FieldLabel>{copy.maxLinks}</FieldLabel>
          <input
            name="linkLimit"
            type="number"
            min={0}
            max={20}
            defaultValue={policy.linkLimit}
            className={inputClassName}
            disabled={pending}
          />
        </label>
      </div>
      <div className="mt-4 flex min-h-10 flex-wrap items-center justify-between gap-3 border-t border-[#e8ebee] pt-4">
        <ActionMessage state={state} locale={locale} />
        <Button type="submit" className="ml-auto" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {copy.saveRules}
        </Button>
      </div>
    </form>
  );
}

function ModerationSettings({
  policies,
  locale,
}: {
  policies: readonly CommunityModerationPolicyDto[];
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale).governance;
  const [selectedSpaceId, setSelectedSpaceId] = useState(
    policies[0]?.spaceId ?? "",
  );
  const selected =
    policies.find((policy) => policy.spaceId === selectedSpaceId) ?? policies[0];

  return (
    <section
      className="panel min-w-0 max-w-full overflow-hidden"
      aria-labelledby="community-governance-moderation-heading"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <ShieldCheck className="size-4 text-[#2b9188]" />
        <h2
          id="community-governance-moderation-heading"
          className="text-sm font-bold text-[#243444]"
        >
          {copy.moderationHeading}
        </h2>
        {policies.length ? (
          <select
            aria-label={copy.spaceAria}
            value={selected?.spaceId ?? ""}
            onChange={(event) => setSelectedSpaceId(event.target.value)}
            className="ml-auto h-9 max-w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-xs font-semibold text-[#455463] outline-none focus:border-[#2b9188]"
          >
            {policies.map((policy) => (
              <option key={policy.spaceId} value={policy.spaceId}>
                {policy.spaceTitle}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {selected ? (
        <ModerationPolicyForm key={selected.spaceId} policy={selected} locale={locale} />
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[#71808b]">
          {copy.emptySpaces}
        </p>
      )}
    </section>
  );
}

type EditableLevel = CommunityGovernanceAdminDto["levelConfiguration"]["levels"][number];

function LevelSettings({
  configuration,
  locale,
}: {
  configuration: CommunityGovernanceAdminDto["levelConfiguration"];
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const [levels, setLevels] = useState<EditableLevel[]>([
    ...configuration.levels,
  ]);
  const [state, formAction, pending] = useActionState(
    updateCommunityLevelsAdminAction,
    initialState,
  );
  const orderedLevels = useMemo(
    () => [...levels].sort((left, right) => left.position - right.position),
    [levels],
  );

  function updateLevel(id: string, patch: Partial<EditableLevel>) {
    setLevels((current) =>
      current.map((level) => (level.id === id ? { ...level, ...patch } : level)),
    );
  }

  function addLevel() {
    const maxPosition = levels.reduce(
      (maximum, level) => Math.max(maximum, level.position),
      0,
    );
    const maxThreshold = levels.reduce(
      (maximum, level) => Math.max(maximum, level.minPoints),
      0,
    );
    setLevels((current) => [
      ...current,
      {
        id: globalThis.crypto.randomUUID(),
        position: Math.min(100, maxPosition + 1),
        name: copy.governance.newLevel,
        description: "",
        minPoints: maxThreshold + 20,
        icon: "award",
        color: "#2bb7a9",
        active: true,
      },
    ]);
  }

  return (
    <section
      className="panel min-w-0 max-w-full overflow-hidden"
      aria-labelledby="community-governance-level-heading"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e8ebee] px-4 py-3 sm:px-5">
        <Trophy className="size-4 text-[#d6a536]" />
        <h2
          id="community-governance-level-heading"
          className="text-sm font-bold text-[#243444]"
        >
          {copy.governance.levelHeading}
        </h2>
        <Button
          type="button"
          variant="secondary"
          className="ml-auto"
          onClick={addLevel}
          disabled={pending || levels.length >= 100}
        >
          <Plus className="size-4" />
          {copy.governance.addLevel}
        </Button>
      </header>
      <form
        action={formAction}
        className="min-w-0 max-w-full overflow-hidden p-4 sm:p-5"
      >
        <input
          type="hidden"
          name="expectedRevision"
          value={configuration.revision}
        />
        <input
          type="hidden"
          name="levelsJson"
          value={JSON.stringify(orderedLevels)}
        />
        <label className="mb-4 flex min-h-10 items-center justify-between gap-4 border-b border-[#e8ebee] pb-4">
          <span className="text-sm font-semibold text-[#344454]">
            {copy.governance.enabled}
          </span>
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={configuration.enabled}
            className="size-5 accent-[#2b9188]"
            disabled={pending}
          />
        </label>

        <div className="divide-y divide-[#edf0f2] md:hidden">
          {orderedLevels.map((level) => (
            <div key={level.id} className="grid grid-cols-2 gap-3 py-4 first:pt-0">
              <label className="col-span-2">
                <FieldLabel>{copy.common.name}</FieldLabel>
                <input
                  value={level.name}
                  maxLength={160}
                  onChange={(event) =>
                    updateLevel(level.id, { name: event.target.value })
                  }
                  className={inputClassName}
                  disabled={pending}
                />
              </label>
              <label className="col-span-2">
                <FieldLabel>{copy.common.description}</FieldLabel>
                <input
                  value={level.description}
                  maxLength={5000}
                  onChange={(event) =>
                    updateLevel(level.id, {
                      description: event.target.value,
                    })
                  }
                  className={inputClassName}
                  disabled={pending}
                />
              </label>
              <label>
                <FieldLabel>{copy.governance.position}</FieldLabel>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={level.position}
                  onChange={(event) =>
                    updateLevel(level.id, {
                      position: Number(event.target.value),
                    })
                  }
                  className={inputClassName}
                  disabled={pending}
                />
              </label>
              <label>
                <FieldLabel>{copy.governance.pointsFrom}</FieldLabel>
                <input
                  type="number"
                  min={0}
                  max={2_147_483_647}
                  value={level.minPoints}
                  onChange={(event) =>
                    updateLevel(level.id, {
                      minPoints: Number(event.target.value),
                    })
                  }
                  className={inputClassName}
                  disabled={pending}
                />
              </label>
              <label>
                <FieldLabel>{copy.governance.icon}</FieldLabel>
                <input
                  value={level.icon}
                  maxLength={60}
                  onChange={(event) =>
                    updateLevel(level.id, { icon: event.target.value })
                  }
                  className={inputClassName}
                  disabled={pending}
                />
              </label>
              <label>
                <FieldLabel>{copy.governance.color}</FieldLabel>
                <input
                  type="color"
                  value={level.color}
                  onChange={(event) =>
                    updateLevel(level.id, { color: event.target.value })
                  }
                  className="h-10 w-full cursor-pointer rounded-md border border-[#dfe4e8] bg-white p-1"
                  disabled={pending}
                />
              </label>
              <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-[#455463]">
                <input
                  type="checkbox"
                  checked={level.active}
                  onChange={(event) =>
                    updateLevel(level.id, { active: event.target.checked })
                  }
                  className="size-5 accent-[#2b9188]"
                  disabled={pending}
                />
                {copy.common.active}
              </label>
              <button
                type="button"
                title={copy.governance.removeLevel}
                onClick={() =>
                  setLevels((current) =>
                    current.filter((entry) => entry.id !== level.id),
                  )
                }
                className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-xs font-semibold text-[#b84e42] hover:bg-[#f8ecea] disabled:opacity-50"
                disabled={pending}
              >
                <Trash2 className="size-4" />
                {copy.common.remove}
              </button>
            </div>
          ))}
        </div>

        <div className="hidden w-full min-w-0 max-w-full overflow-x-auto md:block">
          <table className="w-full min-w-[980px] table-fixed text-left">
            <thead>
              <tr className="border-b border-[#e8ebee] text-[10px] font-bold uppercase text-[#71808b]">
                <th className="w-16 px-2 py-2">{copy.governance.position}</th>
                <th className="w-64 px-2 py-2">{copy.governance.nameAndDescription}</th>
                <th className="w-36 px-2 py-2">{copy.governance.pointsFrom}</th>
                <th className="w-40 px-2 py-2">{copy.governance.icon}</th>
                <th className="w-24 px-2 py-2">{copy.governance.color}</th>
                <th className="w-20 px-2 py-2 text-center">{copy.common.active}</th>
                <th className="w-12 px-2 py-2">
                  <span className="sr-only">{copy.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {orderedLevels.map((level) => (
                <tr key={level.id}>
                  <td className="px-2 py-2">
                    <input
                      aria-label={copy.governance.positionFor(level.name)}
                      type="number"
                      min={1}
                      max={100}
                      value={level.position}
                      onChange={(event) =>
                        updateLevel(level.id, {
                          position: Number(event.target.value),
                        })
                      }
                      className={inputClassName}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="space-y-2">
                      <input
                        aria-label={copy.governance.levelName}
                        value={level.name}
                        maxLength={160}
                        onChange={(event) =>
                          updateLevel(level.id, { name: event.target.value })
                        }
                        className={inputClassName}
                        disabled={pending}
                      />
                      <input
                        aria-label={copy.governance.descriptionFor(level.name)}
                        value={level.description}
                        maxLength={5000}
                        placeholder={copy.common.description}
                        onChange={(event) =>
                          updateLevel(level.id, {
                            description: event.target.value,
                          })
                        }
                        className={inputClassName}
                        disabled={pending}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      aria-label={copy.governance.thresholdFor(level.name)}
                      type="number"
                      min={0}
                      max={2_147_483_647}
                      value={level.minPoints}
                      onChange={(event) =>
                        updateLevel(level.id, {
                          minPoints: Number(event.target.value),
                        })
                      }
                      className={inputClassName}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      aria-label={copy.governance.iconFor(level.name)}
                      value={level.icon}
                      maxLength={60}
                      onChange={(event) =>
                        updateLevel(level.id, { icon: event.target.value })
                      }
                      className={inputClassName}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      aria-label={copy.governance.colorFor(level.name)}
                      type="color"
                      value={level.color}
                      onChange={(event) =>
                        updateLevel(level.id, { color: event.target.value })
                      }
                      className="h-10 w-full cursor-pointer rounded-md border border-[#dfe4e8] bg-white p-1"
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      aria-label={copy.governance.activeNamed(level.name)}
                      type="checkbox"
                      checked={level.active}
                      onChange={(event) =>
                        updateLevel(level.id, { active: event.target.checked })
                      }
                      className="size-5 accent-[#2b9188]"
                      disabled={pending}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      title={copy.governance.removeLevel}
                      aria-label={copy.governance.removeNamed(level.name)}
                      onClick={() =>
                        setLevels((current) =>
                          current.filter((entry) => entry.id !== level.id),
                        )
                      }
                      className="inline-grid size-9 place-items-center rounded-md text-[#b84e42] hover:bg-[#f8ecea] disabled:opacity-50"
                      disabled={pending}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!levels.length ? (
          <p className="py-6 text-center text-sm text-[#71808b]">
            {copy.governance.emptyLevels}
          </p>
        ) : null}
        <div className="mt-4 flex min-h-10 flex-wrap items-center justify-between gap-3 border-t border-[#e8ebee] pt-4">
          <ActionMessage state={state} locale={locale} />
          <Button type="submit" className="ml-auto" disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy.governance.saveLevels}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function CommunityGovernanceSettings({
  data,
  locale,
}: {
  data: CommunityGovernanceAdminDto;
  locale: AppLocale;
}) {
  return (
    <div className="grid min-w-0 gap-6">
      <ModerationSettings policies={data.policies} locale={locale} />
      <LevelSettings configuration={data.levelConfiguration} locale={locale} />
    </div>
  );
}
