# Changelog

All notable changes to MyMilo Android are documented in this file.
The format follows Keep a Changelog. Published releases are the CI
`build-<run number>` tags on GitHub; the package version lives in
`package.json`.

This changelog starts at the current state of the repository.
Earlier history is in the git log and the `build-N` releases.

## [Unreleased]

- Documentation brought to the project's standard: added `NOTICE`,
  `CONTRIBUTING.md`, and this changelog; `README.md` gained Tests
  and License sections.

## [0.1.0] — current state

- Capacitor 6 shell (app id `org.aimlds.mymilo`) around a plain
  HTML/CSS/JS chat client in `www/` — no web build step.
- Connects to cloud MyMilo (v0.31.0+) with a device token; the
  server URL and token are stored on the device.
- Offline-first: messages queue locally while the network is down
  and flush when it returns; sessions sync from the server on
  startup and when connectivity comes back.
- CI (GitHub Actions) builds the debug APK on every push to `main`
  and publishes it in a `build-<run number>` release for
  sideloading.
