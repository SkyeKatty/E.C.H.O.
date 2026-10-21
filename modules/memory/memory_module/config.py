from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    embedding_model: str | None = None
    embedding_enabled: bool = False
    require_subject_for_promotion: bool = Field(default=True, validation_alias="ECHO_MEMORY_REQUIRE_SUBJECT")


settings = Settings()
