import { test } from "node:test";
import assert from "node:assert/strict";
import { localIdentitySet, preservedLocalIdentities } from "../src/core/local-identity";
import { parseLocalModel } from "../src/core/localmodel";

const text = (heading: string, id: string) => [
  "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
  "### Part Occurrences",
  "#### " + heading,
  "- definition: [[Board]]",
  "^" + id,
  "<!-- MDSE:LOCAL-MODEL END -->",
].join("\n");

test("incremental content changes preserve authored occurrence identity", () => {
  const id = "part-20261003170000002skellyspencer";
  const before = parseLocalModel(text("Board", id));
  const after = parseLocalModel(text("Renamed Board", id));
  assert.deepEqual(localIdentitySet(before), [id]);
  assert.deepEqual(localIdentitySet(after), [id]);
  assert.deepEqual(preservedLocalIdentities(before, after), [id]);
});

test("an authored ID change is treated as an identity change, not silently preserved", () => {
  const a = "part-20261003170000002skellyspencer";
  const b = "part-20261003170000003skellyspencer";
  assert.deepEqual(preservedLocalIdentities(parseLocalModel(text("Board", a)), parseLocalModel(text("Board", b))), []);
});
