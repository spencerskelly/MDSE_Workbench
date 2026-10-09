# A-14 CI verification checkpoint — 2026-10-08/09

**Status:** PARTIAL; the BOM-specific tests and TypeScript typecheck pass, broad legacy suite still fails.

Repository: `spencerskelly/MDSE_Workbench`
Branch: `proposal/bom-a14-readonly-quantity-uom`
Latest code commit: `018e0460f00929274b7ccf7d08446e41be31a40a`
Workflow: `.github/workflows/bom-a14-verify.yml` (proposal branch only)
Run: https://github.com/spencerskelly/MDSE_Workbench/actions/runs/37872995204

## Actions this pass
1. Added isolated CI workflow to execute `npm ci`, `npm run typecheck`, focused BOM 0.6 tests, then full suite. No production merge.
2. First CI revealed missing `quantity` and `unitOfMeasure` on cached LocalRecord. Fixed `src/core/cache.ts` in commit `bfc358a0099207bd613beb41ffb7c96dfc869d49`, including compatibility for absent cached fields.
3. Focused test revealed incorrectly escaped numeric regex; fixed `src/core/localmodel.ts` in commit `018e0460f00929274b7ccf7d08446e41be31a40a`.
4. Isolated focused test in CI workflow via commit `2a285b1c67edbce59328a9c6ad666deb53acff30`.

## Verified CI run 37872995204
- `npm ci`: PASS.
- `npm run typecheck`: PASS.
- `node --import tsx --test test/bom-localmodel-06.test.ts`: PASS.
- Full historical `npm test`: FAIL — 448 tests, 359 pass, 89 fail. The failures include tests expecting Local Model 0.4 editing even though the forward branch writer is 0.5. The remaining failures have not been individually triaged; do not attribute all to baseline without comparison.
- CI job conclusion FAIL due to full-suite failures.

## Next bounded task
Triaging the 89 full-suite failures against `workbench/local-model-0.5`; isolate pre-existing compatibility drift versus newly introduced regressions. Reconcile the test baseline without enabling 0.6 writing, then proceed to `variantOf` reader validation. `variantOf` and Local Model 0.6 governing changes are still unapproved.
