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

## Known gaps

- **macOS builds are arm64 only.** GitHub's `macos-latest` runner is Apple
  Silicon and no explicit target arch is set, so Intel Macs are not covered.
  Adding them means either a `universal` target or an extra matrix entry on
  `macos-13`, at the cost of build time.
- **Windows builds are unsigned**, so SmartScreen warns on first run. That needs
  a separate code-signing certificate.
