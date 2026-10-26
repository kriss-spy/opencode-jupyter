# T006 — Documentation and release validation

Priority: P1. Status: 0.2.1 published; manual coverage follow-ups pending. Dependencies: T002–T005.

- [x] Update README/config examples, migration, startup/reconnect and WSL/SSH placement.
- [x] 0.2.1 changelog/package/lock/server versions; bundled VSIX and package content check.
- [x] CI for baseline, transport, adapter and extension-host tests with minimum/current VS Code.
- [x] Record actual OpenCode CLI parser/client verification and desktop/kernel checks.
- [x] Keep unverified platforms and published-source discrepancy visible in the release evidence.
- [x] Prepare consolidated release notes, installation/migration steps and publication commands in [the release record](../releases/0.2.1.md).
- [ ] Confirm execution with the user's real local and Colab kernels after reloading 0.2.1 (T010).
- [ ] Complete the remaining platform and user-workflow checks in the validation record.
- [x] Upload the exact verified 0.2.1 VSIX using `vsce` after the user authenticated the publisher.
- [x] Marketplace finishes verification: the publisher API now marks 0.2.1 Validated.

Acceptance: local artifact is reviewable and reproducible; release evidence distinguishes passed tests from pending desktop/WSL checks. The user explicitly requested publication while the remaining manual coverage was still pending; publication does not imply those checks passed.

Implementation and locally available checks are complete. The [validation record](../0.2.0-validation.md) lists passing versions, packaged evidence, and remaining real-Python/Colab/WSL/user-install/platform gates. 0.2.1 was uploaded on 2026-10-26 and subsequently passed Marketplace validation.
