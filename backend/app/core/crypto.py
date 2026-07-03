from __future__ import annotations

import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes


KDF_ITERATIONS = 210_000
MAGIC = b"IMGSECV1"


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=KDF_ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_file(input_path: Path, output_path: Path, password: str) -> Path:
    data = input_path.read_bytes()
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(password=password, salt=salt)
    aes = AESGCM(key)
    ciphertext = aes.encrypt(nonce, data, None)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Format: magic (8) + salt (16) + nonce (12) + ciphertext+tag (var)
    output_path.write_bytes(MAGIC + salt + nonce + ciphertext)
    return output_path


def decrypt_bytes(encrypted_data: bytes, password: str) -> bytes:
    if len(encrypted_data) < 8 + 16 + 12 + 16:
        raise ValueError("encrypted payload is too small")

    if encrypted_data[:8] != MAGIC:
        raise ValueError("invalid encrypted file format")

    salt = encrypted_data[8:24]
    nonce = encrypted_data[24:36]
    ciphertext = encrypted_data[36:]

    key = _derive_key(password=password, salt=salt)
    aes = AESGCM(key)

    try:
        return aes.decrypt(nonce, ciphertext, None)
    except Exception as exc:
        raise ValueError("decryption failed: wrong password or corrupted file") from exc
