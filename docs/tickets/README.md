# 0.2.x local tickets

Source: [release plan](../0.2.0-plan.md). The implementation is consolidated into [0.2.1](../releases/0.2.1.md); Marketplace upload and verification are complete; remaining manual checks are tracked in T006.

GitHub triage on 2026-10-26: [#2](https://github.com/kriss-spy/opencode-jupyter/issues/2) and [#4](https://github.com/kriss-spy/opencode-jupyter/issues/4) are closed as completed, with implementation evidence and publication-pending notes. #1 remains deferred; #3 remains the open project map.

| Ticket | Priority | Status | Scope |
| --- | --- | --- | --- |
| [T001](T001-baseline.md) | P0 | Done | Release base, SDK/runtime choice, reproducible build/test/package |
| [T002](T002-transport.md) | P0 | Done | Native Streamable HTTP, legacy sessions, local endpoint protections |
| [T003](T003-lifecycle.md) | P0 | Done | Serialized lifecycle, v2/v1 config, notebook activation and remote placement |
| [T004](T004-notebooks.md) | P0 | Done | Targeting, edits, fresh execution, kernel capability reporting |
| [T005](T005-cell-tools.md) | P1 | Done | Targeted cell inspection, bounded MIME-aware output |
| [T006](T006-release.md) | P1 | Published; manual coverage follow-ups pending | Documentation, CI, packaged validation and release evidence |
| [T007](T007-composer.md) | Later | Deferred | Supported OpenCode v2 draft integration investigation (#1) |
| [T008](T008-profile-installation.md) | P0 | Done | Correct active AI-profile installation and `d2l` configuration |
| [T009](T009-opencode-reconnect.md) | P0 | Done | Reconnect an existing OpenCode daemon after correcting the endpoint |
| [T010](T010-historical-execution-count.md) | P0 | Done; manual kernel checks in T006 | Allow execution of notebook cells with saved counts and no success metadata |

Update each ticket with implementation evidence and unresolved validation. Passing local tests does not imply the full desktop/WSL release matrix passed. Public publishing is a separate release action.
