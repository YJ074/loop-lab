# Loop Lab v1 backend regression tests: auth, workspace, campaigns, advocates, share, conversions,
# rewards ledger, abuse, analytics, public webhook.
import csv
import io

import pytest
import requests

from conftest import BASE_URL, create_test_user, _mongo


# ---- Auth
class TestAuth:
    def test_me_ok(self, client, test_user):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["user_id"] == test_user["user_id"]

    def test_me_no_token(self):
        assert requests.get(f"{BASE_URL}/api/auth/me").status_code == 401

    def test_me_bad_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401


# ---- Workspace
class TestWorkspace:
    def test_get_workspace(self, client):
        r = client.get(f"{BASE_URL}/api/workspace")
        assert r.status_code == 200
        ws = r.json()
        assert ws["webhook_url"].startswith("/api/public/conversions/")
        assert "_id" not in ws

    def test_update_workspace(self, client):
        r = client.put(f"{BASE_URL}/api/workspace",
                       json={"name": "TEST_Brand", "currency": "EUR", "shopify_domain": "test.myshopify.com"})
        assert r.status_code == 200
        g = client.get(f"{BASE_URL}/api/workspace").json()
        assert g["name"] == "TEST_Brand" and g["currency"] == "EUR" and g["shopify_domain"] == "test.myshopify.com"

    def test_concurrent_bootstrap_single_workspace(self):
        """Fresh user hitting multiple endpoints in parallel (like the dashboard) must get ONE workspace."""
        from concurrent.futures import ThreadPoolExecutor
        uid, token = create_test_user()
        h = {"Authorization": f"Bearer {token}"}
        urls = [f"{BASE_URL}/api/campaigns", f"{BASE_URL}/api/analytics/overview",
                f"{BASE_URL}/api/workspace", f"{BASE_URL}/api/conversions"]
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(lambda u: requests.get(u, headers=h), urls))
        n = _mongo().workspaces.count_documents({"owner_user_id": uid})
        assert n == 1, f"Race: {n} workspaces created for one user"


# ---- Campaigns + advocates + share
class TestCampaigns:
    def test_seeded_campaign(self, client):
        camps = client.get(f"{BASE_URL}/api/campaigns").json()
        seeded = [c for c in camps if c["name"].startswith("Summer Launch")]
        assert len(seeded) == 1
        assert seeded[0]["stats"]["conversions"] == 14

    def test_create_and_get(self, client):
        r = client.post(f"{BASE_URL}/api/campaigns", json={"name": "TEST_Camp", "reward_type": "store_credit",
                                                            "reward_value": 20, "reward_currency": "GBP",
                                                            "language": "es"})
        assert r.status_code == 200
        c = r.json()
        assert c["name"] == "TEST_Camp" and "_id" not in c
        g = client.get(f"{BASE_URL}/api/campaigns/{c['id']}")
        assert g.status_code == 200 and g.json()["reward_currency"] == "GBP"
        refs = client.get(f"{BASE_URL}/api/campaigns/{c['id']}/referrers").json()
        assert len(refs) == 3
        assert all(len(r["links"]) == 2 for r in refs)
        share = client.get(f"{BASE_URL}/api/campaigns/{c['id']}/share").json()
        assert share["reward"] == "GBP 20"
        chans = {v["channel"]: v for v in share["variants"]}
        assert set(chans) == {"whatsapp", "copy_link"}
        assert chans["whatsapp"]["native_support"] is True
        assert "GBP 20" in chans["whatsapp"]["copy"] and "descuento" in chans["whatsapp"]["copy"]

    def test_add_referrer(self, client):
        cid = client.get(f"{BASE_URL}/api/campaigns").json()[0]["id"]
        r = client.post(f"{BASE_URL}/api/campaigns/{cid}/referrers", json={"name": "TEST_Jamie", "email": "jamie@t.com"})
        assert r.status_code == 200
        assert len(r.json()["links"]) >= 1
        refs = client.get(f"{BASE_URL}/api/campaigns/{cid}/referrers").json()
        assert any(x["name"] == "TEST_Jamie" for x in refs)

    def test_campaign_404(self, client):
        assert client.get(f"{BASE_URL}/api/campaigns/nope").status_code == 404


# ---- Conversions / review / CSV
class TestConversions:
    def _camp(self, client):
        return [c for c in client.get(f"{BASE_URL}/api/campaigns").json() if c["name"].startswith("Summer")][0]

    def test_list_and_filter(self, client):
        c = self._camp(client)
        all_ = client.get(f"{BASE_URL}/api/conversions").json()
        assert len(all_) >= 14
        fl = client.get(f"{BASE_URL}/api/conversions?status=flagged").json()
        assert all(x["status"] == "flagged" for x in fl)
        bc = client.get(f"{BASE_URL}/api/conversions?campaign_id={c['id']}").json()
        assert all(x["campaign_id"] == c["id"] for x in bc)

    def test_simulate(self, client):
        c = self._camp(client)
        r = client.post(f"{BASE_URL}/api/campaigns/{c['id']}/simulate")
        assert r.status_code == 200
        conv = r.json()
        assert conv["status"] in ("verified", "pending", "flagged")
        assert isinstance(conv["confidence"], int)
        if conv["flags"]:
            assert conv["status"] == "flagged"

    def test_csv_import(self, client):
        c = self._camp(client)
        code = client.get(f"{BASE_URL}/api/campaigns/{c['id']}/referrers").json()[0]["code"]
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["code", "order_value", "currency", "customer_email", "device_fingerprint"])
        w.writerow([code, "99.5", "USD", "csvbuyer1@x.com", "fp_csv_unique_1"])
        w.writerow(["BADCODE", "10", "USD", "", ""])
        r = client.post(f"{BASE_URL}/api/campaigns/{c['id']}/import-csv",
                        files={"file": ("c.csv", buf.getvalue(), "text/csv")})
        assert r.status_code == 200
        assert r.json()["imported"] == 1

    def test_review_transitions(self, client):
        c = self._camp(client)
        conv = client.get(f"{BASE_URL}/api/conversions?campaign_id={c['id']}").json()[0]
        r = client.post(f"{BASE_URL}/api/conversions/{conv['id']}/review?action=approve")
        assert r.status_code == 200 and r.json()["status"] == "verified"
        rw = [x for x in client.get(f"{BASE_URL}/api/rewards").json()["rewards"] if x["conversion_id"] == conv["id"]][0]
        assert rw["status"] == "approved"
        r = client.post(f"{BASE_URL}/api/conversions/{conv['id']}/review?action=reverse")
        assert r.json()["status"] == "reversed"
        rw = [x for x in client.get(f"{BASE_URL}/api/rewards").json()["rewards"] if x["conversion_id"] == conv["id"]][0]
        assert rw["status"] == "reversed"
        assert client.post(f"{BASE_URL}/api/conversions/{conv['id']}/review?action=bogus").status_code == 400
        assert client.post(f"{BASE_URL}/api/conversions/nope/review?action=approve").status_code == 404


# ---- Rewards, abuse, analytics
class TestLedgerAnalytics:
    def test_rewards_totals(self, client):
        d = client.get(f"{BASE_URL}/api/rewards").json()
        assert len(d["rewards"]) > 0
        for cur, t in d["totals"].items():
            assert set(["pending", "approved", "reversed"]).issubset(t)

    def test_export(self, client):
        r = client.get(f"{BASE_URL}/api/rewards/export")
        assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
        assert r.text.startswith("reward_id,campaign_id")

    def test_abuse(self, client):
        d = client.get(f"{BASE_URL}/api/abuse").json()
        assert set(["self_referral", "device_reuse", "coupon_leakage"]).issubset(d["counts"])
        assert all(len(i["flags"]) > 0 for i in d["items"])

    def test_analytics(self, client):
        d = client.get(f"{BASE_URL}/api/analytics/overview").json()
        for k in ["shares", "clicks", "conversions", "verified", "flagged", "cpa", "paid_cpa_benchmark",
                  "approved_liability", "pending_liability", "ctr", "cvr"]:
            assert k in d["kpis"]
        assert set(["shares", "clicks", "conversions", "verified"]) == set(d["funnel"])
        assert len(d["channel_performance"]) >= 2 and len(d["comparison"]) >= 1


# ---- Public webhook
class TestWebhook:
    def test_webhook(self, client):
        ws = client.get(f"{BASE_URL}/api/workspace").json()
        camp = [c for c in client.get(f"{BASE_URL}/api/campaigns").json() if c["name"].startswith("Summer")][0]
        code = client.get(f"{BASE_URL}/api/campaigns/{camp['id']}/referrers").json()[0]["code"]
        url = f"{BASE_URL}{ws['webhook_url']}"
        r = requests.post(url, json={"code": code, "event_type": "purchase", "order_value": 50, "currency": "EUR",
                                     "customer_email": "whbuyer@x.com", "device_fingerprint": "fp_wh_unique_9"})
        assert r.status_code == 200 and r.json()["ok"] is True
        assert r.json()["status"] == "verified"
        assert requests.post(f"{BASE_URL}/api/public/conversions/badtoken", json={"code": code}).status_code == 404
        assert requests.post(url, json={"code": "NOPE00"}).status_code == 404

    def test_webhook_cross_workspace_code(self, client):
        """Workspace A's webhook token must not accept workspace B's referral codes."""
        _, tok_b = create_test_user()
        hb = {"Authorization": f"Bearer {tok_b}"}
        camp_b = requests.get(f"{BASE_URL}/api/campaigns", headers=hb).json()[0]
        code_b = requests.get(f"{BASE_URL}/api/campaigns/{camp_b['id']}/referrers", headers=hb).json()[0]["code"]
        ws_a = client.get(f"{BASE_URL}/api/workspace").json()
        r = requests.post(f"{BASE_URL}{ws_a['webhook_url']}", json={"code": code_b, "order_value": 1})
        assert r.status_code == 404, f"Cross-workspace ingest accepted: {r.status_code} {r.text}"
