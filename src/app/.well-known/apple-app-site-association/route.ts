import { NextResponse } from "next/server";

import {
  appleAppSiteAssociation,
  mobileAssociationConfiguration,
} from "@/lib/mobile/association";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = mobileAssociationConfiguration(process.env);
  if (!configuration.appleAppId) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(appleAppSiteAssociation(configuration.appleAppId), {
    headers: {
      "Cache-Control": "public, max-age=3600, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}
