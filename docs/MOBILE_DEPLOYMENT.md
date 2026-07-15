# Native Mobile Deployment

Q-Academy ships a Capacitor 8 container for Android, iPhone and iPad. The
container loads the deployed tenant application over HTTPS because the Next.js
application requires its PostgreSQL-backed server runtime. Browser PWA and Web
Push remain available independently.

## Build contract

1. Configure `CAPACITOR_SERVER_URL` with the canonical HTTPS Academy origin.
2. Configure the visible `MOBILE_APP_NAME` and `MOBILE_APP_BUNDLE_ID`
   consistently in Capacitor, Apple, Firebase
   and the root-server environment. Gradle consumes it directly; the mobile
   configuration step writes the same value into the Xcode release config.
3. Set a tenant-specific `MOBILE_APP_URL_SCHEME`, the canonical hostname as
   `MOBILE_ASSOCIATED_DOMAIN`. The generated Xcode release config and Android
   manifest placeholders consume both values.
4. Set monotonically increasing `MOBILE_BUILD_NUMBER` and semantic
   `MOBILE_VERSION`. Gradle and the generated Xcode release config consume
   them directly.
5. Add the Android signing certificate SHA-256 fingerprints to
   `ANDROID_APP_SHA256_CERT_FINGERPRINTS`.
6. Configure `APPLE_TEAM_ID` and set `ACADEMY_ASSOCIATED_DOMAIN` in the Xcode
   target to the same hostname.
7. Place Firebase's untracked `google-services.json` in `android/app/` and
   enable APNs Push Notifications plus Associated Domains for the iOS App ID.
8. Configure the FCM service account and APNs `.p8` values only in the server
   secret store. They never belong in either mobile binary.
9. Provide the Android keystore path, alias and passwords through
   `ANDROID_KEYSTORE_PATH`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`
   and `ANDROID_KEY_PASSWORD`. These values are consumed only by the release
   Gradle build and must remain in the CI secret store.

The server exposes `/.well-known/assetlinks.json` and
`/.well-known/apple-app-site-association` only when the corresponding signing
values are valid. Native route associations, Android intent filters and the
runtime accept only `/academy`, `/academy/*`, `/login` and `/login/*` routes.

## Commands

```bash
npm run mobile:configure
npm run mobile:sync
npm run mobile:preflight
npm run mobile:preflight:android
npm run mobile:preflight:ios
npm run mobile:android
npm run mobile:ios
```

`mobile:sync` also regenerates `ios/release.xcconfig`; `mobile:configure`
provides the same deterministic step without running Capacitor. The iOS
Release target uses that file as its base build configuration, and preflight
rejects stale values before an archive is created.

Android requires the JDK/Android SDK supported by Capacitor 8. iOS archives
must be produced on macOS with Xcode. Store signing, privacy declarations,
customer-provided icon/splash/store artwork, screenshots, review accounts and
Apple/Google review are external release gates and cannot be completed by the
local repository.

The release preflight fails closed when the HTTPS origin, associated domain,
bundle identifier, custom URL scheme, Firebase project/package, APNs topic,
production mode, version or signing inputs drift apart. It also verifies the
Android hardening flags and that the iOS privacy manifest is part of the
native project. A passing preflight validates repository and credential shape;
it does not replace a signed real-device archive or store review.

Native device tokens are encrypted and bound to the authenticated tenant,
user and session. Logout removes the binding. Notifications use a durable,
retryable queue and open only validated `/academy` or `/login` paths. On native
resume the bridge reconciles the current session, OS permission and provider
configuration, re-registers an opted-in device to capture APNs/FCM token
rotation, and removes a stale server binding after OS permission is revoked.
Foreground notifications refresh the current server-rendered view without
forcing an unsolicited navigation.

Owner und Administratoren waehlen unter `Einstellungen -> App-Start`, ob ein
normaler nativer Kaltstart das Dashboard oder die Community oeffnet. Der
Capacitor-Bridge prueft zuvor `App.getLaunchUrl()` und markiert den Start pro
WebView-Sitzung genau einmal. Explizite Universal-/Deep-Links und validierte
Push-Ziele haben deshalb Vorrang und werden nicht durch das Tenant-Standardziel
ueberschrieben.
