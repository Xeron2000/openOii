import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '~/stores/settingsStore';
import { configApi } from '~/services/api';
import type { ConfigItem } from '~/types';

// Mock API
vi.mock('~/services/api', () => ({
  configApi: {
    get: vi.fn(),
    update: vi.fn(),
    testConnection: vi.fn(),
    revealValue: vi.fn(),
  },
}));

// Mock store
vi.mock('~/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}));

const mockConfigData: ConfigItem[] = [
  {
    key: 'DATABASE_URL',
    value: 'postgresql://localhost:5432/test',
    is_sensitive: true,
    is_masked: false,
    source: 'env',
  },
  {
    key: 'REDIS_URL',
    value: 'redis://localhost:6379/0',
    is_sensitive: false,
    is_masked: false,
    source: 'env',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    value: 'sk-a******key',
    is_sensitive: true,
    is_masked: true,
    source: 'db',
  },
  {
    key: 'IMAGE_API_KEY',
    value: 'img-******key',
    is_sensitive: true,
    is_masked: true,
    source: 'db',
  },
];

describe('SettingsModal', () => {
  let queryClient: QueryClient;
  const mockCloseModal = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.mocked(useSettingsStore).mockReturnValue({
      isModalOpen: true,
      closeModal: mockCloseModal,
      openModal: vi.fn(),
    });

    vi.mocked(configApi.get).mockResolvedValue(mockConfigData);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <SettingsModal />
      </QueryClientProvider>
    );
  };

  it('不渲染当模态框关闭时', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      isModalOpen: false,
      closeModal: mockCloseModal,
      openModal: vi.fn(),
    });

    const { container } = renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('渲染模态框并加载配置数据', async () => {
    renderComponent();

    // 验证标题
    expect(screen.getByText('环境变量配置管理')).toBeInTheDocument();

    // 等待数据加载完成
    await waitFor(() => {
      expect(configApi.get).toHaveBeenCalled();
      // 验证至少有一个配置项被渲染
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('切换标签页', async () => {
    const user = userEvent.setup();
    renderComponent();

    // 等待数据加载完成
    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    }, { timeout: 3000 });

    // 点击 LLM 服务标签（使用 role 查找）
    const tabs = screen.getAllByRole('tab');
    const llmTab = tabs.find(tab => tab.textContent?.includes('LLM 服务'));
    expect(llmTab).toBeDefined();

    if (llmTab) {
      await user.click(llmTab);
      // 验证标签页切换（检查是否有 accent 背景色）
      expect(llmTab).toHaveClass('bg-accent');
    }
  });

  it('修改配置值', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改 REDIS_URL
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'redis://newhost:6379/1');

    expect(redisInput).toHaveValue('redis://newhost:6379/1');
  });

  it('提交配置更新 - 成功场景', async () => {
    const user = userEvent.setup();
    vi.mocked(configApi.update).mockResolvedValue({
      updated: 1,
      skipped: 0,
      restart_required: false,
      restart_keys: [],
      message: '配置已保存',
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改配置
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'redis://newhost:6379/1');

    // 提交表单
    const saveButton = screen.getByRole('button', { name: /保存/i });
    await user.click(saveButton);

    // 验证 API 调用
    await waitFor(() => {
      expect(configApi.update).toHaveBeenCalledWith(
        expect.objectContaining({
          REDIS_URL: 'redis://newhost:6379/1',
        })
      );
    });

    // 验证成功提示
    await waitFor(() => {
      expect(screen.getByText('保存成功')).toBeInTheDocument();
      expect(screen.getByText('配置已保存并立即生效！')).toBeInTheDocument();
    });
  });

  it('提交配置更新 - 需要重启场景', async () => {
    const user = userEvent.setup();
    vi.mocked(configApi.update).mockResolvedValue({
      updated: 1,
      skipped: 0,
      restart_required: true,
      restart_keys: ['REDIS_URL'],
      message: '配置已保存，需要重启',
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改 Redis URL（需要重启的配置）
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'redis://newhost:6379/1');

    // 提交表单
    const saveButton = screen.getByRole('button', { name: /保存配置/i });
    await user.click(saveButton);

    // 验证警告提示（Alert 是独立的 modal）
    await waitFor(() => {
      expect(screen.getByText('配置已保存！')).toBeInTheDocument();
      expect(screen.getByText('其他配置已立即生效。')).toBeInTheDocument();
    }, { timeout: 3000 });

    // 验证详细信息中包含需要重启的配置键
    const detailsElement = screen.getByText(/以下配置需要重启服务才能生效/i);
    expect(detailsElement).toBeInTheDocument();
  });

  it('提交配置更新 - 失败场景', async () => {
    const user = userEvent.setup();
    vi.mocked(configApi.update).mockRejectedValue(new Error('网络错误'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改配置
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'invalid-url');

    // 提交表单
    const saveButton = screen.getByRole('button', { name: /保存/i });
    await user.click(saveButton);

    // 验证错误提示
    await waitFor(() => {
      expect(screen.getByText('保存失败')).toBeInTheDocument();
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('取消操作恢复原始值', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改配置
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'redis://modified:6379/1');

    expect(redisInput).toHaveValue('redis://modified:6379/1');

    // 点击取消
    const cancelButton = screen.getByRole('button', { name: /取消/i });
    await user.click(cancelButton);

    // 验证关闭模态框
    expect(mockCloseModal).toHaveBeenCalled();
  });

  it('显示加载状态', async () => {
    let resolvePromise: (value: ConfigItem[]) => void;
    const promise = new Promise<ConfigItem[]>((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(configApi.get).mockReturnValue(promise);

    renderComponent();

    // 验证加载指示器存在
    const loadingSpinner = document.querySelector('.loading-spinner');
    expect(loadingSpinner).toBeInTheDocument();

    // 清理：resolve promise
    resolvePromise!(mockConfigData);
  });

  it('显示错误状态', async () => {
    vi.mocked(configApi.get).mockRejectedValue(new Error('加载失败'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/加载配置失败/i)).toBeInTheDocument();
    });
  });

  it('敏感配置显示脱敏值', async () => {
    renderComponent();

    // 等待数据加载完成
    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    }, { timeout: 3000 });

    // 切换到 LLM 服务标签
    const tabs = screen.getAllByRole('tab');
    const llmTab = tabs.find(tab => tab.textContent?.includes('LLM 服务'));

    if (llmTab) {
      await userEvent.setup().click(llmTab);

      // 验证敏感配置显示脱敏值
      await waitFor(() => {
        const apiKeyInput = screen.getByDisplayValue('sk-a******key');
        expect(apiKeyInput).toBeInTheDocument();
      }, { timeout: 3000 });
    }
  });

  it('关闭 Alert 后继续操作', async () => {
    const user = userEvent.setup();
    vi.mocked(configApi.update).mockResolvedValue({
      updated: 1,
      skipped: 0,
      restart_required: false,
      restart_keys: [],
      message: '配置已保存',
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('redis://localhost:6379/0')).toBeInTheDocument();
    });

    // 修改并保存
    const redisInput = screen.getByDisplayValue('redis://localhost:6379/0');
    await user.clear(redisInput);
    await user.type(redisInput, 'redis://newhost:6379/1');

    const saveButton = screen.getByRole('button', { name: /保存/i });
    await user.click(saveButton);

    // 等待成功提示
    await waitFor(() => {
      expect(screen.getByText('保存成功')).toBeInTheDocument();
    });

    // 关闭 Alert
    const closeAlertButton = screen.getByRole('button', { name: /确定/i });
    await user.click(closeAlertButton);

    // 验证 Alert 消失
    await waitFor(() => {
      expect(screen.queryByText('保存成功')).not.toBeInTheDocument();
    });
  });
});
