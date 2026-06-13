import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ConsistencyPanel } from "./ConsistencyPanel";
import { ApiError } from "~/types/errors";
import type { ConsistencyReportRead } from "~/types";

const getReportMock = vi.fn();
const getHistoryMock = vi.fn();
const triggerEvalMock = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();

vi.mock("~/services/api", () => ({
	consistencyApi: {
		getReport: (projectId: number) => getReportMock(projectId),
		getHistory: (projectId: number, limit?: number) =>
			getHistoryMock(projectId, limit),
		triggerEval: (projectId: number) => triggerEvalMock(projectId),
	},
}));

vi.mock("~/utils/toast", () => ({
	toast: {
		info: (...args: unknown[]) => toastInfo(...args),
		error: (...args: unknown[]) => toastError(...args),
	},
}));

vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
		<div data-testid="responsive-chart">{children}</div>
	),
	RadarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Radar: () => <div data-testid="radar" />,
	PolarGrid: () => <div />,
	PolarAngleAxis: () => <div />,
	PolarRadiusAxis: () => <div />,
	LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Line: () => <div data-testid="line" />,
	XAxis: () => <div />,
	YAxis: () => <div />,
	CartesianGrid: () => <div />,
	Tooltip: () => <div />,
	Legend: () => <div />,
}));

const missingReportError = new ApiError({
	code: "not_found",
	message: "No consistency report found",
	status: 404,
});

function buildReport(createdAt = "2026-06-13T00:00:03.000Z"): ConsistencyReportRead {
	return {
		id: 10,
		project_id: 16,
		overall_score: 88,
		created_at: createdAt,
		report_data: {
			project_id: 16,
			overall_score: 88,
			character_reports: [],
			evaluated_at: createdAt,
		},
	};
}

describe("ConsistencyPanel", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
		vi.clearAllMocks();
		getReportMock.mockRejectedValue(missingReportError);
		getHistoryMock.mockResolvedValue([]);
		triggerEvalMock.mockResolvedValue({ eval_id: 0, status: "processing" });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears the evaluating state after polling a fresh report", async () => {
		getReportMock
			.mockRejectedValueOnce(missingReportError)
			.mockResolvedValueOnce(buildReport());

		render(<ConsistencyPanel projectId={16} onClose={vi.fn()} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "开始评估" }));
			await Promise.resolve();
		});

		expect(triggerEvalMock).toHaveBeenCalledWith(16);
		expect(screen.getByRole("button", { name: "评估中..." })).toBeDisabled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(screen.getByRole("button", { name: "开始评估" })).toBeEnabled();
		expect(screen.getByText("88.0")).toBeInTheDocument();
		expect(toastInfo).toHaveBeenCalledWith({
			title: "评估已触发",
			message: "正在后台计算角色一致性，完成后将自动刷新",
			duration: 3000,
		});
	});

	it("clears pending polling when the panel unmounts", async () => {
		getReportMock.mockRejectedValue(missingReportError);
		const { unmount } = render(<ConsistencyPanel projectId={16} onClose={vi.fn()} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "开始评估" }));
			await Promise.resolve();
		});
		expect(triggerEvalMock).toHaveBeenCalledWith(16);

		unmount();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(getReportMock).toHaveBeenCalledTimes(1);
	});
});
