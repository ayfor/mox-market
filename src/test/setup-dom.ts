// Component-project setup (S1.1d4): jest-dom matchers and RTL cleanup.
// No vitest globals, so RTL's auto-cleanup does not register itself.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver, and Headless UI's Combobox observes its input
// and options while open (S2.1's CardCombobox). A no-op stand-in suffices:
// tests assert behaviour, not layout.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
