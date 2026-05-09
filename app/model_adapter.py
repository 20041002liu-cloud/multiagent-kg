from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from openai import OpenAI

from .config import Settings


logger = logging.getLogger(__name__)


JSON_GBNF = r'''
root ::= object
value ::= object | array | string | number | boolean | null
object ::= "{" ws (string ws ":" ws value ("," ws string ws ":" ws value)*)? "}" ws
array ::= "[" ws (value ("," ws value)*)? "]" ws
string ::= "\"" ([^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\"" ws
number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [+-]? [0-9]+)? ws
boolean ::= ("true" | "false") ws
null ::= "null" ws
ws ::= [ \t\n\r]*
'''.strip()


def _extract_json_block(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        obj = json.loads(match.group(0))
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        return None
    return None


class OpenAICompatibleAdapter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.enabled = bool(settings.model_base_url)
        self._client = OpenAI(
            base_url=settings.model_base_url,
            api_key=settings.model_api_key,
            timeout=float(settings.model_timeout_seconds),
            http_client=httpx.Client(trust_env=False, timeout=float(settings.model_timeout_seconds)),
        ) if self.enabled else None
        self.fallback_count = 0
        self.last_status = "idle" if self.enabled else "disabled"
        self.last_error: str | None = None
        self.last_raw_preview: str | None = None
        self.last_finish_reason: str | None = None

    def diagnostics(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "last_status": self.last_status,
            "last_error": self.last_error,
            "last_raw_preview": self.last_raw_preview,
            "last_finish_reason": self.last_finish_reason,
            "fallback_count": self.fallback_count,
            "base_url": self._settings.model_base_url,
            "model": self._settings.model_name,
            "max_tokens": self._settings.model_max_tokens,
        }

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Compute embeddings for a list of texts via /v1/embeddings."""
        if not self.enabled or self._client is None:
            raise RuntimeError("Model adapter disabled because MODEL_BASE_URL is not configured.")
        resp = self._client.embeddings.create(model=self._settings.model_name, input=texts)
        return [d.embedding for d in resp.data]

    def embed_batch(self, texts: list[str], batch_size: int = 64) -> list[list[float]]:
        """Compute embeddings in batches to avoid overwhelming the server."""
        results: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            results.extend(self.embed(batch))
        return results

    def chat_text_completion(self, system_prompt: str, user_prompt: str, *, max_tokens: int | None = None, raw_prompt: str | None = None) -> str:
        """Use /v1/completions. Pass raw_prompt to bypass Q&A template."""
        if not self.enabled or self._client is None:
            raise RuntimeError("Model adapter disabled because MODEL_BASE_URL is not configured.")

        if raw_prompt is not None:
            prompt = raw_prompt
            stop_seqs = ["用户：", "\n用户", "\n你", "\n朋友"]
        else:
            prompt = (
                f"{system_prompt}\n\n"
                f"用户：{user_prompt}\n\n"
                f"助手："
            )
            stop_seqs = ["用户：", "\n用户", "\n\n"]
        response = self._client.completions.create(
            model=self._settings.model_name,
            prompt=prompt,
            temperature=0.1,
            max_tokens=max_tokens or 120,
            stop=stop_seqs,
        )
        self.last_finish_reason = response.choices[0].finish_reason
        output = (response.choices[0].text or "").strip()

        # OpenPangu special tokens: [unused16]=think start, [unused17]=answer start
        if "[unused17]" in output:
            # Extract answer part after [unused17], before [unused10] or end
            answer = output.split("[unused17]")[-1].split("[unused10]")[0].strip()
            if answer:
                return answer
        return output

    def chat_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False, max_tokens: int | None = None) -> str:
        if not self.enabled or self._client is None:
            raise RuntimeError("Model adapter disabled because MODEL_BASE_URL is not configured.")
        response = self._client.chat.completions.create(
            model=self._settings.model_name,
            temperature=self._settings.model_temperature,
            max_tokens=max_tokens or self._settings.model_max_tokens,
            extra_body={"grammar": JSON_GBNF} if json_mode else None,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        self.last_finish_reason = response.choices[0].finish_reason
        return response.choices[0].message.content or ""

    def _fallback(self, fallback: dict[str, Any], status: str, error: str | None = None, raw_text: str | None = None) -> dict[str, Any]:
        self.fallback_count += 1
        self.last_status = status
        self.last_error = error
        self.last_raw_preview = raw_text[:500] if raw_text else None
        if error:
            logger.warning("Model adapter fell back: %s", error)
        else:
            logger.warning("Model adapter fell back: %s", status)
        return fallback

    def chat_json(self, system_prompt: str, user_prompt: str, fallback: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled:
            return self._fallback(fallback, "disabled", "MODEL_BASE_URL is not configured.")
        try:
            text = self.chat_text(system_prompt=system_prompt, user_prompt=user_prompt, json_mode=True)
        except Exception as exc:
            return self._fallback(fallback, "error", str(exc))
        parsed = _extract_json_block(text)
        if parsed is None and self.last_finish_reason == "length":
            retry_prompt = (
                user_prompt
                + "\n上一次 JSON 被截断。请保留所有明确项目，但把 evidence 压到 12 个字以内，保证输出是完整 JSON。"
            )
            try:
                text = self.chat_text(
                    system_prompt=system_prompt,
                    user_prompt=retry_prompt,
                    json_mode=True,
                    max_tokens=self._settings.model_max_tokens,
                )
            except Exception as exc:
                return self._fallback(fallback, "error", str(exc))
            parsed = _extract_json_block(text)
        if parsed is None:
            return self._fallback(fallback, "parse_failed", "Model response was not valid JSON.", text)
        self.last_status = "ok"
        self.last_error = None
        self.last_raw_preview = text[:500]
        return parsed
