// Deliberately red (AC-7): the report must still be written and exit non-zero.
import { expect, test } from "vitest";

test("fixture passes alongside the red one", () => {
  expect(1 + 1).toBe(2);
});

test("deliberately red fixture test", () => {
  expect(1 + 1).toBe(3);
});
