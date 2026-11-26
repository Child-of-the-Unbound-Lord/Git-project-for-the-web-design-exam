#!/usr/bin/env python3
"""Laboratory consumables demo, Python 3.10+ standard library only.

Run: python server.py --open
The local database contains demonstration records, never survey results.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import math
import mimetypes
import secrets
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

BASE_DIR = Path(__file__).resolve().parent
CHINA_TZ = timezone(timedelta(hours=8))
MAX_QUANTITY = 1_000_000_000
PASSWORD_ITERATIONS = 260_000
SESSION_LIFETIME = 12 * 60 * 60
COOKIE_NAME = "lab_session"
MAX_BODY_BYTES = 65_536
DEMO_PASSWORDS = {
    "admin": "Admin123!",
    "member_a": "Member123!",
    "member_b": "Member123!",
}
LOGGER = logging.getLogger("lab-miniapps")


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def timestamp() -> str:
    return datetime.now(CHINA_TZ).isoformat(timespec="seconds")


def password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PASSWORD_ITERATIONS
    ).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


def check_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        ).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def integer(value, field: str, minimum: int = 0,
            maximum: int = MAX_QUANTITY) -> int:
    # 1.0 is an integer-valued JSON number; strings and booleans are not numbers.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AppError("INVALID_QUANTITY", f"{field}必须是数字形式的整数。")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise AppError("INVALID_QUANTITY", f"{field}必须是整数，不能使用小数。")
    result = int(value)
    if not minimum <= result <= maximum:
        raise AppError("INVALID_QUANTITY", f"{field}必须在{minimum}至{maximum}之间。")
    return result


def text_field(value, field: str, *, required: bool = False, limit: int = 200) -> str:
    if not isinstance(value, str):
        raise AppError("INVALID_FIELD", f"{field}必须是文字。")
    result = value.strip()
    if required and not result:
        raise AppError("INVALID_FIELD", f"请填写{field}。")
    if len(result) > limit or "\x00" in result:
        raise AppError("INVALID_FIELD", f"{field}过长或含有不允许的字符。")
    return result


def payload_fields(payload, permitted: set[str], required: set[str] | None = None):
    if not isinstance(payload, dict):
        raise AppError("INVALID_JSON", "请求内容必须是JSON对象。")
    unknown = set(payload) - permitted
    if unknown:
        raise AppError("UNSUPPORTED_FIELD", "请求包含不允许修改的字段。")
    if required and required - set(payload):
        raise AppError("MISSING_FIELD", "请求缺少必填字段。")


def public_user(row) -> dict:
    return {key: row[key] for key in ("id", "username", "display_name", "role")}


def public_item(row) -> dict:
    result = dict(row)
    result["active"] = bool(result["active"])
    return result


SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE CHECK(length(trim(username)) > 0),
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE CHECK(length(trim(code)) > 0),
    name TEXT NOT NULL CHECK(length(trim(name)) > 0),
    spec TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL CHECK(length(trim(unit)) > 0),
    location TEXT NOT NULL DEFAULT '',
    min_stock INTEGER NOT NULL DEFAULT 0
      CHECK(typeof(min_stock) = 'integer' AND min_stock BETWEEN 0 AND 1000000000),
    current_stock INTEGER NOT NULL DEFAULT 0
      CHECK(typeof(current_stock) = 'integer' AND current_stock BETWEEN 0 AND 1000000000),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY NOT NULL,
    business_no TEXT NOT NULL UNIQUE CHECK(length(trim(business_no)) > 0),
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK(type IN ('IN', 'OUT')),
    quantity INTEGER NOT NULL
      CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 1000000000),
    recipient_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
    operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    CHECK((type = 'IN' AND recipient_id IS NULL) OR
          (type = 'OUT' AND recipient_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS movements_item ON movements(item_id);
CREATE INDEX IF NOT EXISTS movements_recipient ON movements(recipient_id);
CREATE INDEX IF NOT EXISTS movements_time ON movements(created_at);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
"""


class Store:
    def __init__(self, db_path: Path | str, seed_path: Path | str | None = None):
        self.db_path = Path(db_path).resolve()
        self.seed_path = Path(seed_path or BASE_DIR / "seed.json").resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.seed = json.loads(self.seed_path.read_text(encoding="utf-8"))
        self._dummy_password = password_hash(secrets.token_urlsafe(24))
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
        with self.transaction() as connection:
            if not connection.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone():
                self._seed(connection)
                connection.execute("INSERT INTO metadata VALUES ('initialized', ?)", (timestamp(),))

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(str(self.db_path), timeout=15, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self, *, write: bool = True):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def _seed(self, connection):
        users = self.seed.get("users", [])
        for user in users:
            username = user["username"]
            if username not in DEMO_PASSWORDS:
                raise ValueError("Seed contains an unsupported demonstration account")
            connection.execute(
                "INSERT INTO users (id,username,display_name,role,password_hash) VALUES (?,?,?,?,?)",
                (user["id"], username, user["display_name"], user["role"],
                 password_hash(DEMO_PASSWORDS[username])),
            )
        administrators = [u["id"] for u in users if u["role"] == "admin"]
        members = [u["id"] for u in users if u["role"] == "member"]
        if not administrators or not members:
            raise ValueError("Seed must contain an administrator and a member")
        now = datetime.now(CHINA_TZ)
        for index, source in enumerate(self.seed.get("items", [])):
            opening = integer(source.get("opening_qty", 0), "演示期初数量")
            issued = integer(source.get("issued_qty", 0), "演示领用数量")
            if issued > opening:
                raise ValueError("Seed issued quantity exceeds opening quantity")
            connection.execute(
                "INSERT INTO items (id,code,name,spec,unit,location,min_stock,current_stock,active) "
                "VALUES (?,?,?,?,?,?,?,0,?)",
                (source["id"], source["code"], source["name"], source.get("spec", ""),
                 source["unit"], source.get("location", ""),
                 integer(source.get("min_stock", 0), "库存下限"),
                 int(bool(source.get("active", True)))),
            )
            # Even stopped demonstration items are built from their historical IN/OUT records.
            for kind, quantity, days in (("IN", opening, 12 - index % 7), ("OUT", issued, 6 - index % 6)):
                if quantity == 0:
                    continue
                connection.execute(
                    "INSERT INTO movements VALUES (?,?,?,?,?,?,?,?,?)",
                    (f"DEMO-{kind}-{source['id']}", f"DEMO-{kind}-{source['code']}",
                     source["id"], kind, quantity,
                     members[index % len(members)] if kind == "OUT" else None,
                     administrators[0], "课程演示数据：历史领用" if kind == "OUT" else "课程演示数据：期初入库",
                     (now - timedelta(days=days)).isoformat(timespec="seconds")),
                )
                connection.execute(
                    "UPDATE items SET current_stock=current_stock+? WHERE id=?",
                    (quantity if kind == "IN" else -quantity, source["id"]),
                )

    @staticmethod
    def _authorize(connection, user, *, admin: bool = False):
        if not isinstance(user, dict) or not user.get("id"):
            raise AppError("UNAUTHENTICATED", "请先登录。", 401)
        row = connection.execute("SELECT * FROM users WHERE id=? AND active=1", (user["id"],)).fetchone()
        if row is None:
            raise AppError("UNAUTHENTICATED", "登录身份已失效，请重新登录。", 401)
        if admin and row["role"] != "admin":
            raise AppError("FORBIDDEN", "此操作仅限管理员。", 403)
        return public_user(row)

    def login(self, username, password):
        username = text_field(username, "账号", required=True, limit=80)
        if not isinstance(password, str) or len(password) > 512:
            raise AppError("INVALID_CREDENTIALS", "账号或密码不正确。", 401)
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM users WHERE username=? AND active=1", (username,)).fetchone()
            encoded = row["password_hash"] if row else self._dummy_password
            valid = check_password(password, encoded)
            if row is None or not valid:
                raise AppError("INVALID_CREDENTIALS", "账号或密码不正确。", 401)
            return public_user(row)

    def create_session(self, user):
        token = secrets.token_urlsafe(32)
        with self.transaction() as connection:
            current = self._authorize(connection, user)
            connection.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
            connection.execute("INSERT INTO sessions VALUES (?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), current["id"],
                int(time.time()) + SESSION_LIFETIME,
            ))
        return token

    def session_user(self, token):
        if not isinstance(token, str) or len(token) > 200:
            return None
        with self.connection() as connection:
            row = connection.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id "
                "WHERE token_hash=? AND expires_at>? AND users.active=1",
                (hashlib.sha256(token.encode()).hexdigest(), int(time.time())),
            ).fetchone()
            return public_user(row) if row else None

    def logout(self, token):
        if token:
            with self.transaction() as connection:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (
                    hashlib.sha256(token.encode()).hexdigest(),
                ))

    @staticmethod
    def _items(connection, query=""):
        query = text_field(query, "查询条件", limit=200)
        if query:
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            rows = connection.execute(
                "SELECT * FROM items WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY code",
                (f"%{escaped}%", f"%{escaped}%"),
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM items ORDER BY code").fetchall()
        return [public_item(row) for row in rows]

    def list_items(self, user, query=""):
        with self.transaction(write=False) as connection:
            self._authorize(connection, user)
            return {"items": self._items(connection, query)}

    def state(self, user):
        with self.transaction(write=False) as connection:
            current = self._authorize(connection, user)
            if current["role"] == "admin":
                users = [public_user(row) for row in connection.execute("SELECT * FROM users ORDER BY username")]
            else:
                users = [current]
            return {"user": current, "users": users, "items": self._items(connection),
                    "movements": self._movements(connection, current, {}), "mode": "server"}

    def create_item(self, user, payload):
        with self.transaction() as connection:
            self._authorize(connection, user, admin=True)
            permitted = {"code", "name", "spec", "unit", "location", "min_stock", "active"}
            payload_fields(payload, permitted, {"code", "name", "unit"})
            active = payload.get("active", True)
            if not isinstance(active, bool):
                raise AppError("INVALID_FIELD", "启用状态必须为true或false。")
            item_id = "I_" + uuid.uuid4().hex
            values = (item_id,
                      text_field(payload["code"], "耗材编码", required=True, limit=64),
                      text_field(payload["name"], "耗材名称", required=True, limit=120),
                      text_field(payload.get("spec", ""), "规格", limit=200),
                      text_field(payload["unit"], "固定单位", required=True, limit=30),
                      text_field(payload.get("location", ""), "存放位置", limit=200),
                      integer(payload.get("min_stock", 0), "库存下限"),
                      int(active))
            try:
                connection.execute(
                    "INSERT INTO items (id,code,name,spec,unit,location,min_stock,current_stock,active) "
                    "VALUES (?,?,?,?,?,?,?,0,?)", values)
            except sqlite3.IntegrityError as exc:
                raise AppError("DUPLICATE_CODE", "该耗材编码已存在，请使用其他编码。", 409) from exc
            return {"item": public_item(connection.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())}

    def update_item(self, user, item_id, payload):
        with self.transaction() as connection:
            self._authorize(connection, user, admin=True)
            payload_fields(payload, {"name", "spec", "location", "min_stock", "active"})
            row = connection.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise AppError("NOT_FOUND", "未找到耗材。", 404)
            values = {}
            for field, label, limit in (("name", "耗材名称", 120), ("spec", "规格", 200), ("location", "存放位置", 200)):
                if field in payload:
                    values[field] = text_field(payload[field], label, required=(field == "name"), limit=limit)
            if "min_stock" in payload:
                values["min_stock"] = integer(payload["min_stock"], "库存下限")
            if "active" in payload:
                if not isinstance(payload["active"], bool):
                    raise AppError("INVALID_FIELD", "启用状态必须为true或false。")
                values["active"] = int(payload["active"])
            if values:
                assignments = ",".join(f"{key}=?" for key in values)
                connection.execute(f"UPDATE items SET {assignments} WHERE id=?", (*values.values(), item_id))
            return {"item": public_item(connection.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())}

    def _after_stock_update(self, connection):
        """Internal extension point for isolated rollback tests. Never routed via HTTP."""

    def post_movement(self, user, payload):
        with self.transaction() as connection:
            current = self._authorize(connection, user, admin=True)
            payload_fields(payload, {"business_no", "item_id", "type", "quantity", "recipient_id", "note"},
                           {"business_no", "item_id", "type", "quantity"})
            business_no = text_field(payload["business_no"], "业务单号", required=True, limit=100)
            item_id = text_field(payload["item_id"], "耗材标识", required=True, limit=100)
            kind = text_field(payload["type"], "操作类型", required=True, limit=10)
            if kind not in ("IN", "OUT"):
                raise AppError("INVALID_TYPE", "操作类型必须为IN或OUT。")
            quantity = integer(payload["quantity"], "数量", minimum=1)
            recipient = text_field(payload.get("recipient_id"), "领用人", required=True, limit=100) if kind == "OUT" else None
            note = text_field(payload.get("note", ""), "备注", limit=500)
            normalized = {"item_id": item_id, "type": kind, "quantity": quantity,
                          "recipient_id": recipient, "operator_id": current["id"], "note": note}
            existing = connection.execute("SELECT * FROM movements WHERE business_no=?", (business_no,)).fetchone()
            if existing:
                if any(existing[key] != value for key, value in normalized.items()):
                    raise AppError("BUSINESS_CONFLICT", "该业务单号已用于不同内容，请核对后使用新的单号。", 409)
                stock = connection.execute("SELECT current_stock FROM items WHERE id=?", (item_id,)).fetchone()[0]
                return {"movement": dict(existing), "idempotent": True, "current_stock": stock}
            item = connection.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            if item is None:
                raise AppError("NOT_FOUND", "未找到耗材。", 404)
            if not item["active"]:
                raise AppError("ITEM_INACTIVE", "该耗材已停用，不能新增出入库记录。", 409)
            if kind == "OUT":
                member = connection.execute("SELECT id FROM users WHERE id=? AND role='member' AND active=1", (recipient,)).fetchone()
                if member is None:
                    raise AppError("INVALID_RECIPIENT", "请选择有效的普通成员作为领用人。")
                cursor = connection.execute(
                    "UPDATE items SET current_stock=current_stock-? WHERE id=? AND current_stock>=?",
                    (quantity, item_id, quantity))
                if cursor.rowcount != 1:
                    raise AppError("INSUFFICIENT_STOCK", "当前库存不足，领用数量不能超过可用库存。", 409)
            else:
                cursor = connection.execute(
                    "UPDATE items SET current_stock=current_stock+? WHERE id=? AND current_stock<=?",
                    (quantity, item_id, MAX_QUANTITY - quantity))
                if cursor.rowcount != 1:
                    raise AppError("STOCK_LIMIT", "入库后数量超出演示系统上限。", 409)
            self._after_stock_update(connection)
            movement = {"id": "M_" + uuid.uuid4().hex, "business_no": business_no,
                        **normalized, "created_at": timestamp()}
            connection.execute(
                "INSERT INTO movements (id,business_no,item_id,type,quantity,recipient_id,operator_id,note,created_at) "
                "VALUES (:id,:business_no,:item_id,:type,:quantity,:recipient_id,:operator_id,:note,:created_at)", movement)
            stock = connection.execute("SELECT current_stock FROM items WHERE id=?", (item_id,)).fetchone()[0]
            return {"movement": movement, "idempotent": False, "current_stock": stock}

    @staticmethod
    def _movements(connection, user, filters):
        allowed = {"item_id", "type", "start", "end", "recipient_id"}
        if set(filters) - allowed:
            raise AppError("INVALID_FILTER", "不支持该查询条件。")
        conditions, params = [], []
        recipient = filters.get("recipient_id", "")
        if user["role"] == "member":
            if recipient and recipient != user["id"]:
                raise AppError("FORBIDDEN", "普通成员只能查询自己的领用记录。", 403)
            conditions.extend(["recipient_id=?", "type='OUT'"])
            params.append(user["id"])
        elif recipient:
            conditions.append("recipient_id=?")
            params.append(recipient)
        if filters.get("item_id"):
            conditions.append("item_id=?")
            params.append(filters["item_id"])
        if filters.get("type"):
            if filters["type"] not in ("IN", "OUT"):
                raise AppError("INVALID_FILTER", "类型筛选只能使用IN或OUT。")
            conditions.append("type=?")
            params.append(filters["type"])
        dates = {}
        for key in ("start", "end"):
            if filters.get(key):
                try:
                    value = date.fromisoformat(filters[key])
                    if value.isoformat() != filters[key]:
                        raise ValueError()
                except (TypeError, ValueError):
                    raise AppError("INVALID_DATE", "筛选日期应为YYYY-MM-DD。") from None
                dates[key] = value
                conditions.append("substr(created_at,1,10)" + (">=?" if key == "start" else "<=?"))
                params.append(value.isoformat())
        if dates.get("start") and dates.get("end") and dates["start"] > dates["end"]:
            raise AppError("INVALID_DATE", "开始日期不能晚于结束日期。")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        return [dict(row) for row in connection.execute(
            "SELECT * FROM movements" + where + " ORDER BY created_at DESC,rowid DESC", params)]

    def movements(self, user, filters=None):
        with self.transaction(write=False) as connection:
            current = self._authorize(connection, user)
            return {"movements": self._movements(connection, current, filters or {})}

    def alerts(self, user):
        with self.transaction(write=False) as connection:
            self._authorize(connection, user, admin=True)
            return {"items": [public_item(row) for row in connection.execute(
                "SELECT * FROM items WHERE active=1 AND current_stock<=min_stock ORDER BY code")]}

    def reconcile(self, user):
        # Authorization and both representations are read in one SQLite snapshot.
        with self.transaction(write=False) as connection:
            self._authorize(connection, user, admin=True)
            rows = connection.execute("""
                SELECT i.id AS item_id,i.code,i.name,i.current_stock,i.active,
                       COALESCE(SUM(CASE WHEN m.type='IN' THEN m.quantity ELSE 0 END),0) AS inbound,
                       COALESCE(SUM(CASE WHEN m.type='OUT' THEN m.quantity ELSE 0 END),0) AS outbound
                FROM items i LEFT JOIN movements m ON m.item_id=i.id
                GROUP BY i.id ORDER BY i.code
            """).fetchall()
            output = []
            for row in rows:
                value = dict(row)
                value["active"] = bool(value["active"])
                value["ledger_stock"] = value["inbound"] - value["outbound"]
                value["difference"] = value["current_stock"] - value["ledger_stock"]
                output.append(value)
            return {"rows": output, "checked_at": timestamp()}

    def reset_demo(self, user, confirmation):
        with self.transaction() as connection:
            self._authorize(connection, user, admin=True)
            if confirmation != "RESET_DEMO":
                raise AppError("CONFIRMATION_REQUIRED", "重置演示数据需要明确确认。")
            connection.execute("DELETE FROM sessions")
            connection.execute("DELETE FROM movements")
            connection.execute("DELETE FROM items")
            connection.execute("DELETE FROM users")
            self._seed(connection)
        return {"reset": True}


class LabHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, store, web_root=None):
        self.store = store
        self.web_root = Path(web_root or BASE_DIR / "web").resolve()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "LabMiniApps/1.0"

    def log_message(self, fmt, *args):
        LOGGER.info("%s %s", self.client_address[0], fmt % args)

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")

    def _json(self, status, data=None, error=None, cookie=None):
        payload = {"ok": error is None, "data": data} if error is None else {
            "ok": False, "error": {"code": error.code, "message": error.message}}
        content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self._security_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def _host_check(self):
        host = self.headers.get("Host", "")
        try:
            parsed = urlsplit("http://" + host)
            port = parsed.port or 80
        except ValueError:
            raise AppError("INVALID_HOST", "不允许的访问地址。", 403) from None
        allowed_names = {"localhost", "127.0.0.1", "::1", self.server.server_address[0]}
        if parsed.hostname not in allowed_names or port != self.server.server_address[1] or parsed.username or parsed.path:
            raise AppError("INVALID_HOST", "请通过本机启动地址访问。", 403)
        return host

    def _same_origin(self, host):
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.netloc != host or parsed.path or parsed.query or parsed.fragment:
                raise AppError("CROSS_ORIGIN", "拒绝跨站修改请求，请从本系统页面操作。", 403)
        if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
            raise AppError("CROSS_ORIGIN", "拒绝跨站修改请求。", 403)

    def _body(self, empty_ok=False):
        if self.headers.get("Transfer-Encoding"):
            raise AppError("INVALID_BODY", "不支持该请求传输方式。")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise AppError("INVALID_BODY", "请求长度不正确。") from None
        if size < 0 or size > MAX_BODY_BYTES:
            raise AppError("BODY_TOO_LARGE", "请求内容过大。", 413)
        if not size and empty_ok:
            return {}
        if self.headers.get_content_type() != "application/json":
            raise AppError("INVALID_CONTENT_TYPE", "请使用application/json请求。", 415)
        try:
            def no_constant(value):
                raise ValueError("Non-finite JSON number")
            data = json.loads(self.rfile.read(size).decode("utf-8"), parse_constant=no_constant)
        except (UnicodeDecodeError, ValueError):
            raise AppError("INVALID_JSON", "请求不是有效的JSON。") from None
        if not isinstance(data, dict):
            raise AppError("INVALID_JSON", "请求内容必须是JSON对象。")
        return data

    def _token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        return cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else None

    @staticmethod
    def _cookie(token=None):
        return (f"{COOKIE_NAME}={token or ''}; Path=/; HttpOnly; SameSite=Strict; "
                f"Max-Age={SESSION_LIFETIME if token else 0}")

    def _static(self, path):
        path = unquote(path)
        if "\x00" in path or "\\" in path:
            raise AppError("NOT_FOUND", "未找到页面。", 404)
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (self.server.web_root / relative).resolve()
        if not target.is_relative_to(self.server.web_root) or not target.is_file() or any(p.startswith(".") for p in Path(relative).parts):
            raise AppError("NOT_FOUND", "未找到页面。", 404)
        content = target.read_bytes()
        extension = target.suffix.lower()
        # Keep download MIME types stable across Windows/macOS/Linux registries.
        content_type = {".zip": "application/zip", ".html": "text/html", ".txt": "text/plain"}.get(extension)
        content_type = content_type or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if content_type.startswith("text/") or target.suffix in (".js", ".json", ".svg"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        if target.relative_to(self.server.web_root).parts[0] == "downloads" and extension in {".zip", ".html", ".txt"}:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(target.name, safe=""))
        self._security_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def _dispatch(self):
        try:
            host = self._host_check()
            parsed = urlsplit(self.path)
            path, method = parsed.path, self.command
            store = self.server.store
            if method in ("POST", "PATCH", "DELETE", "PUT"):
                self._same_origin(host)
            if not path.startswith("/api/"):
                if method in ("GET", "HEAD"):
                    return self._static(path)
                raise AppError("METHOD_NOT_ALLOWED", "此页面不支持该操作。", 405)
            token = self._token()
            user = store.session_user(token)
            if path == "/api/session" and method == "GET":
                return self._json(200, {"user": user, "mode": "server"})
            if path == "/api/login" and method == "POST":
                data = self._body()
                payload_fields(data, {"username", "password"}, {"username", "password"})
                authenticated = store.login(data["username"], data["password"])
                store.logout(token)
                new_token = store.create_session(authenticated)
                return self._json(200, {"user": authenticated, "mode": "server"}, cookie=self._cookie(new_token))
            if path == "/api/logout" and method == "POST":
                self._body(empty_ok=True)
                store.logout(token)
                return self._json(200, {"user": None, "mode": "server"}, cookie=self._cookie())
            # Authorization precedes reading or revealing protected business data.
            if user is None:
                raise AppError("UNAUTHENTICATED", "请先登录。", 401)
            query = parse_qs(parsed.query, keep_blank_values=True)
            if any(len(values) != 1 for values in query.values()):
                raise AppError("INVALID_FILTER", "查询条件不能重复。")
            filters = {key: values[0] for key, values in query.items()}
            if path == "/api/state" and method == "GET":
                return self._json(200, store.state(user))
            if path == "/api/items" and method == "GET":
                if set(filters) - {"q"}:
                    raise AppError("INVALID_FILTER", "不支持该查询条件。")
                return self._json(200, store.list_items(user, filters.get("q", "")))
            if path == "/api/items" and method == "POST":
                return self._json(201, store.create_item(user, self._body()))
            if path.startswith("/api/items/") and method == "PATCH":
                item_id = unquote(path.removeprefix("/api/items/"))
                return self._json(200, store.update_item(user, item_id, self._body()))
            if path == "/api/movements" and method == "POST":
                return self._json(200, store.post_movement(user, self._body()))
            if path == "/api/movements" and method == "GET":
                return self._json(200, store.movements(user, filters))
            if path == "/api/alerts" and method == "GET":
                return self._json(200, store.alerts(user))
            if path == "/api/reconciliation" and method == "GET":
                # URL date filters are intentionally not applied to reconciliation.
                return self._json(200, store.reconcile(user))
            if path == "/api/demo/reset" and method == "POST":
                body = self._body()
                payload_fields(body, {"confirm"}, {"confirm"})
                result = store.reset_demo(user, body["confirm"])
                new_token = store.create_session(user)
                return self._json(200, result, cookie=self._cookie(new_token))
            raise AppError("NOT_FOUND", "未找到该接口，流水不支持编辑或删除。", 404)
        except AppError as exc:
            self._json(exc.status, error=exc)
        except sqlite3.OperationalError:
            LOGGER.exception("Database operation failed")
            self._json(503, error=AppError("DATABASE_BUSY", "数据库暂时忙碌，请稍后使用原业务单号重试。", 503))
        except Exception:
            LOGGER.exception("Unexpected request failure")
            self._json(500, error=AppError("INTERNAL_ERROR", "操作未完成，请稍后重试；修改事务已回滚。", 500))

    do_GET = _dispatch
    do_HEAD = _dispatch
    do_POST = _dispatch
    do_PATCH = _dispatch
    do_DELETE = _dispatch
    do_PUT = _dispatch
    do_OPTIONS = _dispatch


def main(argv=None):
    parser = argparse.ArgumentParser(description="实验室耗材管理演示系统（Python标准库）")
    parser.add_argument("--host", default="127.0.0.1", help="默认仅本机访问")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", type=Path, default=BASE_DIR / "data" / "lab.db")
    parser.add_argument("--seed", type=Path, default=BASE_DIR / "seed.json")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 10):
        parser.error("需要Python 3.10或更新版本。")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    # Build only on a real CLI start, before touching the business database.
    # Store/HTTPServer construction remains side-effect free with respect to releases.
    try:
        from package_release import create_release
        release = create_release(BASE_DIR / "web" / "downloads")
        for key in ("archive", "standalone", "readme"):
            if not Path(release[key]).is_file():
                raise RuntimeError(f"未生成完整下载文件：{key}")
    except Exception as exc:
        parser.exit(1, f"生成本地下载文件失败：{exc}\n启动已取消，现有业务数据库未改动。请检查项目文件和下载目录权限后重试。\n")
    store = Store(args.db, args.seed)
    try:
        httpd = LabHTTPServer((args.host, args.port), store)
    except OSError as exc:
        parser.exit(1, f"无法启动：{exc}\n可改用 python server.py --port 8001 --open\n")
    hostname = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{hostname}:{httpd.server_address[1]}"
    print(f"\n实验室耗材管理系统已启动：{url}", flush=True)
    print(f"数据文件：{store.db_path}\n首次启动创建演示数据；已有数据不会自动重置。", flush=True)
    print("管理员：admin / Admin123!\n成员：member_a 或 member_b / Member123!", flush=True)
    print("按 Ctrl+C 关闭本地服务。\n", flush=True)
    if args.open:
        opener = threading.Timer(0.5, webbrowser.open, args=(url,))
        opener.daemon = True
        opener.start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
