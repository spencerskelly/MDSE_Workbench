# A-14 — Baseline CI failure attribution

## Result
The untouched Workbench 0.5 baseline and A-14 proposal have identical sets of **89 failing test names**.

| Metric | Untouched 0.5 | A-14 proposal |
|---|---:|---:|
| Test count | 443 | 448 |
| Passed | 354 | 359 |
| Failed | 89 | 89 |
| Typecheck | PASS | PASS |

The A-14 proposal has five additional tests, and each passes. This run showed **zero new failing test names** relative to the baseline. The 89 historical failures remain an independent blocker for declaring the full suite green.

## Reproducibility
- Repo: `spencerskelly/MDSE_Workbench`
- Baseline source: `workbench/local-model-0.5`
- Isolated baseline CI branch: `proposal/bom-a14-baseline-check`
- Baseline workflow commit: `2667965cdff6e2db8cf3129fdd0b50d4f9fd8d04`
- Baseline Actions run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37873115974
- Proposal branch: `proposal/bom-a14-readonly-quantity-uom`
- Proposal Actions run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37872995204
- Comparison: failing test names from GitHub workflow job logs, baseline job 113635436931 vs. proposal job 113635054041.
- Result: 89 shared, zero new in proposal, zero baseline-only.

## Interpretation and limitations
- This is a full named-failure comparison, not a repair of the 89 baseline failures.
- The current branch's `WRITABLE_VERSION` remains 0.5; Local Model 0.6 support remains read-only.
- `variantOf` endpoint and graph validation has not yet been implemented.
- No merge to main was performed.

## Next bounded unit
Start A-14 Object `variantOf` read-only validation tests on the proposal branch; keep governance approval as an explicit dependency. The older-suite 0.4-to-0.5 drift should be triaged as a separate stabilization workstream.
