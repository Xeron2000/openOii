import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomePage } from "./HomePage";

const mockMutate = vi.fn();
let mockIsPending = false;

vi.mock("~/services/api", () => ({
  projectsApi: { create: vi.fn() },
  universesApi: {
    list: vi.fn(() =>
      Promise.resolve([
        {
          id: 12,
          name: "测试宇宙",
          description: null,
          world_setting: null,
          style_rules: null,
          cover_image_url: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          projects_count: 2,
          shared_characters_count: 1,
        },
      ]),
    ),
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useMutation: vi.fn(() => ({
      mutate: mockMutate,
      isPending: mockIsPending,
    })),
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  };
});

vi.mock("~/stores/themeStore", () => ({
  useThemeStore: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("~/stores/settingsStore", () => ({
  useSettingsStore: vi.fn(() => ({ openModal: vi.fn() })),
}));

function renderHomePage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockIsPending = false;
  });

  it("renders title and textarea", () => {
    renderHomePage();
    expect(screen.getAllByText("openOii").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("输入你的故事创意")).toBeInTheDocument();
  });

  it("submits story on button click", async () => {
    renderHomePage();
    const textarea = screen.getByLabelText("输入你的故事创意");
    fireEvent.change(textarea, { target: { value: "My story" } });
    fireEvent.click(screen.getByRole("button", { name: "生成并进入画布" }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ story: "My story" })
    );
  });

  it("submits selected universe as a new chapter", async () => {
    renderHomePage();
    await screen.findByRole("option", { name: /测试宇宙/ });
    const universeSelect = screen.getByLabelText("选择 IP 宇宙");
    fireEvent.change(universeSelect, { target: { value: "12" } });
    await waitFor(() => expect(universeSelect).toHaveValue("12"));
    const textarea = screen.getByLabelText("输入你的故事创意");
    fireEvent.change(textarea, { target: { value: "月台信号灯异常" } });
    fireEvent.click(screen.getByRole("button", { name: "生成并进入画布" }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        universe_id: 12,
        chapter_number: 3,
        chapter_title: "月台信号灯异常",
      }),
    );
  });

  it("submits on Enter key", () => {
    renderHomePage();
    const textarea = screen.getByLabelText("输入你的故事创意");
    fireEvent.change(textarea, { target: { value: "story" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockMutate).toHaveBeenCalled();
  });

  it("does not submit on Shift+Enter", () => {
    renderHomePage();
    const textarea = screen.getByLabelText("输入你的故事创意");
    fireEvent.change(textarea, { target: { value: "story" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("disables button when empty", () => {
    renderHomePage();
    expect(screen.getByRole("button", { name: "生成并进入画布" })).toBeDisabled();
  });

  it("shows remaining char count near limit", () => {
    renderHomePage();
    const textarea = screen.getByLabelText("输入你的故事创意");
    fireEvent.change(textarea, { target: { value: "a".repeat(4600) } });
    expect(screen.getByText(/400/)).toBeInTheDocument();
  });
});
