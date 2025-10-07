"""FastAPI dependency injection utilities."""

from typing import Annotated

from fastapi import Depends

from rag_python.config import Settings, get_settings

# Common dependencies that can be injected into route handlers
SettingsDep = Annotated[Settings, Depends(get_settings)]
