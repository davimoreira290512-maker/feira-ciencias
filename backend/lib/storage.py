"""Emergent managed object storage. Files are private: the app proxies every read."""

import asyncio
import logging
import os

import requests

logger = logging.getLogger(__name__)

# `or`, not a default= argument: the platform sets this to "" when it has no value.
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "feira-ciencias"

_storage_key: str | None = None


def init_storage(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put(path: str, data: bytes, content_type: str) -> dict:
    for attempt in range(2):
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": init_storage(force=attempt == 1), "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        if resp.status_code == 404 and attempt == 0:
            continue  # stale storage key: mint a new one once
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


def _get(path: str) -> tuple[bytes, str]:
    for attempt in range(2):
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": init_storage(force=attempt == 1)},
            timeout=60,
        )
        if resp.status_code == 404 and attempt == 0:
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("unreachable")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await asyncio.to_thread(_get, path)
