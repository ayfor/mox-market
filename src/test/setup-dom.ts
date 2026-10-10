// Component-project setup (S1.1d4): jest-dom matchers and RTL cleanup.
// No vitest globals, so RTL's auto-cleanup does not register itself.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
