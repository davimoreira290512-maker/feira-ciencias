"""Private object storage backed by Cloudflare R2 (S3-compatible API)."""

import asyncio
import os
from functools import lru_cache

import boto3
from botocore.config import Config


APP_NAME = "feira-ciencias"


def _storage_settings() -> tuple[str, str, str, str]:
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key_id = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    bucket_name = os.environ.get("R2_BUCKET_NAME", "").strip()
    missing = [
        name
        for name, value in (
            ("R2_ACCOUNT_ID", account_id),
            ("R2_ACCESS_KEY_ID", access_key_id),
            ("R2_SECRET_ACCESS_KEY", secret_access_key),
            ("R2_BUCKET_NAME", bucket_name),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Cloudflare R2 is not configured. Missing: " + ", ".join(missing)
        )
    return account_id, access_key_id, secret_access_key, bucket_name


@lru_cache(maxsize=1)
def _r2_client(account_id: str, access_key_id: str, secret_access_key: str):
    endpoint_url = os.environ.get("R2_ENDPOINT_URL", "").strip()
    if not endpoint_url:
        endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def init_storage(force: bool = False) -> str:
    """Validate configuration and initialise the reusable R2 client."""
    account_id, access_key_id, secret_access_key, bucket_name = _storage_settings()
    if force:
        _r2_client.cache_clear()
    _r2_client(account_id, access_key_id, secret_access_key)
    return bucket_name


def _validate_path(path: str) -> str:
    key = path.lstrip("/")
    if not key or "\x00" in key:
        raise ValueError("A valid object path is required.")
    return key


def _put(path: str, data: bytes, content_type: str) -> dict:
    account_id, access_key_id, secret_access_key, bucket_name = _storage_settings()
    key = _validate_path(path)
    client = _r2_client(account_id, access_key_id, secret_access_key)
    client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return {"path": key, "size": len(data)}


def _get(path: str) -> tuple[bytes, str]:
    account_id, access_key_id, secret_access_key, bucket_name = _storage_settings()
    key = _validate_path(path)
    client = _r2_client(account_id, access_key_id, secret_access_key)
    response = client.get_object(Bucket=bucket_name, Key=key)
    return response["Body"].read(), response.get(
        "ContentType", "application/octet-stream"
    )


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await asyncio.to_thread(_get, path)
