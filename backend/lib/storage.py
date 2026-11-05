"""Private object storage backed by Cloudflare R2 (S3-compatible API)."""

import asyncio
import os
from functools import lru_cache

import boto3
from botocore.config import Config


APP_NAME = "feira-ciencias"


@lru_cache(maxsize=1)
def _client():
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not all((account_id, access_key, secret_key)):
        raise RuntimeError("Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY.")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _bucket() -> str:
    bucket = os.environ.get("R2_BUCKET_NAME", "").strip()
    if not bucket:
        raise RuntimeError("Configure R2_BUCKET_NAME.")
    return bucket


def _put(path: str, data: bytes, content_type: str) -> dict:
    _client().put_object(
        Bucket=_bucket(),
        Key=path,
        Body=data,
        ContentType=content_type,
    )
    return {"path": path, "size": len(data)}


def _get(path: str) -> tuple[bytes, str]:
    response = _client().get_object(Bucket=_bucket(), Key=path)
    return response["Body"].read(), response.get("ContentType", "application/octet-stream")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await asyncio.to_thread(_get, path)
