// Fails at import, so the suite has zero assertions (C3.2): the report must
// not call this green.
import { expect, test } from "vitest";
// @ts-expect-error the module does not exist on purpose
import { missing } from "./does-not-exist";

test("never collected", () => {
  expect(missing).toBeDefined();
});
