from __future__ import annotations

import re


def repair_text_encoding(text: str) -> str:
    """Recover common mojibake caused by UTF-8 text decoded as latin-1/cp1252."""
    if not text:
        return text

    def score(value: str) -> int:
        cjk = len(re.findall(r"[\u4e00-\u9fa5]", value))
        mojibake = len(re.findall(r"[ÃÂ�]|[\u0080-\u009f]", value))
        return cjk * 3 - mojibake * 5

    candidates = [text]
    for encoding in ("latin1", "cp1252"):
        try:
            candidates.append(text.encode(encoding).decode("utf-8"))
        except UnicodeError:
            continue
    return max(candidates, key=score)


def split_text(text: str, chunk_size: int = 700, overlap: int = 120) -> list[str]:
    text = repair_text_encoding(text)
    stripped = re.sub(r"\s+", " ", text).strip()
    if not stripped:
        return []
    if len(stripped) <= chunk_size:
        return [stripped]

    chunks: list[str] = []
    start = 0
    while start < len(stripped):
        end = min(start + chunk_size, len(stripped))
        chunk = stripped[start:end]
        chunks.append(chunk)
        if end >= len(stripped):
            break
        start = max(0, end - overlap)
    return chunks
