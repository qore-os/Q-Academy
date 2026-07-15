"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/lib/i18n/model";
import { getCertificateCopy } from "@/lib/i18n/certificates";

export function PrintCertificateButton({ locale }: { locale: AppLocale }) {
  const copy = getCertificateCopy(locale).document;
  return (
    <Button
      type="button"
      variant="navy"
      onClick={() => window.print()}
      className="certificate-no-print"
    >
      <Printer className="size-4" />
      {copy.print}
    </Button>
  );
}
