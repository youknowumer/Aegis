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


def make_token(user_id: int, secret: str, days: int = 30, ver: int = 0) -> str:
    """`ver` is the user's token_ver: changing a password or 'sign out everywhere' bumps it and kills older tokens."""
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + days * 86400, "tv": int(ver)}, secret, algorithm="HS256")


def read_token_full(token: str, secret: str) -> Optional[Tuple[int, int]]:
    """(user_id, token_ver) or None. Tokens issued before versions existed count as version 0."""
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
        return int(data["sub"]), int(data.get("tv", 0))
    except Exception:
        return None


def read_token(token: str, secret: str) -> Optional[int]:
    got = read_token_full(token, secret)
    return got[0] if got else None
