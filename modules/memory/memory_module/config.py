import os
from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from memory_module.yaml_config import apply_config_yaml_to_env

apply_config_yaml_to_env()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://echo:echo@127.0.0.1:5432/echo_memory",
        validation_alias="ECHO_MEMORY_DATABASE_URL",
    )
    controller_module_ws: str = Field(
        default="ws://127.0.0.1:8787/ws/modules",
        validation_alias="ECHO_CONTROLLER_MODULE_WS",
    )
    module_id: str = Field(default="memory-module-1", validation_alias="ECHO_MEMORY_MODULE_ID")
    module_auth_token: str | None = Field(default=None, validation_alias="ECHO_MODULE_AUTH_TOKEN")

    embedding_model: str | None = Field(default=None, validation_alias="ECHO_MEMORY_EMBEDDING_MODEL")
    embedding_enabled: bool = Field(default=False, validation_alias="ECHO_MEMORY_EMBEDDING_ENABLED")
    embedding_device: str = Field(default="cpu", validation_alias="ECHO_MEMORY_EMBEDDING_DEVICE")
    embedding_model_version: str = Field(default="1", validation_alias="ECHO_MEMORY_EMBEDDING_MODEL_VERSION")
    """Fixed pgvector column width in DB (005 migration). Must match the model output dimension."""
    embedding_dimension: int | None = Field(default=None, validation_alias="ECHO_MEMORY_EMBEDDING_DIMENSION")
    worker_poll_interval_sec: float = Field(default=2.0, validation_alias="ECHO_MEMORY_EMBEDDING_POLL_SEC")
    worker_max_attempts: int = Field(default=5, validation_alias="ECHO_MEMORY_EMBEDDING_MAX_ATTEMPTS")

    require_subject_for_promotion: bool = Field(default=True, validation_alias="ECHO_MEMORY_REQUIRE_SUBJECT")

    consolidation_enabled: bool = Field(default=True, validation_alias="ECHO_MEMORY_CONSOLIDATION_ENABLED")
    consolidation_poll_interval_sec: float = Field(default=1.5, validation_alias="ECHO_MEMORY_CONSOLIDATION_POLL_SEC")
    consolidation_max_attempts: int = Field(default=5, validation_alias="ECHO_MEMORY_CONSOLIDATION_MAX_ATTEMPTS")
    consolidation_duplicate_rank_min: float = Field(
        default=0.08, validation_alias="ECHO_MEMORY_CONSOLIDATION_DUPLICATE_RANK_MIN"
    )
    consolidation_contradiction_confidence_delta: float = Field(
        default=0.12, validation_alias="ECHO_MEMORY_CONSOLIDATION_CONTRADICTION_DELTA"
    )

    @model_validator(mode="after")
    def _embedding_defaults(self) -> Self:
        if self.embedding_model and os.getenv("ECHO_MEMORY_EMBEDDING_ENABLED") is None:
            self.embedding_enabled = True
        return self

    def semantic_configured(self) -> bool:
        return bool(self.embedding_enabled and self.embedding_model)


settings = Settings()
