import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CREATED_USER_IDS: list[str] = []


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def create_test_user():
    db = _mongo()
    uid = f"test-user-{uuid.uuid4().hex[:10]}"
    token = f"test_session_{uuid.uuid4().hex}"
    db.users.insert_one({"user_id": uid, "email": f"TEST_{uid}@example.com", "name": "QA Tester",
                         "picture": "", "created_at": datetime.now(timezone.utc)})
    db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                                 "created_at": datetime.now(timezone.utc)})
    CREATED_USER_IDS.append(uid)
    return uid, token


def cleanup_users(user_ids):
    """Delete only data belonging to the given TEST_ users (narrowly by their workspace ids)."""
    db = _mongo()
    for uid in user_ids:
        if not uid.startswith("test-user-"):
            continue
        ws_ids = [w["id"] for w in db.workspaces.find({"owner_user_id": uid}, {"id": 1})]
        if ws_ids:
            for col in ["campaigns", "referrers", "links", "conversions", "rewards", "audit_logs"]:
                db[col].delete_many({"workspace_id": {"$in": ws_ids}})
            db.workspaces.delete_many({"id": {"$in": ws_ids}, "owner_user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
        db.users.delete_many({"user_id": uid, "email": {"$regex": "^TEST_"}})


@pytest.fixture(scope="session", autouse=True)
def _session_cleanup():
    yield
    cleanup_users(list(CREATED_USER_IDS))


@pytest.fixture(scope="session")
def test_user():
    uid, token = create_test_user()
    yield {"user_id": uid, "token": token}


@pytest.fixture(scope="session")
def client(test_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {test_user['token']}"})
    return s
