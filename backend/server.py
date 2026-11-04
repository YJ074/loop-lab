import asyncio
import csv
import io
import os
import random
import logging
import secrets as pysecrets
import uuid
from contextlib import suppress
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Literal, Optional

import httpx
from fastapi import FastAPI, APIRouter, Query, Request, Response, HTTPException, Depends, UploadFile, File
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

# ---------------------------------------------------------------- Indexes
INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("user_id", ASCENDING)], name="user_id", unique=True),
              IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "user_sessions": [IndexModel([("session_token", ASCENDING)], name="session_token", unique=True),
                      IndexModel([("user_id", ASCENDING)], name="user_id")],
    "workspaces": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                   IndexModel([("owner_user_id", ASCENDING)], name="owner"),
                   IndexModel([("webhook_token", ASCENDING)], name="webhook_token")],
    "campaigns": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("workspace_id", ASCENDING)], name="workspace")],
    "referrers": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("campaign_id", ASCENDING)], name="campaign"),
                  IndexModel([("code", ASCENDING)], name="code")],
    "links": [IndexModel([("id", ASCENDING)], name="id", unique=True),
              IndexModel([("campaign_id", ASCENDING)], name="campaign"),
              IndexModel([("short_code", ASCENDING)], name="short_code")],
    "conversions": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                    IndexModel([("campaign_id", ASCENDING)], name="campaign"),
                    IndexModel([("workspace_id", ASCENDING)], name="workspace"),
                    IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "rewards": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                IndexModel([("campaign_id", ASCENDING)], name="campaign"),
                IndexModel([("workspace_id", ASCENDING)], name="workspace")],
    "audit_logs": [IndexModel([("workspace_id", ASCENDING)], name="workspace"),
                   IndexModel([("created_at", DESCENDING)], name="created_desc")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso() -> str:
    return now_utc().isoformat()


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------- Models
class SessionIn(BaseModel):
    session_id: str


class CampaignIn(BaseModel):
    name: str
    template: str = "ecommerce_purchase"
    audience: str = "all_customers"
    conversion_event: str = "purchase"
    reward_type: Literal["discount", "store_credit", "cash"] = "discount"
    reward_value: float = Field(default=10.0, gt=0)
    reward_currency: Literal["USD", "EUR", "GBP"] = "USD"
    language: Literal["en", "es"] = "en"
    budget_cap: float = Field(default=1000.0, gt=0)
    approval_mode: Literal["auto_verify", "manual", "auto_approve"] = "auto_verify"
    channels: List[str] = ["whatsapp", "copy_link"]
    paid_cpa_benchmark: float = 40.0


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    reward_value: Optional[float] = None
    reward_currency: Optional[str] = None
    budget_cap: Optional[float] = None
    approval_mode: Optional[str] = None
    paid_cpa_benchmark: Optional[float] = None


class ReferrerIn(BaseModel):
    name: str
    email: str


class ConversionWebhookIn(BaseModel):
    code: str
    event_type: str = "purchase"
    order_value: float = 0.0
    currency: str = "USD"
    channel: Optional[str] = None
    customer_email: Optional[str] = None
    device_fingerprint: Optional[str] = None
    coupon_code: Optional[str] = None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    shopify_domain: Optional[str] = None


# ---------------------------------------------------------------- Auth
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_workspace(user: dict) -> dict:
    ws = await db.workspaces.find_one({"owner_user_id": user["user_id"]}, {"_id": 0})
    if not ws:
        await bootstrap_workspace(user)
        ws = await db.workspaces.find_one({"owner_user_id": user["user_id"]}, {"_id": 0})
    return ws


@api_router.post("/auth/session")
async def auth_session(body: SessionIn, response: Response):
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session id")
    data = r.json()
    email = data["email"]
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = gen_id("user")
        user = {"user_id": user_id, "email": email, "name": data.get("name", email),
                "picture": data.get("picture", ""), "created_at": iso()}
        await db.users.insert_one(dict(user))
        await bootstrap_workspace(user)
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "user_id": user["user_id"], "session_token": session_token,
        "expires_at": (now_utc() + timedelta(days=7)).isoformat(), "created_at": iso(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", path="/", max_age=7 * 24 * 60 * 60)
    return {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture", "")}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture", "")}


@api_router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------------------------------------------------------------- Workspace bootstrap + seed
async def bootstrap_workspace(user: dict):
    ws_id = gen_id("ws")
    ws = {"id": ws_id, "name": f"{user['name'].split(' ')[0]}'s Brand", "owner_user_id": user["user_id"],
          "currency": "USD", "shopify_domain": "", "webhook_token": pysecrets.token_urlsafe(16),
          "created_at": iso()}
    await db.workspaces.insert_one(dict(ws))
    await seed_demo(ws)


async def seed_demo(ws: dict):
    ws_id = ws["id"]
    camp = {
        "id": gen_id("camp"), "workspace_id": ws_id, "name": "Summer Launch — Refer a Friend",
        "template": "ecommerce_purchase", "audience": "all_customers", "conversion_event": "purchase",
        "reward_type": "discount", "reward_value": 15.0, "reward_currency": "USD", "language": "en",
        "budget_cap": 2500.0, "approval_mode": "auto_verify", "channels": ["whatsapp", "copy_link"],
        "paid_cpa_benchmark": 42.0, "status": "active", "created_at": iso(),
    }
    await db.campaigns.insert_one(dict(camp))
    names = [("Ava Chen", "ava@example.com"), ("Liam Patel", "liam@example.com"),
             ("Noah Kim", "noah@example.com"), ("Mia Rossi", "mia@example.com")]
    referrers = []
    for n, e in names:
        referrers.append(await _create_referrer(camp, n, e))
    for i in range(14):
        ref = random.choice(referrers)
        payload = ConversionWebhookIn(
            code=ref["code"], event_type="purchase",
            order_value=round(random.uniform(45, 220), 2), currency=random.choice(["USD", "USD", "USD", "EUR", "GBP"]),
            customer_email=f"buyer{i}@example.com",
            device_fingerprint=f"fp_{random.randint(1000,9999)}",
            coupon_code=random.choice(["", "", "SAVE10", "HONEYDEAL"]),
            channel=random.choice(camp.get("channels") or ["copy_link"]),
        )
        if i == 3:
            payload.customer_email = ref["email"]
        await _ingest_conversion(ws, camp, payload, source="demo")


# ---------------------------------------------------------------- Referrer + link helpers
async def _create_referrer(camp: dict, name: str, email: str) -> dict:
    code = f"{name.split(' ')[0][:4].upper()}{pysecrets.token_hex(2).upper()}"
    ref = {"id": gen_id("ref"), "campaign_id": camp["id"], "workspace_id": camp["workspace_id"],
           "name": name, "email": email, "code": code, "created_at": iso()}
    await db.referrers.insert_one(dict(ref))
    for channel in camp.get("channels", ["copy_link"]):
        short = pysecrets.token_urlsafe(5)
        shares = random.randint(30, 90)
        clicks = random.randint(8, max(9, shares - 4))
        link = {"id": gen_id("link"), "referrer_id": ref["id"], "campaign_id": camp["id"],
                "workspace_id": camp["workspace_id"], "channel": channel, "short_code": short,
                "url": f"https://loop.link/{short}?c={code}&ch={channel}",
                "clicks": clicks, "shares": shares, "created_at": iso()}
        await db.links.insert_one(dict(link))
    return ref


# ---------------------------------------------------------------- Conversion + abuse logic
COUPON_SITE_FLAGS = {"SAVE10", "HONEYDEAL", "RETAILMENOT"}


async def _ingest_conversion(ws: dict, camp: dict, payload: ConversionWebhookIn, source: str) -> dict:
    ref = await db.referrers.find_one({"code": payload.code, "campaign_id": camp["id"]}, {"_id": 0})
    if not ref:
        raise HTTPException(status_code=404, detail="Unknown referral code")
    link = None
    if payload.channel:
        link = await db.links.find_one({"referrer_id": ref["id"], "channel": payload.channel}, {"_id": 0})
    if not link:
        link = await db.links.find_one({"referrer_id": ref["id"]}, {"_id": 0})

    flags: list[str] = []
    confidence = 85
    if payload.customer_email and payload.customer_email.lower() == ref["email"].lower():
        flags.append("self_referral")
        confidence -= 55
    if payload.device_fingerprint:
        dup = await db.conversions.find_one(
            {"campaign_id": camp["id"], "device_fingerprint": payload.device_fingerprint}, {"_id": 0})
        if dup:
            flags.append("device_reuse")
            confidence -= 30
    if payload.coupon_code and payload.coupon_code.upper() in COUPON_SITE_FLAGS:
        flags.append("coupon_leakage")
        confidence -= 25
    if not payload.device_fingerprint:
        confidence -= 15
    confidence = max(5, min(100, confidence))
    conf_label = "high" if confidence >= 75 else ("medium" if confidence >= 45 else "low")

    mode = camp.get("approval_mode", "auto_verify")
    if flags:
        status = "flagged"
    elif mode == "auto_approve":
        status = "verified"
    elif mode == "manual":
        status = "pending"
    else:
        status = "verified" if conf_label == "high" else "pending"

    conv = {"id": gen_id("conv"), "campaign_id": camp["id"], "workspace_id": ws["id"],
            "referrer_id": ref["id"], "referrer_name": ref["name"], "link_id": link["id"] if link else None,
            "event_type": payload.event_type, "order_value": payload.order_value, "currency": payload.currency,
            "customer_email": payload.customer_email, "device_fingerprint": payload.device_fingerprint,
            "coupon_code": payload.coupon_code, "status": status, "confidence": confidence,
            "confidence_label": conf_label, "flags": flags, "source": source, "created_at": iso()}
    await db.conversions.insert_one(dict(conv))

    reward_status = "approved" if status == "verified" else "pending"
    # discount rewards are a % of the order -> record a real monetary liability in the order currency
    if camp["reward_type"] == "discount":
        reward_amount = round(payload.order_value * camp["reward_value"] / 100.0, 2)
        reward_cur = payload.currency
        reward_rate = camp["reward_value"]
    else:
        reward_amount = camp["reward_value"]
        reward_cur = camp["reward_currency"]
        reward_rate = None
    if reward_status == "approved" and camp.get("budget_cap"):
        spent = await db.rewards.aggregate([
            {"$match": {"campaign_id": camp["id"], "status": "approved"}},
            {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
        if (spent[0]["t"] if spent else 0) + reward_amount > camp["budget_cap"]:
            reward_status = "pending"
    reward = {"id": gen_id("rwd"), "campaign_id": camp["id"], "workspace_id": ws["id"],
              "referrer_id": ref["id"], "referrer_name": ref["name"], "conversion_id": conv["id"],
              "type": camp["reward_type"], "amount": reward_amount, "rate": reward_rate,
              "currency": reward_cur, "status": reward_status, "created_at": iso()}
    await db.rewards.insert_one(dict(reward))
    await _log(ws["id"], "conversion", f"{source} conversion {conv['id']} -> {status} ({conf_label} confidence)")
    return conv


async def _log(workspace_id: str, kind: str, message: str):
    await db.audit_logs.insert_one({"id": gen_id("log"), "workspace_id": workspace_id,
                                    "kind": kind, "message": message, "created_at": iso()})


# ---------------------------------------------------------------- Workspace routes
@api_router.get("/workspace")
async def read_workspace(user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    ws["webhook_url"] = f"/api/public/conversions/{ws['webhook_token']}"
    return ws


@api_router.put("/workspace")
async def update_workspace(body: WorkspaceUpdate, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.workspaces.update_one({"id": ws["id"]}, {"$set": updates})
    ws = await db.workspaces.find_one({"id": ws["id"]}, {"_id": 0})
    ws["webhook_url"] = f"/api/public/conversions/{ws['webhook_token']}"
    return ws


# ---------------------------------------------------------------- Campaign routes
@api_router.get("/campaigns")
async def list_campaigns(user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camps = await db.campaigns.find({"workspace_id": ws["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for c in camps:
        c["stats"] = await _campaign_stats(c["id"])
    return camps


@api_router.post("/campaigns")
async def create_campaign(body: CampaignIn, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = {"id": gen_id("camp"), "workspace_id": ws["id"], "status": "active", "created_at": iso(),
            **body.model_dump()}
    await db.campaigns.insert_one(dict(camp))
    for n, e in [("Sofia Garcia", "sofia@example.com"), ("Ethan Brown", "ethan@example.com"),
                 ("Zara Ali", "zara@example.com")]:
        await _create_referrer(camp, n, e)
    await _log(ws["id"], "campaign", f"Created campaign {camp['name']}")
    camp["stats"] = await _campaign_stats(camp["id"])
    return camp


@api_router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    camp["stats"] = await _campaign_stats(campaign_id)
    return camp


@api_router.put("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, body: CampaignUpdate, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.campaigns.update_one({"id": campaign_id, "workspace_id": ws["id"]}, {"$set": updates})
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    camp["stats"] = await _campaign_stats(campaign_id)
    return camp


async def _campaign_stats(campaign_id: str) -> dict:
    links = await db.links.find({"campaign_id": campaign_id}, {"_id": 0}).to_list(1000)
    clicks = sum(l.get("clicks", 0) for l in links)
    shares = sum(l.get("shares", 0) for l in links)
    convs = await db.conversions.find({"campaign_id": campaign_id}, {"_id": 0}).to_list(2000)
    verified = [c for c in convs if c["status"] == "verified"]
    flagged = [c for c in convs if c["status"] == "flagged"]
    rewards = await db.rewards.find({"campaign_id": campaign_id}, {"_id": 0}).to_list(2000)
    approved_liability = sum(r["amount"] for r in rewards if r["status"] == "approved")
    camp = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    cpa = round(approved_liability / len(verified), 2) if verified else 0.0
    return {"shares": shares, "clicks": clicks, "conversions": len(convs),
            "verified": len(verified), "flagged": len(flagged),
            "approved_liability": round(approved_liability, 2), "cpa": cpa,
            "paid_cpa_benchmark": camp.get("paid_cpa_benchmark", 0) if camp else 0,
            "reward_currency": camp.get("reward_currency", "USD") if camp else "USD"}


# ---------------------------------------------------------------- Referrers + links
@api_router.get("/campaigns/{campaign_id}/referrers")
async def list_referrers(campaign_id: str, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    refs = await db.referrers.find({"campaign_id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0}).to_list(500)
    for r in refs:
        r["links"] = await db.links.find({"referrer_id": r["id"]}, {"_id": 0}).to_list(20)
    return refs


@api_router.post("/campaigns/{campaign_id}/referrers")
async def add_referrer(campaign_id: str, body: ReferrerIn, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    ref = await _create_referrer(camp, body.name, body.email)
    ref["links"] = await db.links.find({"referrer_id": ref["id"]}, {"_id": 0}).to_list(20)
    await _log(ws["id"], "referrer", f"Added advocate {body.name}")
    return ref


SHARE_COPY = {
    "en": {
        "whatsapp": "Hey! I love shopping here — use my link for {reward} off your first order 🎁 {url}",
        "copy_link": "Get {reward} off your first order with my referral link: {url}",
        "instagram": "Swipe up / link in bio for {reward} off your first order! {url}",
        "email": "I thought you'd love this brand. Here's {reward} off your first order: {url}",
    },
    "es": {
        "whatsapp": "¡Hola! Usa mi enlace y obtén {reward} de descuento en tu primer pedido 🎁 {url}",
        "copy_link": "Obtén {reward} de descuento en tu primer pedido con mi enlace: {url}",
        "instagram": "¡Link en la bio para {reward} de descuento en tu primer pedido! {url}",
        "email": "Creo que te encantará esta marca. Aquí tienes {reward} de descuento: {url}",
    },
}


@api_router.get("/campaigns/{campaign_id}/share")
async def share_copy(campaign_id: str, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    reward_txt = _reward_text(camp)
    ref = await db.referrers.find_one({"campaign_id": campaign_id}, {"_id": 0})
    variants = []
    lang = SHARE_COPY.get(camp.get("language", "en"), SHARE_COPY["en"])
    for channel in camp.get("channels", ["copy_link"]):
        link = None
        if ref:
            link = await db.links.find_one({"referrer_id": ref["id"], "channel": channel}, {"_id": 0})
        tmpl = lang.get(channel, lang["copy_link"])
        url = link["url"] if link else "https://loop.link/preview"
        variants.append({"channel": channel, "copy": tmpl.format(reward=reward_txt, url=url),
                         "url": url, "native_support": channel in ("whatsapp", "email", "copy_link")})
    return {"reward": reward_txt, "variants": variants, "sample_advocate": ref["name"] if ref else None}


def _reward_text(camp: dict) -> str:
    rt, val, cur = camp["reward_type"], camp["reward_value"], camp["reward_currency"]
    if rt == "discount":
        return f"{int(val)}%"
    return f"{cur} {val:g}"


# ---------------------------------------------------------------- Conversions
@api_router.get("/conversions")
async def list_conversions(campaign_id: Optional[str] = None, status: Optional[str] = None,
                           user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    q: dict = {"workspace_id": ws["id"]}
    if campaign_id:
        q["campaign_id"] = campaign_id
    if status:
        q["status"] = status
    return await db.conversions.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api_router.post("/campaigns/{campaign_id}/simulate")
async def simulate_conversion(campaign_id: str, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    refs = await db.referrers.find({"campaign_id": campaign_id}, {"_id": 0}).to_list(100)
    if not refs:
        raise HTTPException(status_code=400, detail="Add an advocate first")
    ref = random.choice(refs)
    payload = ConversionWebhookIn(
        code=ref["code"], event_type=camp["conversion_event"],
        order_value=round(random.uniform(40, 260), 2),
        currency=random.choice(["USD", "USD", "EUR", "GBP"]),
        customer_email=random.choice([f"buyer{random.randint(1,999)}@example.com", ref["email"]]),
        device_fingerprint=random.choice([f"fp_{random.randint(1000,9999)}", None]),
        coupon_code=random.choice(["", "", "SAVE10"]),
        channel=random.choice(camp.get("channels") or ["copy_link"]),
    )
    return await _ingest_conversion(ws, camp, payload, source="demo")


@api_router.post("/campaigns/{campaign_id}/import-csv")
async def import_csv(campaign_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camp = await db.campaigns.find_one({"id": campaign_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    count = 0
    skipped: list[dict] = []
    for i, row in enumerate(reader, start=2):
        code = (row.get("code") or row.get("referral_code") or "").strip()
        if not code:
            skipped.append({"row": i, "reason": "missing code"})
            continue
        try:
            order_value = float(row.get("order_value", 0) or 0)
        except ValueError:
            skipped.append({"row": i, "reason": "invalid order_value"})
            continue
        try:
            payload = ConversionWebhookIn(
                code=code, event_type=row.get("event_type", "purchase"),
                order_value=order_value, channel=row.get("channel") or None,
                currency=row.get("currency", "USD"),
                customer_email=row.get("customer_email") or None,
                device_fingerprint=row.get("device_fingerprint") or None,
                coupon_code=row.get("coupon_code") or None)
            await _ingest_conversion(ws, camp, payload, source="csv")
            count += 1
        except HTTPException as e:
            skipped.append({"row": i, "reason": e.detail})
    return {"imported": count, "skipped": skipped}


@api_router.post("/conversions/{conversion_id}/review")
async def review_conversion(conversion_id: str, action: str = Query(...),
                            user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    conv = await db.conversions.find_one({"id": conversion_id, "workspace_id": ws["id"]}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversion not found")
    mapping = {"approve": ("verified", "approved"), "reject": ("rejected", "reversed"),
               "reverse": ("reversed", "reversed")}
    if action not in mapping:
        raise HTTPException(status_code=400, detail="Invalid action")
    conv_status, reward_status = mapping[action]
    await db.conversions.update_one({"id": conversion_id},
                                    {"$set": {"status": conv_status, "reviewed_at": iso()}})
    await db.rewards.update_one({"conversion_id": conversion_id}, {"$set": {"status": reward_status}})
    await _log(ws["id"], "review", f"Conversion {conversion_id} {action} -> {conv_status}")
    return await db.conversions.find_one({"id": conversion_id}, {"_id": 0})


# ---------------------------------------------------------------- Rewards ledger
@api_router.get("/rewards")
async def list_rewards(campaign_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    q: dict = {"workspace_id": ws["id"]}
    if campaign_id:
        q["campaign_id"] = campaign_id
    rewards = await db.rewards.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    totals: dict = {}
    for r in rewards:
        cur = r["currency"]
        totals.setdefault(cur, {"pending": 0.0, "approved": 0.0, "reversed": 0.0})
        totals[cur][r["status"]] = round(totals[cur].get(r["status"], 0) + r["amount"], 2)
    return {"rewards": rewards, "totals": totals}


@api_router.get("/rewards/export")
async def export_rewards(user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    rewards = await db.rewards.find({"workspace_id": ws["id"]}, {"_id": 0}).to_list(5000)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["reward_id", "campaign_id", "referrer", "type", "amount", "currency", "status", "created_at"])
    for r in rewards:
        writer.writerow([r["id"], r["campaign_id"], r.get("referrer_name", ""), r["type"],
                         r["amount"], r["currency"], r["status"], r["created_at"]])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=reward_ledger.csv"})


# ---------------------------------------------------------------- Abuse queue
@api_router.get("/abuse")
async def abuse_queue(user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    convs = await db.conversions.find({"workspace_id": ws["id"], "flags": {"$ne": []},
                                       "status": {"$in": ["flagged", "pending"]}},
                                      {"_id": 0}).sort("created_at", -1).to_list(500)
    counts = {"self_referral": 0, "device_reuse": 0, "coupon_leakage": 0}
    for c in convs:
        for f in c.get("flags", []):
            counts[f] = counts.get(f, 0) + 1
    return {"items": convs, "counts": counts}


# ---------------------------------------------------------------- Analytics
@api_router.get("/analytics/overview")
async def analytics_overview(user: dict = Depends(get_current_user)):
    ws = await get_workspace(user)
    camps = await db.campaigns.find({"workspace_id": ws["id"]}, {"_id": 0}).to_list(200)
    links = await db.links.find({"workspace_id": ws["id"]}, {"_id": 0}).to_list(5000)
    convs = await db.conversions.find({"workspace_id": ws["id"]}, {"_id": 0}).to_list(5000)
    rewards = await db.rewards.find({"workspace_id": ws["id"]}, {"_id": 0}).to_list(5000)
    shares = sum(l.get("shares", 0) for l in links)
    clicks = sum(l.get("clicks", 0) for l in links)
    verified = [c for c in convs if c["status"] == "verified"]
    flagged = [c for c in convs if c["status"] == "flagged"]
    approved_liability = sum(r["amount"] for r in rewards if r["status"] == "approved")
    pending_liability = sum(r["amount"] for r in rewards if r["status"] == "pending")
    cpa = round(approved_liability / len(verified), 2) if verified else 0.0
    bench = (sum(c.get("paid_cpa_benchmark", 0) for c in camps) / len(camps)) if camps else 0
    channel_perf: dict = {}
    for l in links:
        ch = l["channel"]
        channel_perf.setdefault(ch, {"channel": ch, "shares": 0, "clicks": 0, "conversions": 0})
        channel_perf[ch]["shares"] += l.get("shares", 0)
        channel_perf[ch]["clicks"] += l.get("clicks", 0)
    link_channel = {l["id"]: l["channel"] for l in links}
    for c in convs:
        ch = link_channel.get(c.get("link_id"))
        if ch and ch in channel_perf:
            channel_perf[ch]["conversions"] += 1
    comparison = []
    for c in camps:
        comparison.append({"name": c["name"], **(await _campaign_stats(c["id"]))})
    return {
        "funnel": {"shares": shares, "clicks": clicks, "conversions": len(convs), "verified": len(verified)},
        "kpis": {"shares": shares, "clicks": clicks, "conversions": len(convs), "verified": len(verified),
                 "flagged": len(flagged), "cpa": cpa, "paid_cpa_benchmark": round(bench, 2),
                 "approved_liability": round(approved_liability, 2), "pending_liability": round(pending_liability, 2),
                 "active_campaigns": len([c for c in camps if c.get("status") == "active"]),
                 "ctr": round(clicks / shares * 100, 1) if shares else 0,
                 "cvr": round(len(convs) / clicks * 100, 1) if clicks else 0},
        "channel_performance": list(channel_perf.values()),
        "comparison": comparison,
        "base_currency": ws.get("currency", "USD"),
    }


# ---------------------------------------------------------------- Public webhook (no auth)
@api_router.post("/public/conversions/{webhook_token}")
async def public_conversion(webhook_token: str, body: ConversionWebhookIn):
    ws = await db.workspaces.find_one({"webhook_token": webhook_token}, {"_id": 0})
    if not ws:
        raise HTTPException(status_code=404, detail="Invalid webhook token")
    ref = await db.referrers.find_one({"code": body.code, "workspace_id": ws["id"]}, {"_id": 0})
    if not ref:
        raise HTTPException(status_code=404, detail="Unknown referral code")
    camp = await db.campaigns.find_one({"id": ref["campaign_id"]}, {"_id": 0})
    conv = await _ingest_conversion(ws, camp, body, source="webhook")
    return {"ok": True, "conversion_id": conv["id"], "status": conv["status"]}


@api_router.get("/")
async def root():
    return {"message": "Loop Lab API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def start_index_build():
    app.state.index_task = asyncio.create_task(ensure_indexes())


@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
