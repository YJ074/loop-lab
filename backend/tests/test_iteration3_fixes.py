# Iteration 3 retests: FX rollups (overview/campaign stats), FX budget cap, rejected filter API,
# CampaignIn / webhook validation (422), CSV import with invalid enums.
import io

import requests

from conftest import BASE_URL, _mongo

FX = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27}


def conv(amount, src, dst):
    return amount * FX[src] / FX[dst]


def _camps(client):
    return client.get(f"{BASE_URL}/api/campaigns").json()


def _payload(**kw):
    p = {"name": "TEST_camp", "reward_type": "discount", "reward_value": 10, "reward_currency": "USD",
         "channels": ["whatsapp", "copy_link"], "budget_cap": 1000}
    p.update(kw)
    return p


# ---- FX rollups
class TestFxRollups:
    def test_overview_liability_matches_converted_totals(self, client):
        ov = client.get(f"{BASE_URL}/api/analytics/overview").json()
        base = ov["base_currency"]
        totals = client.get(f"{BASE_URL}/api/rewards").json()["totals"]
        # make sure mixed currency exists in seeded data
        exp_ap = sum(conv(t.get("approved", 0), c, base) for c, t in totals.items())
        exp_pe = sum(conv(t.get("pending", 0), c, base) for c, t in totals.items())
        print("totals", totals, "overview", ov["kpis"]["approved_liability"], exp_ap)
        assert abs(ov["kpis"]["approved_liability"] - exp_ap) < 0.1
        assert abs(ov["kpis"]["pending_liability"] - exp_pe) < 0.1
        raw_sum = sum(t.get("approved", 0) for t in totals.values())
        if len([c for c, t in totals.items() if t.get("approved") and c != base]):
            assert abs(raw_sum - exp_ap) > 0.01  # proves conversion actually applied

    def test_campaign_stats_converted_to_reward_currency(self, client):
        for c in _camps(client):
            totals = client.get(f"{BASE_URL}/api/rewards", params={"campaign_id": c["id"]}).json()["totals"]
            cur = c["reward_currency"]
            exp = sum(conv(t.get("approved", 0), k, cur) for k, t in totals.items())
            assert abs(c["stats"]["approved_liability"] - exp) < 0.1
            assert c["stats"]["reward_currency"] == cur

    def test_eur_campaign_stats_in_eur(self, client):
        r = client.post(f"{BASE_URL}/api/campaigns", json=_payload(name="TEST_eur", reward_type="store_credit",
                                                                     reward_value=10, reward_currency="EUR"))
        assert r.status_code == 200
        cid = r.json()["id"]
        code = client.get(f"{BASE_URL}/api/campaigns/{cid}/referrers").json()[0]["code"]
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        rr = requests.post(f"{BASE_URL}{ws['webhook_url']}", json={"code": code, "order_value": 100,
                                                                     "device_fingerprint": "fp_eur_1"})
        assert rr.status_code == 200
        st = client.get(f"{BASE_URL}/api/campaigns/{cid}").json()["stats"]
        rw = client.get(f"{BASE_URL}/api/rewards", params={"campaign_id": cid}).json()["rewards"]
        approved = [x for x in rw if x["status"] == "approved"]
        assert sum(x["amount"] for x in approved) == st["approved_liability"]  # all EUR -> EUR


# ---- FX budget cap
class TestFxBudgetCap:
    def test_budget_cap_converts_currency(self, client):
        # 50% discount, cap 100 GBP. Order 150 USD -> reward 75 USD = 59.06 GBP (fits).
        # Second order 150 USD -> total 118.11 GBP > 100 -> pending. Raw USD sum (150) would also exceed;
        # so use order that distinguishes: 2nd order 60 EUR -> 30 EUR = 25.51 GBP -> total 84.57 GBP fits
        # (raw sum 75+30=105 > 100 would wrongly hold).
        r = client.post(f"{BASE_URL}/api/campaigns", json=_payload(name="TEST_cap", reward_value=50,
                                                                     reward_currency="GBP", budget_cap=100,
                                                                     approval_mode="auto_approve"))
        assert r.status_code == 200
        cid = r.json()["id"]
        refs = client.get(f"{BASE_URL}/api/campaigns/{cid}/referrers").json()
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        statuses = []
        for i, (ov, cur) in enumerate([(150, "USD"), (60, "EUR"), (100, "GBP")]):
            rr = requests.post(f"{BASE_URL}{ws['webhook_url']}",
                               json={"code": refs[i]["code"], "order_value": ov, "currency": cur,
                                     "device_fingerprint": f"fp_cap_{i}", "customer_email": f"cap{i}@x.com"})
            assert rr.status_code == 200
            rw = _mongo().rewards.find_one({"conversion_id": rr.json()["conversion_id"]})
            statuses.append(rw["status"])
        print(statuses)
        # 3rd: 50 GBP -> 134.57 > 100 -> pending
        assert statuses == ["approved", "approved", "pending"]


# ---- Rejected filter API
class TestRejectedFilter:
    def test_rejected_filter(self, client):
        convs = client.get(f"{BASE_URL}/api/conversions").json()
        items = convs if isinstance(convs, list) else convs.get("items", convs)
        target = [c for c in items if c["status"] in ("flagged", "pending")][0]
        r = client.post(f"{BASE_URL}/api/conversions/{target['id']}/review", params={"action": "reject"})
        assert r.status_code == 200 and r.json()["status"] == "rejected"
        rej = client.get(f"{BASE_URL}/api/conversions", params={"status": "rejected"}).json()
        rej = rej if isinstance(rej, list) else rej.get("items", rej)
        assert len(rej) >= 1 and all(c["status"] == "rejected" for c in rej)
        assert target["id"] in [c["id"] for c in rej]


# ---- Validation
class TestValidation:
    def test_discount_101_422(self, client):
        assert client.post(f"{BASE_URL}/api/campaigns", json=_payload(reward_value=101)).status_code == 422

    def test_discount_100_ok_and_credit_101_ok(self, client):
        assert client.post(f"{BASE_URL}/api/campaigns", json=_payload(name="TEST_d100", reward_value=100)).status_code == 200
        assert client.post(f"{BASE_URL}/api/campaigns",
                           json=_payload(name="TEST_c101", reward_type="store_credit", reward_value=101)).status_code == 200

    def test_channels_invalid_422(self, client):
        assert client.post(f"{BASE_URL}/api/campaigns", json=_payload(channels=[])).status_code == 422
        assert client.post(f"{BASE_URL}/api/campaigns", json=_payload(channels=["sms"])).status_code == 422

    def test_webhook_currency_channel_422(self, client):
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        url = f"{BASE_URL}{ws['webhook_url']}"
        assert requests.post(url, json={"code": "X", "order_value": 1, "currency": "JPY"}).status_code == 422
        assert requests.post(url, json={"code": "X", "order_value": 1, "channel": "sms"}).status_code == 422

    def test_csv_invalid_currency_row_no_500(self, client):
        cid = _camps(client)[0]["id"]
        code = client.get(f"{BASE_URL}/api/campaigns/{cid}/referrers").json()[0]["code"]
        csv_text = f"code,order_value,currency,channel\n{code},10,JPY,copy_link\n{code},10,USD,sms\n"
        r = client.post(f"{BASE_URL}/api/campaigns/{cid}/import-csv",
                        files={"file": ("t.csv", io.BytesIO(csv_text.encode()), "text/csv")})
        print(r.status_code, r.text[:300])
        assert r.status_code == 200, f"CSV with invalid currency/channel returned {r.status_code}"
        assert r.json()["imported"] == 0 and len(r.json()["skipped"]) == 2

    def test_put_campaign_bypasses_discount_cap(self, client):
        c = [x for x in _camps(client) if x["reward_type"] == "discount"][0]
        r = client.put(f"{BASE_URL}/api/campaigns/{c['id']}", json={"reward_value": 500})
        print("PUT discount 500 ->", r.status_code)
        ok = r.status_code == 422
        if not ok:  # restore
            client.put(f"{BASE_URL}/api/campaigns/{c['id']}", json={"reward_value": c["reward_value"]})
        assert ok, "PUT /campaigns accepts discount reward_value 500 (no validation)"
