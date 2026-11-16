import hashlib
import hmac
import os
import re
import time
from typing import Optional, Tuple

import jwt

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str, salt: Optional[bytes] = None) -> Tuple[str, str]:
    salt = salt or os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return h.hex(), salt.hex()


def verify_password(password: str, pw_hash: str, salt: str) -> bool:
    h, _ = hash_password(password, bytes.fromhex(salt))
    return hmac.compare_digest(h, pw_hash)


def make_token(user_id: int, secret: str, days: int = 30) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + days * 86400}, secret, algorithm="HS256")


def read_token(token: str, secret: str) -> Optional[int]:
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
        return int(data["sub"])
    except Exception:
        return None
