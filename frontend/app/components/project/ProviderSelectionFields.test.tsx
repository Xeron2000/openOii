import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ProviderSelectionFields,
  TEXT_PROVIDER_OPTIONS,
  IMAGE_PROVIDER_OPTIONS,
  VIDEO_PROVIDER_OPTIONS,
} from './ProviderSelectionFields';
import type { ProjectProviderOverridesPayload } from '~/types';

const baseValue: ProjectProviderOverridesPayload = {
  text_provider_override: null,
  image_provider_override: null,
  video_provider_override: null,
};

describe('ProviderSelectionFields', () => {
  it('renders all provider groups with fallback defaults', () => {
    render(<ProviderSelectionFields value={baseValue} onChange={vi.fn()} />);

    const textFieldset = screen.getByText('文本').closest('fieldset');
    const imageFieldset = screen.getByText('图像').closest('fieldset');
    const videoFieldset = screen.getByText('视频').closest('fieldset');

    expect(textFieldset).not.toBeNull();
    expect(imageFieldset).not.toBeNull();
    expect(videoFieldset).not.toBeNull();

    expect(within(textFieldset as HTMLElement).getAllByRole('radio')).toHaveLength(TEXT_PROVIDER_OPTIONS.length);
    expect(within(imageFieldset as HTMLElement).getAllByRole('radio')).toHaveLength(IMAGE_PROVIDER_OPTIONS.length);
    expect(within(videoFieldset as HTMLElement).getAllByRole('radio')).toHaveLength(VIDEO_PROVIDER_OPTIONS.length);

    expect(
      within(textFieldset as HTMLElement).getByRole('radio', { name: '继承默认（当前：Anthropic）' })
    ).toBeChecked();
    expect(
      within(imageFieldset as HTMLElement).getByRole('radio', { name: '继承默认（当前：ModelScope）' })
    ).toBeChecked();
    expect(
      within(videoFieldset as HTMLElement).getByRole('radio', { name: '继承默认（当前：OpenAI）' })
    ).toBeChecked();
    expect(
      within(imageFieldset as HTMLElement).getByRole('radio', { name: 'ModelScope' })
    ).toBeInTheDocument();
    expect(
      within(videoFieldset as HTMLElement).getByRole('radio', { name: 'Fake（本地测试）' })
    ).toBeInTheDocument();
  });

  it('uses custom default keys and writes null when switching back to inherit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ProviderSelectionFields
        value={{
          text_provider_override: 'openai',
          image_provider_override: 'openai',
          video_provider_override: 'doubao',
        }}
        onChange={onChange}
        defaultKeys={{
          text: 'openai',
          image: 'openai',
          video: 'doubao',
        }}
      />
    );

    const textFieldset = screen.getByText('文本').closest('fieldset');
    const videoFieldset = screen.getByText('视频').closest('fieldset');
    expect(textFieldset).not.toBeNull();
    expect(videoFieldset).not.toBeNull();

    expect(
      within(textFieldset as HTMLElement).getByRole('radio', { name: 'OpenAI' })
    ).toBeChecked();
    expect(
      within(videoFieldset as HTMLElement).getByRole('radio', { name: 'Doubao' })
    ).toBeChecked();

    await user.click(
      within(videoFieldset as HTMLElement).getByRole('radio', {
        name: '继承默认（当前：Doubao）',
      })
    );

    expect(onChange).toHaveBeenCalledWith({
      text_provider_override: 'openai',
      image_provider_override: 'openai',
      video_provider_override: null,
    });
  });

  it('prevents changes when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ProviderSelectionFields value={baseValue} onChange={onChange} disabled />
    );

    const videoFieldset = screen.getByText('视频').closest('fieldset');
    expect(videoFieldset).not.toBeNull();

    const doubaoRadio = within(videoFieldset as HTMLElement).getByRole('radio', {
      name: 'Doubao',
    });

    expect(doubaoRadio).toBeDisabled();
    await user.click(doubaoRadio);

    expect(onChange).not.toHaveBeenCalled();
  });
});
