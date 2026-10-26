# T010 — Saved execution counts incorrectly block notebook execution

Priority: P0. Status: Implementation done and 0.2.1 installed; manual kernel validation tracked in T006.

## Observed failure

The affected real OpenCode session called `jupyter_run_cell` on the open `convexity.ipynb` and received `Cell has an incomplete prior execution summary. Wait for it to complete before requesting another run.` immediately, for both selected Colab and local kernels.

Read-only MCP inspection showed the existing code cells had summaries `{executionOrder: 1}`, `{executionOrder: 2}`, and `{executionOrder: 3}`. These are saved notebook execution counts without a provider success field. The bridge rejected them before dispatching any execution command, independently of the selected kernel.

## Regression seam and fix

`node --test --test-name-pattern='persisted execution order' test/notebooks.test.cjs` first failed with that exact error. The test supplies the same historical summary, then emits a genuine fresh start/completion for the requested run.

Remove the inference that a missing historical `success` field means execution is in progress. Retain per-notebook request serialization, post-dispatch start/completion correlation, protection against accepting an old in-flight run's completion, uncertainty tracking after timeout, and pre-dispatch cancellation guards.

The VS Code extension-host fixture now begins with a restored execution count and checks it before editing/executing. This covers reopening real notebooks rather than only brand-new cells.

- [x] Reproduce the actual error and minimize it into a failing regression.
- [x] Fix historical-state inference; all 22 focused tests pass.
- [x] Pass current/minimum VS Code host workflows with the historical-count fixture (1.143.1 / Jupyter 2025.9.1, and 1.90.0 / Jupyter 2024.5.0).
- [x] Build/verify 0.2.1 VSIX and install it into the affected AI profile and the default profile. CLI confirms AI has 0.2.1.
- [ ] Reload the user window, reconnect OpenCode and verify execution against the actual selected kernel.

This corrects the overly conservative execution guard added during the 0.2.0 review. Historical summaries cannot establish current running state in either direction; only fresh events can establish the result of a new request.
