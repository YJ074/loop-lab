# Iteration 2 retests: webhook workspace scoping + channel, discount money rewards, abuse queue lifecycle,
# simulate channel spread, CSV skipped rows, CampaignIn validation + budget cap, PUT workspace webhook_url.
import csv
import io

import requests

from conftest import BASE_URL, create_test_user, _mongo


def _summer(client):
    return [c for c in client.get(f"{BASE_URL}/api/campaigns").json() if c["name"].startswith("Summer")][0]


def _refs(client, cid):
    return client.get(f"{BASE_URL}/api/campaigns/{cid}/referrers").json()


# ---- 1. webhook
class TestWebhookFixes:
    def test_cross_workspace_404_same_workspace_200(self, client):
        _, tok_b = create_test_user()
        hb = {"Authorization": f"Bearer {tok_b}"}
        camp_b = requests.get(f"{BASE_URL}/api/campaigns", headers=hb).json()[0]
        code_b = requests.get(f"{BASE_URL}/api/campaigns/{camp_b['id']}/referrers", headers=hb).json()[0]["code"]
        ws_a = client.get(f"{BASE_URL}/api/workspace").json()
        r = requests.post(f"{BASE_URL}{ws_a['webhook_url']}", json={"code": code_b, "order_value": 1})
        assert r.status_code == 404
        # B's campaign must not have gained a conversion
        assert requests.get(f"{BASE_URL}/api/campaigns/{camp_b['id']}", headers=hb).json()["stats"]["conversions"] == 14
        code_a = _refs(client, _summer(client)["id"])[0]["code"]
        r = requests.post(f"{BASE_URL}{ws_a['webhook_url']}", json={"code": code_a, "order_value": 10,
                                                                    "device_fingerprint": "fp_x_same"})
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_channel_attribution(self, client):
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        camp = _summer(client)
        ref = _refs(client, camp["id"])[1]
        links = {l["channel"]: l["id"] for l in ref["links"]}
        for ch in ["copy_link", "whatsapp"]:
            r = requests.post(f"{BASE_URL}{ws['webhook_url']}",
                              json={"code": ref["code"], "order_value": 20, "channel": ch,
                                    "device_fingerprint": f"fp_ch_{ch}"})
            assert r.status_code == 200
            conv = _mongo().conversions.find_one({"id": r.json()["conversion_id"]})
            assert conv["link_id"] == links[ch], f"channel {ch} attributed to wrong link"


# ---- 2. discount money rewards
class TestDiscountRewards:
    def test_discount_amount_is_money(self, client):
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        camp = _summer(client)  # 15% discount
        code = _refs(client, camp["id"])[2]["code"]
        r = requests.post(f"{BASE_URL}{ws['webhook_url']}",
                          json={"code": code, "order_value": 123.0, "currency": "EUR",
                                "customer_email": "disc@x.com", "device_fingerprint": "fp_disc_1"})
        cid = r.json()["conversion_id"]
        rw = [x for x in client.get(f"{BASE_URL}/api/rewards").json()["rewards"] if x["conversion_id"] == cid][0]
        assert rw["amount"] == 18.45 and rw["rate"] == 15 and rw["currency"] == "EUR"

    def test_seed_rewards_money_and_totals(self, client):
        d = client.get(f"{BASE_URL}/api/rewards").json()
        disc = [r for r in d["rewards"] if r["type"] == "discount"]
        assert disc and all(r["rate"] == 15 for r in disc)
        assert any(r["amount"] != 15 for r in disc)
        k = client.get(f"{BASE_URL}/api/analytics/overview").json()["kpis"]
        # iteration 3: overview converts to base currency with indicative FX
        fxr = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27}
        approved = sum(r["amount"] * fxr[r["currency"]] for r in d["rewards"] if r["status"] == "approved")
        assert abs(k["approved_liability"] - round(approved, 2)) < 0.02


# ---- 3. abuse queue
class TestAbuseQueue:
    def test_approve_and_reject_leave_queue(self, client):
        items = client.get(f"{BASE_URL}/api/abuse").json()["items"]
        assert all(i["status"] in ("flagged", "pending") and i["flags"] for i in items)
        # create flagged conversions via self-referral webhook
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        ref = _refs(client, _summer(client)["id"])[0]
        ids = []
        for n in range(2):
            r = requests.post(f"{BASE_URL}{ws['webhook_url']}",
                              json={"code": ref["code"], "order_value": 50, "customer_email": ref["email"],
                                    "device_fingerprint": f"fp_abuse_{n}"})
            assert r.json()["status"] == "flagged"
            ids.append(r.json()["conversion_id"])
        q = {i["id"] for i in client.get(f"{BASE_URL}/api/abuse").json()["items"]}
        assert set(ids) <= q
        a = client.post(f"{BASE_URL}/api/conversions/{ids[0]}/review?action=approve").json()
        rj = client.post(f"{BASE_URL}/api/conversions/{ids[1]}/review?action=reject").json()
        assert a["status"] == "verified" and rj["status"] == "rejected" and rj.get("reviewed_at")
        q = {i["id"] for i in client.get(f"{BASE_URL}/api/abuse").json()["items"]}
        assert ids[0] not in q and ids[1] not in q
        rw = {x["conversion_id"]: x for x in client.get(f"{BASE_URL}/api/rewards").json()["rewards"]}
        assert rw[ids[0]]["status"] == "approved" and rw[ids[1]]["status"] == "reversed"
        rejected = client.get(f"{BASE_URL}/api/conversions?status=rejected").json()
        assert any(c["id"] == ids[1] for c in rejected)


# ---- 4. simulate channel spread
class TestSimulateChannels:
    def test_copy_link_grows(self, client):
        camp = _summer(client)
        def cl():
            ch = client.get(f"{BASE_URL}/api/analytics/overview").json()["channel_performance"]
            return {c["channel"]: c["conversions"] for c in ch}
        before = cl()
        for _ in range(12):
            assert client.post(f"{BASE_URL}/api/campaigns/{camp['id']}/simulate").status_code == 200
        after = cl()
        assert after["copy_link"] > before["copy_link"]
        assert after["whatsapp"] + after["copy_link"] - before["whatsapp"] - before["copy_link"] == 12


# ---- 5. CSV import
class TestCsvImport:
    def test_bad_order_value_skipped(self, client):
        camp = _summer(client)
        code = _refs(client, camp["id"])[0]["code"]
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["code", "order_value", "currency", "customer_email", "device_fingerprint"])
        w.writerow([code, "abc", "USD", "a@x.com", "fp_csv_bad"])
        w.writerow(["BADCODE", "10", "USD", "", ""])
        w.writerow(["", "10", "USD", "", ""])
        w.writerow([code, "40", "USD", "ok@x.com", "fp_csv_ok_2"])
        r = client.post(f"{BASE_URL}/api/campaigns/{camp['id']}/import-csv",
                        files={"file": ("c.csv", buf.getvalue(), "text/csv")})
        assert r.status_code == 200
        d = r.json()
        assert d["imported"] == 1
        sk = {s["row"]: s["reason"] for s in d["skipped"]}
        assert sk == {2: "invalid order_value", 3: "Unknown referral code", 4: "missing code"}


# ---- 6. validation + budget cap
class TestCampaignValidation:
    def test_invalid_payloads_422(self, client):
        for bad in [{"reward_type": "bitcoin"}, {"approval_mode": "yolo"}, {"reward_currency": "JPY"},
                    {"reward_value": 0}, {"reward_value": -5}]:
            r = client.post(f"{BASE_URL}/api/campaigns", json={"name": "TEST_bad", **bad})
            assert r.status_code == 422, f"{bad} -> {r.status_code}"

    def test_create_stores_audience_channels(self, client):
        r = client.post(f"{BASE_URL}/api/campaigns", json={"name": "TEST_aud", "audience": "vip_customers",
                                                            "channels": ["copy_link"]})
        assert r.status_code == 200
        g = client.get(f"{BASE_URL}/api/campaigns/{r.json()['id']}").json()
        assert g["audience"] == "vip_customers" and g["channels"] == ["copy_link"]
        refs = _refs(client, g["id"])
        assert all([l["channel"] for l in x["links"]] == ["copy_link"] for x in refs)

    def test_budget_cap_enforced(self, client):
        c = client.post(f"{BASE_URL}/api/campaigns", json={"name": "TEST_cap", "reward_type": "cash",
                                                            "reward_value": 30, "budget_cap": 50,
                                                            "approval_mode": "auto_approve"}).json()
        code = _refs(client, c["id"])[0]["code"]
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        statuses = []
        for n in range(3):
            r = requests.post(f"{BASE_URL}{ws['webhook_url']}",
                              json={"code": code, "order_value": 100, "customer_email": f"cap{n}@x.com",
                                    "device_fingerprint": f"fp_cap_{n}"})
            assert r.status_code == 200
            cid = r.json()["conversion_id"]
            statuses.append([x for x in client.get(f"{BASE_URL}/api/rewards?campaign_id={c['id']}").json()["rewards"]
                             if x["conversion_id"] == cid][0]["status"])
        assert statuses == ["approved", "pending", "pending"]
        assert client.get(f"{BASE_URL}/api/campaigns/{c['id']}").json()["stats"]["approved_liability"] == 30


# ---- 7. PUT workspace
class TestWorkspacePut:
    def test_put_includes_webhook_url(self, client):
        r = client.put(f"{BASE_URL}/api/workspace", json={"name": "TEST_Brand2"})
        assert r.status_code == 200
        assert r.json()["webhook_url"].startswith("/api/public/conversions/") and "_id" not in r.json()
