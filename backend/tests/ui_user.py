# Helper for UI tests: `python ui_user.py create` prints uid token; `python ui_user.py cleanup <uid>`.
import sys
from conftest import create_test_user, cleanup_users, _mongo

if sys.argv[1] == "create":
    uid, tok = create_test_user()
    print(uid, tok)
elif sys.argv[1] == "cleanup":
    cleanup_users(sys.argv[2:])
    print("left:", _mongo().users.count_documents({"user_id": {"$in": sys.argv[2:]}}))
