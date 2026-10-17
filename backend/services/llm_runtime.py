"""Shared plumbing for the local-Ollama workers (bill classifier, official
stated positions): the chat function, local prompt loading, run lock, and
progress lines.
"""

from __future__ import annotations

import fcntl
import importlib.util
import json
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType

import httpx


def make_ollama_client(host: str, timeout_seconds: float):
    try:
        import ollama
    except ImportError as exc:
        raise RuntimeError(
            "The ollama package is required. pip install ollama"
        ) from exc
    return ollama.Client(
        host=host,
        timeout=httpx.Timeout(timeout_seconds, connect=10.0),
    )


class TruncatedOutputError(ValueError):
    """The model hit num_predict mid-answer, so its JSON is cut off.

    Callers can retry with less input (e.g. split the chunk) instead of
    failing the whole item.
    """


def _is_json(content: str) -> bool:
    try:
        json.loads(content)
    except ValueError:
        return False
    return True


def _field(obj, name):
    """Read a field from an ollama response object or plain dict."""
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def make_chat_fn(
    model: str,
    host: str,
    timeout: float,
    num_ctx: int,
    num_predict: int,
    think: bool = False,
    client=None,
    timeout_env: str | None = None,
):
    """chat_fn(messages, schema) -> JSON string.

    Thinking is off by default: reasoning models (e.g. Nemotron) otherwise
    spend the num_predict budget on hidden reasoning and return no answer.
    An empty or truncated answer (done_reason "length" with JSON that does not
    parse) is retried once with double the output budget (that does not reload
    the model; only a num_ctx change does, so num_ctx is fixed). A retry that is
    still truncated raises TruncatedOutputError.
    timeout_env names the worker's timeout setting in the timeout error.
    """
    if client is None:
        client = make_ollama_client(host, timeout)
    state = {"think": think}
    setting = f" (or {timeout_env})" if timeout_env else ""

    def call(messages, format_schema, temperature, budget):
        kwargs = dict(
            model=model,
            messages=messages,
            format=format_schema,
            options={"temperature": temperature, "num_ctx": num_ctx, "num_predict": budget},
            keep_alive="30m",
        )
        if state["think"] is not None:
            kwargs["think"] = state["think"]
        try:
            return client.chat(**kwargs)
        except httpx.TimeoutException as exc:
            raise TimeoutError(
                f"Ollama did not answer within {timeout:.0f}s; raise --timeout"
                f"{setting} for slower models or --think"
            ) from exc
        except Exception as exc:
            # Models without a thinking mode reject the parameter; drop it.
            if state["think"] is not None and "think" in str(exc).lower():
                state["think"] = None
                kwargs.pop("think")
                return client.chat(**kwargs)
            raise

    def chat_fn(messages, format_schema) -> str:
        details = []
        truncated = False
        # The retry gets double the output budget, but never more than the
        # context window leaves after the prompt (~3 characters per token).
        prompt_tokens = sum(len(m.get("content") or "") for m in messages) // 3
        retry_budget = max(num_predict, min(num_predict * 2, num_ctx - prompt_tokens - 256))
        for attempt, (temperature, budget) in enumerate(
            ((0, num_predict), (0.2, retry_budget)), start=1
        ):
            response = call(messages, format_schema, temperature, budget)
            message = _field(response, "message")
            content = _field(message, "content") if message is not None else None
            if content and content.strip():
                # Some models pad complete JSON with whitespace up to the
                # limit, so "length" only means truncated if it won't parse.
                if _field(response, "done_reason") != "length" or _is_json(content):
                    return content
                truncated = True
                details.append(
                    f"attempt {attempt}: cut off at output_tokens={_field(response, 'eval_count')}, "
                    f"num_predict={budget}"
                )
                continue
            truncated = False
            thinking = (_field(message, "thinking") if message is not None else None) or ""
            details.append(
                f"attempt {attempt}: done_reason={_field(response, 'done_reason')}, "
                f"output_tokens={_field(response, 'eval_count')}, "
                f"thinking_chars={len(thinking)}, num_predict={budget}"
            )
        if truncated:
            raise TruncatedOutputError(
                "Ollama output was cut off before the JSON ended ("
                + "; ".join(details)
                + "). Send less text per call or raise --num-predict."
            )
        raise ValueError(
            "Ollama returned an empty response ("
            + "; ".join(details)
            + "). If done_reason is 'length', raise --num-predict or keep --think off."
        )

    return chat_fn


def load_local_module(path: Path, *, example: str) -> ModuleType:
    """Import a gitignored local config file by path (works from any cwd).

    example is the tracked template's file name, named in the error.
    """
    if not path.is_file():
        raise RuntimeError(
            f"{path} is missing. Copy backend/scripts/{example} "
            f"to backend/scripts/{path.name} and fill in the prompts "
            "(the file is gitignored)."
        )
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def required_strings(module: ModuleType, names: tuple[str, ...]) -> dict[str, str]:
    """The named module attributes; raises if any is missing or blank."""
    values = {name: getattr(module, name, "") or "" for name in names}
    if not all(isinstance(v, str) and v.strip() for v in values.values()):
        file_name = Path(getattr(module, "__file__", "") or "config").name
        raise RuntimeError(f"{file_name} must define non-empty {' and '.join(names)}.")
    return values


@contextmanager
def run_lock(path: str, name: str = "worker"):
    """Exclusive non-blocking lock so overlapping cron runs exit early."""
    handle = open(path, "w")
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(f"another {name} run holds {path}")
        yield
    finally:
        handle.close()


def duration(seconds: float) -> str:
    minutes = int(seconds // 60)
    return f"{minutes // 60}h{minutes % 60:02d}m" if minutes >= 60 else f"{minutes}m"


def progress(done: int, total: int, elapsed: float) -> str:
    """'  (elapsed 1h05m, ~3h10m left)' once at least one item is done."""
    if done == 0 or total <= 1:
        return ""
    remaining = elapsed / done * (total - done)
    return f"  (elapsed {duration(elapsed)}, ~{duration(remaining)} left)"
