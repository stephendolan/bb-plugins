// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusGlyph } from "./StatusGlyph";
import { StatusOrTime } from "./StatusSlot";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

afterEach(cleanup);

describe("StatusGlyph", () => {
  it("shows an in-progress workflow as a spinning loading indicator", () => {
    render(<StatusGlyph indicator="workflow" label="Workflow in progress" />);

    const indicator = screen.getByLabelText("Workflow in progress");
    expect(indicator.getAttribute("data-icon")).toBe("Loading");
    expect(indicator.classList.contains("animate-spin")).toBe(true);
  });

  it("shows a durable workflow as spinning even when the thread is otherwise idle", () => {
    const thread = {
      indicator: "none",
      indicatorLabel: null,
      updatedAt: 0,
    } as PluginSidebarThread;

    render(
      <StatusOrTime thread={thread} now={120_000} hasDurableWorkflow />,
    );

    const indicator = screen.getByLabelText("Workflow in progress");
    expect(indicator.getAttribute("data-icon")).toBe("Loading");
    expect(indicator.classList.contains("animate-spin")).toBe(true);
  });
});
