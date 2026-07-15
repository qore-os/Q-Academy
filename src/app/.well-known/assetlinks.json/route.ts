import { NextResponse } from "next/server";

import {
  androidAssetLinks,
  mobileAssociationConfiguration,
} from "@/lib/mobile/association";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = mobileAssociationConfiguration(process.env);
  if (!configuration.androidCertificateFingerprints.length) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(
    androidAssetLinks(
      configuration.androidPackageName,
      configuration.androidCertificateFingerprints,
    ),
    {
      headers: {
        "Cache-Control": "public, max-age=3600, must-revalidate",
        "Content-Type": "application/json",
      },
    },
  );
}
