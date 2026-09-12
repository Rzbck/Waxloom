from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    waxloom_host: str = "127.0.0.1"
    waxloom_port: int = 8787

    navidrome_url: str = "http://127.0.0.1:4533"
    navidrome_username: str = ""
    navidrome_password: str = ""

    audiomuse_url: str = "http://127.0.0.1:8042"
    audiomuse_api_token: str = Field(default="", repr=False)

    listenbrainz_base_url: str = "https://api.listenbrainz.org"
    listenbrainz_labs_base_url: str = "https://labs.api.listenbrainz.org"
    musicbrainz_base_url: str = "https://musicbrainz.org/ws/2"

    music_library_path: str = ""

    discovery_result_count: int = 50
    discovery_underground_weight: float = 0.75


settings = Settings()
