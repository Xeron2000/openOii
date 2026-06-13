import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("tldraw", () => ({
  useEditor: vi.fn(() => ({
    getCurrentToolId: () => "select",
    getZoomLevel: () => 1,
    setCurrentTool: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomToFit: vi.fn(),
    resetZoom: vi.fn(),
    getViewportScreenCenter: () => ({ x: 400, y: 300 }),
  })),
  track: vi.fn(<T,>(component: T) => component),
}));

import { CanvasToolbar } from "./CanvasToolbar";

describe("CanvasToolbar", () => {
  it("renders toolbar buttons", () => {
    render(<CanvasToolbar />);
    expect(screen.getByLabelText("选择工具")).toBeInTheDocument();
    expect(screen.getByLabelText("抓手工具")).toBeInTheDocument();
    expect(screen.getByLabelText("缩小")).toBeInTheDocument();
    expect(screen.getByLabelText("放大")).toBeInTheDocument();
    expect(screen.getByLabelText("重置缩放")).toBeInTheDocument();
    expect(screen.getByLabelText("适应视图")).toBeInTheDocument();
  });

  it("shows zoom percentage", () => {
    render(<CanvasToolbar />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<CanvasToolbar className="custom" />);
    expect(container.firstChild).toHaveClass("custom");
  });

  it("keeps the toolbar constrained on narrow viewports", () => {
    const { container } = render(<CanvasToolbar projectId={123} />);
    expect(container.firstChild).toHaveClass(
      "max-w-[calc(100vw-1rem)]",
      "flex-wrap",
      "justify-center",
    );
  });
});
