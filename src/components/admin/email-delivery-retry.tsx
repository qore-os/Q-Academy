"use client";

import { useActionState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  retryEmailDeliveryAction,
  type EmailCenterActionState,
} from "@/lib/email-center-actions";
import { getEmailDeliveryCopy } from "@/lib/i18n/email-delivery";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: EmailCenterActionState = { ok: null, message: "" };

export function EmailDeliveryRetry({
  deliveryId,
  locale,
}: {
  deliveryId: string;
  locale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    retryEmailDeliveryAction,
    initialState,
  );
  const copy = getEmailDeliveryCopy(locale);
  const message = state.messageCode
    ? copy.messages[state.messageCode]
    : state.ok === null
      ? null
      : copy.messages["emailDelivery.retryFailed"];

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="secondary" disabled={pending || state.ok === true}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {pending ? copy.retry.pending : copy.retry.submit}
      </Button>
      {message ? (
        <p
          role="status"
          className={`max-w-72 text-xs leading-5 ${state.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
