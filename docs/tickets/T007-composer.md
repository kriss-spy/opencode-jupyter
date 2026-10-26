# T007 — OpenCode v2 draft integration (#1)

Priority: Later. Status: Deferred. Dependencies: supported upstream draft API.

The researched v2 public API has no verified equivalent to v1's `/tui/append-prompt`. Session prompt submission can execute input and does not satisfy unsent draft insertion. Do not silently substitute it.

Investigate a supported draft API, client discovery/authentication, explicit session targeting and remote hosts. A clipboard action would be a separate precursor, not completion of #1. Outside 0.2.0 implementation scope.
