from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_host: str = "127.0.0.1"
    app_port: int = 8090
    event_history_limit: int = 3000

    model_base_url: str | None = None
    model_api_key: str = "EMPTY"
    model_name: str = "openpangu-1b"
    model_temperature: float = 0.1
    model_timeout_seconds: int = 90
    model_max_tokens: int = 1024
    model_autostart: bool = True
    model_start_script: str | None = None
    model_start_timeout_seconds: int = 180
    model_combined_extraction: bool = False
    extraction_cache_enabled: bool = True
    extraction_concurrency: int = 1

    neo4j_uri: str | None = None
    neo4j_user: str = "neo4j"
    neo4j_password: str = "neo4j"

    vector_backend: str = "faiss"
    vector_dim: int = 384
    vector_top_k: int = 2

    embedding_base_url: str | None = None
    embedding_model_name: str = "bge-m3"
    embedding_dim: int = 1024

    chunk_size: int = 360
    chunk_overlap: int = 60
    run_chunk_limit: int = 0

    pdf_ocr_enabled: bool = True
    pdf_ocr_language: str = "chi_sim+eng"
    pdf_ocr_dpi: int = 180
    pdf_ocr_max_pages: int = 0
    pdf_ocr_timeout_seconds: int = 120
    pdf_ocr_concurrency: int = 1
    pdf_ocr_min_chars_per_page: int = 80
    tesseract_cmd: str | None = None

    data_dir: str = "data"


settings = Settings()
