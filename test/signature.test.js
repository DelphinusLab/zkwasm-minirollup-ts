import assert from "node:assert";
import { test } from "node:test";
import { createCommand, sign } from "zkwasm-minirollup-rpc";
import {
  signatureToU64ArrayCompat,
  signatureToU64ArrayFast,
} from "../src/signature.js";

test("signatureToU64ArrayFast matches compat parser", () => {
  const cmd = createCommand(1n, 0n, [0n, 0n, 0n, 0n]);
  const payload = sign(cmd, "1234567");

  const compat = signatureToU64ArrayCompat(payload);
  const fast = signatureToU64ArrayFast(payload);

  assert.deepStrictEqual(Array.from(fast), Array.from(compat));
});

