---
'@e2e-dev/mobile': patch
'e2e': patch
---

`device.installApp()` no longer pins the build's file path as the app when agent-device reports no bundle id or package for it, which on Android made `app.open()` fail with "Android runtime hints require an installed package name". It fails at the install with `ENGINE_FAILURE` naming `app.bundleId` or installApp's `app` option; the mobile docs' Troubleshooting covers the Android cause (agent-device 0.21.18 reads an aapt2-built APK's package only through the SDK's `aapt`, which it does not find in the macOS default SDK location, or when the install added the package). `app.open()` on a device now keeps the engine's own reason it cannot launch, such as a build not installed yet with `device.installApp()`, instead of a generic "pin one with app.bundleId or app.appPath".
