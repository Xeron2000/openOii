import { Button } from "~/components/ui/Button";

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: MessageInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex gap-2">
      <input
        id="chat-message-input"
        name="message"
        type="text"
        className="input input-bordered bg-base-300 flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder ?? "消息内容"}
      />
      <Button onClick={onSend} disabled={disabled || !value.trim()}>
        发送
      </Button>
    </div>
  );
}
