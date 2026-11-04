import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


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
    return uid, token


@pytest.fixture(scope="session")
def test_user():
    uid, token = create_test_user()
    yield {"user_id": uid, "token": token}


@pytest.fixture(scope="session")
def client(test_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {test_user['token']}"})
    return s
