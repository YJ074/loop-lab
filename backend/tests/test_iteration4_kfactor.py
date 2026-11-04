# Iteration 4: K-factor metric, simulate-activity, reset demo, public share/click tracking
import uuid
import pytest
import requests
from conftest import BASE_URL, create_test_user, _mongo


def _uniq():
    return uuid.uuid4().hex[:10]


@pytest.fixture(scope="module")
def kc():
    uid, token = create_test_user()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    ws = s.get(f"{BASE_URL}/api/workspace").json()
    s.webhook_token = ws["webhook_token"]
    return s


def _new_campaign(s, name="TEST_K"):
    r = s.post(f"{BASE_URL}/api/campaigns", json={
        "name": f"{name}_{_uniq()}", "reward_type": "cash", "reward_value": 10, "reward_currency": "USD",
        "channels": ["copy_link"], "approval_mode": "auto_verify"})
    assert r.status_code == 200, r.text
    return r.json()


def _kf(s, cid):
    r = s.get(f"{BASE_URL}/api/campaigns/{cid}/kfactor")
    assert r.status_code == 200, r.text
    return r.json()


def _add_ref(s, cid, i=0):
    r = s.post(f"{BASE_URL}/api/campaigns/{cid}/referrers",
               json={"name": f"TEST_Adv{i} X", "email": f"TEST_adv{i}_{_uniq()}@example.com"})
    assert r.status_code == 200, r.text
    return r.json()


def _verified_conv(s, code):
    r = s.post(f"{BASE_URL}/api/public/conversions/{s.webhook_token}", json={
        "code": code, "event_type": "purchase", "order_value": 50, "currency": "USD",
        "customer_email": f"TEST_buyer_{_uniq()}@example.com", "device_fingerprint": f"fp_{_uniq()}",
        "channel": "copy_link"})
    assert r.status_code == 200, r.text
    return r.json()


# K-factor shape on seeded demo campaign + decomposition
class TestKFactorShape:
    def test_seeded_campaign_shape_and_decomposition(self, kc):
        camps = kc.get(f"{BASE_URL}/api/campaigns").json()
        assert camps
        k = _kf(kc, camps[-1]["id"])
        for f in ["customers", "shares", "clicks", "conversions", "k", "shares_per_customer",
                  "click_rate", "conversion_rate", "cycle_time_hours", "small_sample"]:
            assert f in k
        assert k["k"] == pytest.approx(k["conversions"] / k["customers"], abs=1e-3)
        if k["shares"] and k["clicks"]:
            assert k["shares_per_customer"] * k["click_rate"] * k["conversion_rate"] == pytest.approx(k["k"], rel=0.01)
        assert k["small_sample"] == (k["customers"] < 20)
        # verified-only check vs DB
        db = _mongo()
        assert k["conversions"] == db.conversions.count_documents({"campaign_id": camps[-1]["id"], "status": "verified"})

    def test_unknown_campaign_404(self, kc):
        assert kc.get(f"{BASE_URL}/api/campaigns/nope/kfactor").status_code == 404

    def test_unauth_401(self):
        assert requests.get(f"{BASE_URL}/api/campaigns/nope/kfactor").status_code == 401


# Acceptance 1-5
class TestAcceptance:
    def test_a1_new_campaign(self, kc):
        c = _new_campaign(kc)
        k = _kf(kc, c["id"])
        assert k["customers"] == 3 and k["conversions"] == 0 and k["k"] == 0
        assert k["cycle_time_hours"] is None and k["small_sample"] is True

    def test_a2_a3_reset_then_one_conversion(self, kc):
        a = _new_campaign(kc, "TEST_A")
        b = _new_campaign(kc, "TEST_B")
        before_b = _kf(kc, b["id"])
        r = kc.post(f"{BASE_URL}/api/campaigns/{a['id']}/reset")
        assert r.status_code == 200 and r.json()["ok"]
        assert r.json()["removed"]["referrers"] == 3
        k = _kf(kc, a["id"])
        assert k["customers"] == 0 and k["k"] == 0 and k["shares"] == 0 and k["cycle_time_hours"] is None
        assert _kf(kc, b["id"]) == before_b
        ref = _add_ref(kc, a["id"])
        assert all(l["shares"] == 0 and l["clicks"] == 0 for l in ref["links"])
        res = _verified_conv(kc, ref["code"])
        assert res["status"] == "verified"
        k = _kf(kc, a["id"])
        assert k["customers"] == 1 and k["conversions"] == 1 and k["k"] == 1.0
        # A5: B unchanged
        assert _kf(kc, b["id"])["k"] == 0

    def test_a4_ten_advocates_three_conversions(self, kc):
        c = _new_campaign(kc, "TEST_A4")
        kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/reset")
        refs = [_add_ref(kc, c["id"], i) for i in range(10)]
        for r in refs[:3]:
            assert _verified_conv(kc, r["code"])["status"] == "verified"
        k = _kf(kc, c["id"])
        assert k["customers"] == 10 and k["k"] == pytest.approx(0.3)

    def test_flagged_and_pending_not_counted_then_approve(self, kc):
        c = _new_campaign(kc, "TEST_FLAG")
        kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/reset")
        ref = _add_ref(kc, c["id"])
        # self referral -> flagged
        r1 = kc.post(f"{BASE_URL}/api/public/conversions/{kc.webhook_token}", json={
            "code": ref["code"], "order_value": 20, "customer_email": ref["email"], "device_fingerprint": f"fp_{_uniq()}"})
        assert r1.json()["status"] == "flagged"
        # no fingerprint -> pending
        r2 = kc.post(f"{BASE_URL}/api/public/conversions/{kc.webhook_token}", json={
            "code": ref["code"], "order_value": 20, "customer_email": f"TEST_x_{_uniq()}@example.com"})
        assert r2.json()["status"] == "pending"
        # coupon -> flagged
        r3 = kc.post(f"{BASE_URL}/api/public/conversions/{kc.webhook_token}", json={
            "code": ref["code"], "order_value": 20, "customer_email": f"TEST_y_{_uniq()}@example.com",
            "device_fingerprint": f"fp_{_uniq()}", "coupon_code": "SAVE10"})
        assert r3.json()["status"] == "flagged"
        assert _kf(kc, c["id"])["conversions"] == 0
        ap = kc.post(f"{BASE_URL}/api/conversions/{r2.json()['conversion_id']}/review?action=approve")
        assert ap.status_code == 200
        k = _kf(kc, c["id"])
        assert k["conversions"] == 1 and k["k"] == 1.0


# Simulate activity + public tracking
class TestActivity:
    def test_simulate_activity(self, kc):
        c = _new_campaign(kc, "TEST_SIM")
        k0 = _kf(kc, c["id"])
        r = kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/simulate-activity")
        assert r.status_code == 200
        d = r.json()
        assert d["shares"] == 1 and 0 <= d["clicks"] <= 2
        k1 = _kf(kc, c["id"])
        assert k1["shares"] == k0["shares"] + 1 and k1["clicks"] == k0["clicks"] + d["clicks"]

    def test_simulate_activity_empty_campaign_400(self, kc):
        c = _new_campaign(kc, "TEST_SIM0")
        kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/reset")
        assert kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/simulate-activity").status_code == 400

    def test_public_share_click_and_cycle_time(self, kc):
        c = _new_campaign(kc, "TEST_PUB")
        kc.post(f"{BASE_URL}/api/campaigns/{c['id']}/reset")
        ref = _add_ref(kc, c["id"])
        sc = ref["links"][0]["short_code"]
        assert requests.post(f"{BASE_URL}/api/public/links/{sc}/share").status_code == 200
        assert requests.post(f"{BASE_URL}/api/public/links/{sc}/click").status_code == 200
        assert requests.post(f"{BASE_URL}/api/public/links/{sc}/click").status_code == 200
        k = _kf(kc, c["id"])
        assert k["shares"] == 1 and k["clicks"] == 2 and k["click_rate"] == 2.0
        _verified_conv(kc, ref["code"])
        k = _kf(kc, c["id"])
        assert k["cycle_time_hours"] is not None and k["cycle_time_hours"] >= 0
        assert k["shares_per_customer"] * k["click_rate"] * k["conversion_rate"] == pytest.approx(k["k"], rel=0.01)

    def test_public_unknown_404(self):
        assert requests.post(f"{BASE_URL}/api/public/links/zzzunknown/share").status_code == 404
        assert requests.post(f"{BASE_URL}/api/public/links/zzzunknown/click").status_code == 404

    def test_reset_other_users_campaign_404(self, kc):
        c = _new_campaign(kc, "TEST_OWN")
        uid2, tok2 = create_test_user()
        s2 = requests.Session()
        s2.headers.update({"Authorization": f"Bearer {tok2}"})
        assert s2.post(f"{BASE_URL}/api/campaigns/{c['id']}/reset").status_code == 404
        assert s2.get(f"{BASE_URL}/api/campaigns/{c['id']}/kfactor").status_code == 404
        assert _kf(kc, c["id"])["customers"] == 3
