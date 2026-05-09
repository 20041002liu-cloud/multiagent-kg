from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from app.config import settings


def _is_port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _pick_port(host: str, preferred: int, max_tries: int = 30) -> int:
    for offset in range(max_tries):
        port = preferred + offset
        if _is_port_free(host, port):
            return port
    raise RuntimeError(f"No available port found from {preferred} to {preferred + max_tries - 1}.")


def _open_browser_later(url: str, delay_seconds: float = 1.2) -> None:
    def _worker():
        time.sleep(delay_seconds)
        try:
            webbrowser.open(url, new=2)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True).start()


def _model_models_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/models"


def _model_is_ready(base_url: str, timeout_seconds: float = 2.0) -> bool:
    try:
        request = urllib.request.Request(_model_models_url(base_url), method="GET")
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError, TimeoutError):
        return False


def _backend_is_ready(host: str, port: int, timeout_seconds: float = 2.0) -> bool:
    try:
        request = urllib.request.Request(f"http://{host}:{port}/api/health", method="GET")
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError, TimeoutError):
        return False


def _default_model_start_script() -> Path:
    return Path(__file__).resolve().parent.parent / "start_openpangu_7b.ps1"


def _start_model_if_needed() -> None:
    if not settings.model_base_url or not settings.model_autostart:
        return

    if _model_is_ready(settings.model_base_url):
        print(f"[multiagent_kg] Model API is already running: {settings.model_base_url}")
        return

    script = Path(settings.model_start_script).expanduser() if settings.model_start_script else _default_model_start_script()
    if not script.exists():
        print(f"[multiagent_kg] Model API is not reachable: {settings.model_base_url}")
        print(f"[multiagent_kg] Model autostart skipped; script not found: {script}")
        return

    print(f"[multiagent_kg] Model API is not reachable: {settings.model_base_url}")
    print(f"[multiagent_kg] Starting model with: {script}")

    command = ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", str(script)]
    result = subprocess.run(
        command,
        cwd=str(script.parent),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=60,
        check=False,
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode != 0:
        if result.stderr.strip():
            print(result.stderr.strip())
        raise RuntimeError(f"Model start script failed with exit code {result.returncode}: {script}")

    deadline = time.monotonic() + max(1, settings.model_start_timeout_seconds)
    while time.monotonic() < deadline:
        if _model_is_ready(settings.model_base_url):
            print(f"[multiagent_kg] Model API is ready: {settings.model_base_url}")
            return
        time.sleep(2)

    raise RuntimeError(
        f"Model API did not become ready within {settings.model_start_timeout_seconds}s: {settings.model_base_url}"
    )


def _write_runtime_info(host: str, port: int, ui_url: str, health_url: str) -> None:
    project_dir = Path(__file__).resolve().parent
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    runtime_file = data_dir / "runtime.json"
    payload = {
        "host": host,
        "port": port,
        "ui_url": ui_url,
        "health_url": health_url,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    runtime_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_startup_error(exc: BaseException) -> Path:
    project_dir = Path(__file__).resolve().parent
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    error_file = data_dir / "startup_error.log"
    trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    payload = [
        f"timestamp_utc={datetime.now(timezone.utc).isoformat()}",
        f"python={sys.executable}",
        f"cwd={Path.cwd()}",
        "",
        trace,
    ]
    error_file.write_text("\n".join(payload), encoding="utf-8")
    return error_file


def _pause_on_error() -> None:
    if sys.stdin is not None and sys.stdin.isatty():
        try:
            input("[multiagent_kg] Startup failed. Press Enter to exit...")
            return
        except EOFError:
            pass
    # If launched in a non-interactive shell, keep the window long enough for the user to notice.
    time.sleep(8)


if __name__ == "__main__":
    try:
        _start_model_if_needed()
        from app.api import app

        host = settings.app_host
        if not _is_port_free(host, settings.app_port):
            if _backend_is_ready(host, settings.app_port):
                ui_url = f"http://{host}:{settings.app_port}/ui/"
                health_url = f"http://{host}:{settings.app_port}/api/health"
                print(f"[multiagent_kg] Backend is already running on {host}:{settings.app_port}")
                print(f"[multiagent_kg] UI: {ui_url}")
                _write_runtime_info(host=host, port=settings.app_port, ui_url=ui_url, health_url=health_url)
                _open_browser_later(ui_url)
                sys.exit(0)
            raise RuntimeError(
                f"Port {settings.app_port} is occupied but /api/health is not responding. "
                "Stop the stale backend process and start again."
            )
        port = settings.app_port
        ui_url = f"http://{host}:{port}/ui/"
        health_url = f"http://{host}:{port}/api/health"
        print(f"[multiagent_kg] Starting server on {host}:{port}")
        print(f"[multiagent_kg] UI: {ui_url}")
        print(f"[multiagent_kg] Health: {health_url}")
        _write_runtime_info(host=host, port=port, ui_url=ui_url, health_url=health_url)
        _open_browser_later(ui_url)
        uvicorn.run(app, host=host, port=port, reload=False, log_level="info")
    except Exception as exc:
        error_file = _write_startup_error(exc)
        print(f"[multiagent_kg] Startup failed. See: {error_file}")
        print(f"[multiagent_kg] Error: {exc}")
        _pause_on_error()
        raise
