# Releasing

Releases are cut by pushing a `v*` tag. `.github/workflows/release.yml` then
creates a draft release, builds macOS / Windows / Linux artifacts, uploads them,
and finally publishes the release.

```bash
# on main, with package.json already bumped and merged
git tag v0.5.0
git push origin v0.5.0
```

## macOS signing and notarization

The macOS build is signed with a **Developer ID Application** certificate and
notarized with an **App Store Connect API key**. Both are optional: without the
secrets the build still succeeds, but produces an ad-hoc signed app that users
must right-click → Open (see `build/afterSign.cjs`).

### Required GitHub secrets

| Secret              | What it is                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `CSC_LINK`          | base64 of the exported `.p12` Developer ID Application certificate |
| `CSC_KEY_PASSWORD`  | the password set when exporting the `.p12`                         |
| `APPLE_API_KEY_B64` | base64 of the `AuthKey_XXXXXXXXXX.p8` file                         |
| `APPLE_API_KEY_ID`  | the key ID, e.g. `2X9R4HXF34`                                      |
| `APPLE_API_ISSUER`  | the issuer UUID from App Store Connect                             |

They are scoped to the macOS runner in the workflow. `CSC_LINK` is _not_
platform-specific in electron-builder, so passing it to the Windows runner would
make it try to sign the installer with a macOS certificate.

### The G2 intermediate

Developer ID certificates issued by the **G2** sub-CA chain through an
intermediate that ships with neither macOS nor electron-builder. Without it,
`codesign` cannot build the chain and the identity is unusable — the symptom is:

```
$ security find-identity -v -p codesigning
     0 valid identities found

$ security find-identity -p codesigning      # without -v
  1) ABC123... "Developer ID Application: … (TEAMID)"
     1 identities found
```

That is, the identity exists but isn't _valid_. Note that `security verify-cert`
is misleading here — it succeeds, because it fetches the missing intermediate
over the network, which `codesign` does not do.

Install it once on any machine that signs locally:

```bash
curl -fsSLO https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
security import DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db
```

The release workflow does the same on the macOS runner.

### Creating the certificate

1. In Xcode: **Settings → Accounts → Manage Certificates → + → Developer ID
   Application**. (Or create a CSR in Keychain Access and upload it at
   [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).)
2. In **Keychain Access**, find the _Developer ID Application: …_ certificate,
   expand it so the private key is included, right-click → **Export** → `.p12`,
   and set a strong password.
3. Convert and store it — never paste the file contents anywhere but `gh`:

   ```bash
   base64 -i DeveloperID.p12 | gh secret set CSC_LINK --repo xetorthio/ambora
   gh secret set CSC_KEY_PASSWORD --repo xetorthio/ambora   # prompts, input hidden
   ```

### Creating the App Store Connect API key

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and
   Access → Integrations → App Store Connect API → Team Keys**.
2. Generate a key with the **Developer** role. Download the `.p8` — Apple only
   lets you download it once.
3. Note the **Key ID** (in the table) and the **Issuer ID** (above it).

   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set APPLE_API_KEY_B64 --repo xetorthio/ambora
   gh secret set APPLE_API_KEY_ID --repo xetorthio/ambora
   gh secret set APPLE_API_ISSUER --repo xetorthio/ambora
   ```

Delete the local `.p12` and `.p8` afterwards, or store them in a password
manager. Neither can be re-downloaded from Apple.

### Verifying a release

The workflow prints the signing authority and runs `spctl --assess` on the built
app. In the macOS job log, look for:

```
Authority=Developer ID Application: <your name> (<team id>)
Gatekeeper accepted the app — signed and notarized
```

A `Gatekeeper rejected the app` warning means notarization did not happen — the
build is still uploaded, so check it before announcing the release.

To verify a downloaded artifact by hand:

```bash
spctl --assess --type execute --verbose=4 /Applications/Ambora.app
xcrun stapler validate /Applications/Ambora.app
```

## macOS architectures

Apple Silicon and Intel are built as **separate matrix jobs**, both on
`macos-latest` — electron-builder cross-builds and signs the x64 app there
happily. They are split so their notarization submissions queue at Apple in
parallel; building both in one job serialises them, and the wait is measured in
hours.

Every macOS artifact therefore carries its architecture:

```
Ambora-<version>-arm64-mac.zip    ambora-<version>-arm64.dmg
Ambora-<version>-x64-mac.zip      ambora-<version>-x64.dmg
```

Without `${arch}` in the artifact names the two jobs would emit identically named
files and the second upload would silently clobber the first.

## Timeouts

Each build job has a `timeout-minutes`, bounding a stuck job well below GitHub's
6-hour default. macOS gets 240 because notarization genuinely waits on Apple —
the v0.5.0 submission took **2h28m**, so a tighter limit would kill legitimate
releases. Windows and Linux get 30; both normally finish in about five minutes.

`fail-fast: false` means one platform failing doesn't cancel the others.

## Known gaps

- **`latest-mac.yml` is written by both macOS jobs**, so whichever uploads last
  wins and the file describes only that architecture. Harmless today — nothing
  consumes it, as the app has no auto-updater. It would need fixing before
  adding `electron-updater`.
- **The `.dmg` is not itself signed or stapled** — only the `.app` inside it is.
  electron-builder notarizes the app, then packs the stapled app into the disk
  image. Gatekeeper assesses the app on launch, so this is cosmetic, but a
  quarantined DMG can show an extra prompt on mount and can't be verified
  offline. Fixing it means a second notarization submission per release.
- **Windows builds are unsigned**, so SmartScreen warns on first run. That needs
  a separate code-signing certificate.
