"""Agent 工具函数。"""
from __future__ import annotations

import json
import re
from datetime import datetime, UTC
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any

def build_character_context(characters: list[Any]) -> str:
    """构建角色上下文描述（用于 prompt 拼接）

    Args:
        characters: Character 对象列表

    Returns:
        格式化的角色描述字符串，如 "Characters: Alice: red hair; Bob: tall"
        如果没有角色则返回空字符串
    """
    if not characters:
        return ""

    char_descriptions = []
    for char in characters:
        char_info = f"{char.name}: {char.description}" if char.description else char.name
        char_descriptions.append(char_info)

    if not char_descriptions:
        return ""

    return "Characters: " + "; ".join(char_descriptions)


def utcnow() -> datetime:
    """返回当前 UTC 时间（无时区信息，兼容 PostgreSQL TIMESTAMP WITHOUT TIME ZONE）。"""
    return datetime.now(UTC).replace(tzinfo=None)


def extract_json(text: str) -> dict:
    """从 LLM 响应中提取 JSON 对象，支持不完整 JSON 的修复。"""
    text = text.strip()

    # 移除可能的 markdown 代码块标记
    if text.startswith("```"):
        lines = text.split("\n")
        # 移除开头的 ```json 或 ```
        if lines[0].startswith("```"):
            lines = lines[1:]
        # 移除结尾的 ```
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # 尝试直接解析
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # 提取 JSON 对象部分
    start = text.find("{")
    if start == -1:
        raise ValueError("LLM 响应中未找到 JSON 对象")

    end = text.rfind("}")
    if end == -1 or end <= start:
        # JSON 不完整，尝试修复
        json_text = text[start:]
    else:
        json_text = text[start : end + 1]

    # 尝试多种修复策略
    for fix_func in [
        lambda x: x,  # 原样尝试
        _fix_common_json_errors,  # 修复常见错误
        _try_fix_incomplete_json,  # 修复不完整 JSON
        lambda x: _try_fix_incomplete_json(_fix_common_json_errors(x)),  # 组合修复
    ]:
        try:
            fixed = fix_func(json_text)
            data = json.loads(fixed)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, ValueError):
            continue

    # 所有修复都失败，抛出原始错误
    raise ValueError(f"无法解析 LLM 响应的 JSON: {json_text[:200]}...")


def _fix_common_json_errors(text: str) -> str:
    """修复 LLM 生成 JSON 的常见错误。"""
    # 移除注释（// 和 /* */）
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

    # 修复尾随逗号: ,] 或 ,}
    text = re.sub(r',\s*]', ']', text)
    text = re.sub(r',\s*}', '}', text)

    # 修复缺少逗号的情况: }\n{ 或 ]\n[ 或 "\n" 等
    # 在 } 或 ] 或 " 或数字后面，如果紧跟 { 或 [ 或 " 或数字，添加逗号
    # 这个正则比较复杂，分步处理

    # 修复 "value"\n"key" 的情况（对象属性之间缺少逗号）
    text = re.sub(r'"\s*\n\s*"', '",\n"', text)

    # 修复 }\n{ 的情况（数组中对象之间缺少逗号）
    text = re.sub(r'}\s*\n\s*{', '},\n{', text)

    # 修复 ]\n[ 的情况
    text = re.sub(r']\s*\n\s*\[', '],\n[', text)

    # 修复 }\n" 的情况（对象后面跟字符串键）
    text = re.sub(r'}\s*\n\s*"', '},\n"', text)

    # 修复 ]\n" 的情况
    text = re.sub(r']\s*\n\s*"', '],\n"', text)

    # 修复数字后面缺少逗号: 123\n"key"
    text = re.sub(r'(\d)\s*\n\s*"', r'\1,\n"', text)

    # 修复 true/false/null 后面缺少逗号
    text = re.sub(r'(true|false|null)\s*\n\s*"', r'\1,\n"', text)

    return text


def _try_fix_incomplete_json(text: str) -> str:
    """尝试修复不完整的 JSON 字符串。"""
    # 计算未闭合的括号
    open_braces = 0
    open_brackets = 0
    in_string = False
    escape_next = False
    
    for char in text:
        if escape_next:
            escape_next = False
            continue
        if char == '\\':
            escape_next = True
            continue
        if char == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == '{':
            open_braces += 1
        elif char == '}':
            open_braces -= 1
        elif char == '[':
            open_brackets += 1
        elif char == ']':
            open_brackets -= 1
    
    # 如果在字符串中间被截断，先闭合字符串
    if in_string:
        text += '"'
    
    # 闭合未完成的括号
    text += ']' * open_brackets
    text += '}' * open_braces
    
    return text
