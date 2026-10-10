// T13 (AC-9): *.test.tsx runs in jsdom with RTL and jest-dom matchers.
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

describe("component environment", () => {
  test("RTL renders into jsdom and jest-dom matchers are registered", () => {
    render(<p>ok</p>);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  test("window and document exist", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
  });

  test("cleanup runs between tests, so the previous render is gone", () => {
    expect(screen.queryByText("ok")).not.toBeInTheDocument();
  });
});
