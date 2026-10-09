"""Authentification (JWT) et contrôle des rôles."""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as M
from .db import get_session

ROLES = {"chef": "Chef de cellule", "analyste": "Analyste", "cartographe": "Cartographe"}


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def create_token(user: M.User) -> str:
    payload = {"sub": user.id, "role": user.role, "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")


def s_user(u: M.User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "grade": u.grade, "role": u.role,
            "role_label": ROLES.get(u.role, u.role), "active": u.active}


async def current_user(request: Request, db: AsyncSession = Depends(get_session)) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Non connecté")
    try:
        payload = jwt.decode(auth[7:], os.environ["JWT_SECRET"], algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expirée, reconnectez-vous")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Session invalide")
    u = (await db.execute(select(M.User).where(M.User.id == payload["sub"]))).scalar_one_or_none()
    if not u or not u.active:
        raise HTTPException(401, "Compte introuvable ou désactivé")
    return s_user(u)


def require(*roles: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] != "chef" and user["role"] not in roles:
            raise HTTPException(403, "Action réservée au chef de cellule")
        return user
    return dep
