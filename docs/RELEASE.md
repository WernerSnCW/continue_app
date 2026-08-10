# Releasing Continue?

## What the keystore is

Android refuses to install an app that isn't cryptographically signed, and Play
uses the signature to decide whether an upload is really from you. A **keystore**
is the encrypted file holding the private key that does that signing. It is a
file plus two passwords — one for the file, one for the key inside it.

Play separates this into two keys, which is what makes the risk manageable:

| Key | Held by | If lost |
|---|---|---|
| **App signing key** | Google, via Play App Signing | Not your problem — Google holds it |
| **Upload key** | You, in the keystore below | Recoverable: request an upload key reset in Play Console |

You sign the AAB with your **upload key**. Play verifies it, strips your
signature, and re-signs with the app signing key it holds before shipping to
devices. Play App Signing is mandatory for apps first published after August
2021, so this is the path.

This means losing the upload key is an inconvenience, not the end of the
listing — but it is still a support round trip and a new key to distribute, so
back it up properly.

## Generating the upload key

Run this **once**. It is the one step that cannot be automated here, because it
sets passwords.

Pick a location **outside the repository** — a keystore committed to a public
repo lets anyone sign a build Play will accept as yours. Something like
`C:\keys\` is fine.

```
mkdir C:\keys
& "C:\Program Files\Java\jdk-21\bin\keytool.exe" -genkeypair -v -keystore C:\keys\continue-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` prompts for:

- **Keystore password** — protects the file
- **Key password** — protects the key inside it; pressing Enter reuses the
  keystore password, which is normal and fine
- **Name / organisation / locality** — these end up in the certificate but Play
  shows none of it to users. `Quiet Foundry` for the organisation is plenty; the
  rest can be blank
- **Confirmation** — type `yes`

`-validity 10000` is roughly 27 years. Play requires a key valid past 22 October
2033, so do not shorten it.

**Store both passwords in your password manager now**, alongside a copy of the
`.jks` file itself. If the disk dies and the passwords are only in your head,
the key is gone.

## Pointing the build at it

Create `apps/mobile/android/keystore.properties` — gitignored, never committed:

```properties
storeFile=C:\\keys\\continue-upload.jks
storePassword=<keystore password>
keyAlias=upload
keyPassword=<key password>
```

Backslashes are doubled because this is a Java properties file. A relative path
works too and resolves against `apps/mobile/android/`.

For CI, set `CONTINUE_KEYSTORE_FILE`, `CONTINUE_KEYSTORE_PASSWORD`,
`CONTINUE_KEY_ALIAS` and `CONTINUE_KEY_PASSWORD` instead; environment variables
take precedence over the file.

## Building a release

```
pnpm --filter @continue/mobile build
pnpm --filter @continue/mobile cap:sync
cd apps/mobile/android
./gradlew bundleRelease
```

The AAB lands at `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`.

`bundleRelease` and `assembleRelease` both fail immediately if the signing config
is missing or the keystore file cannot be found. That is deliberate: without the
check, Gradle silently falls back to the debug key and produces an artifact Play
rejects *after* the upload rather than during the build.

Debug builds need none of this and are unaffected.

## Before uploading

- Confirm `VITE_MOCK_PURCHASE` is **not** `1` in `apps/mobile/.env`, or the
  paywall grants the unlock for free.
- Bump `versionCode` in `apps/mobile/android/app/build.gradle`. Play rejects a
  re-used `versionCode`, and it must increase on every upload.
- Run `pnpm check` at the root.
