import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { TenantFavicon } from "@/components/branding/tenant-favicon";
import { PlatformCustomCodeSlot } from "@/components/shared/platform-custom-code-slot";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { NativeRuntimeBridge } from "@/components/mobile/native-runtime-bridge";
import {
  canonicalTenantAuthOrigin,
  resolveRequestBranding,
} from "@/lib/branding";
import { brandingCssVariables } from "@/lib/branding-model";
import { assertRuntimeServerEnvironment } from "@/lib/server-environment";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { openGraphLocale } from "@/lib/i18n/model";
import { getNativeStartDestination } from "@/lib/mobile/start-destination";
import { getPlatformCustomCodeConfiguration } from "@/lib/platform-custom-code-service";
import "./globals.css";

assertRuntimeServerEnvironment();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveRequestBranding();
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get("host");
  const metadataBase = new URL(
    canonicalTenantAuthOrigin(
      branding,
      requestHost ? `http://${requestHost}` : null,
    ),
  );
  const description = branding.loginDescription;
  const images = branding.socialPreviewImageUrl
    ? [
        {
          url: branding.socialPreviewImageUrl,
          alt: branding.platformName,
        },
      ]
    : undefined;
  return {
    metadataBase,
    title: {
      default: branding.platformName,
      template: `%s | ${branding.platformName}`,
    },
    description,
    applicationName: branding.platformName,
    icons: { icon: branding.faviconUrl },
    openGraph: {
      type: "website",
      locale: openGraphLocale(locale),
      url: "/",
      siteName: branding.platformName,
      title: branding.platformName,
      description,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: branding.platformName,
      description,
      images: branding.socialPreviewImageUrl
        ? [branding.socialPreviewImageUrl]
        : undefined,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await resolveRequestBranding();
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: branding.primaryColor,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await resolveRequestBranding();
  const requestHeaders = await headers();
  const sandboxNonce = requestHeaders.get("x-nonce");
  const [locale, nativeStartDestination, customCode] = await Promise.all([
    getOrganizationDefaultLocale(branding.organizationId),
    getNativeStartDestination(branding.organizationId),
    getPlatformCustomCodeConfiguration(branding.organizationId),
  ]);
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      data-scroll-behavior="smooth"
      data-brand-font={branding.fontFamily}
      data-brand-radius={branding.cornerRadius}
      data-color-mode={branding.colorMode}
      style={brandingCssVariables(branding)}
    >
      <head>
        <link rel="icon" href={branding.faviconUrl} />
      </head>
      <body>
        <TenantFavicon href={branding.faviconUrl} />
        <ServiceWorkerRegistration />
        <NativeRuntimeBridge
          organizationId={branding.organizationId}
          startDestination={nativeStartDestination}
          urlScheme={process.env.MOBILE_APP_URL_SCHEME?.trim() || "qacademy"}
        />
        <PlatformCustomCodeSlot
          configuration={customCode}
          slot="header"
          locale={locale}
          nonce={sandboxNonce}
        />
        {children}
        <PlatformCustomCodeSlot
          configuration={customCode}
          slot="footer"
          locale={locale}
          nonce={sandboxNonce}
        />
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          theme={branding.colorMode}
        />
      </body>
    </html>
  );
}
