import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERNAL_PROFILE, PROFILES, STRUCTURE_PROFILE, profileNeedsLocalOccurrences } from "../src/core/views";

test("only occurrence-aware views block on Local Model hydration", () => {
  assert.equal(profileNeedsLocalOccurrences(INTERNAL_PROFILE), true);
  assert.equal(profileNeedsLocalOccurrences(STRUCTURE_PROFILE), true);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Interfaces), true);
  assert.equal(profileNeedsLocalOccurrences(PROFILES["Where Used"]), true);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Requirements), true);

  assert.equal(profileNeedsLocalOccurrences(PROFILES.Functional), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Design), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Verification), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Scenario), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Behavior), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES["Failure and risk"]), false);
  assert.equal(profileNeedsLocalOccurrences(PROFILES.Evidence), false);
});
