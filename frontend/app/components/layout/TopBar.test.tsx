import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { TopBar } from "./TopBar";

vi.mock("react-router-dom", async () => {
	const actual = await vi.importActual<typeof import("react-router-dom")>(
		"react-router-dom",
	);
	return {
		...actual,
		Link: ({ children, to }: { children: ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: [
			{
				id: 16,
				title: "chrome-devtools-audit-20260613070939",
				status: "ready",
			},
		],
	}),
}));

vi.mock("~/stores/themeStore", () => ({
	useThemeStore: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("~/stores/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({ openModal: vi.fn() })),
}));

describe("TopBar", () => {
	it("constrains the project dropdown and labels icon buttons on mobile", () => {
		const { container } = render(
			<TopBar
				projectId={16}
				onToggleAssets={vi.fn()}
				onToggleHistory={vi.fn()}
			/>,
		);

		expect(container.querySelector("header")).toHaveClass("px-2", "gap-2");
		expect(container.querySelector('button[aria-haspopup="true"]')).toHaveClass(
			"max-w-[120px]",
			"sm:max-w-[180px]",
		);
		expect(screen.getByRole("button", { name: "资产库" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "对话历史" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "切换暗色" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
	});
});
