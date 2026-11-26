#!/usr/bin/env python3
"""Isolated service and real-HTTP checks, including all 22 report test cases.

Run from project root: python tests/test_server.py
No test changes data/lab.db. The report is written to docs/backend-test-results.json.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import http.client
import io
import json
import os
from pathlib import Path
import platform
from queue import Empty, Queue
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode
from contextlib import redirect_stderr, redirect_stdout
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class IsolatedStoreCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.master_directory = tempfile.TemporaryDirectory(prefix="lab-master-")
        cls.master_path = Path(cls.master_directory.name) / "master.db"
        cls.master = server.Store(cls.master_path, ROOT / "seed.json")
        cls.admin = cls.master.login("admin", "Admin123!")
        cls.member_a = cls.master.login("member_a", "Member123!")
        cls.member_b = cls.master.login("member_b", "Member123!")

    @classmethod
    def tearDownClass(cls):
        cls.master_directory.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="lab-case-")
        self.db_path = Path(self.directory.name) / "test.db"
        with self.master.connection() as source:
            destination = sqlite3.connect(str(self.db_path))
            try:
                source.backup(destination)
            finally:
                destination.close()
        self.store = server.Store(self.db_path, ROOT / "seed.json")

    def tearDown(self):
        self.directory.cleanup()

    def create_item(self, stock=0, threshold=5, code="TEST-001", name="测试耗材", active=True):
        item = self.store.create_item(self.admin, {
            "code": code, "name": name, "spec": "独立测试", "unit": "件",
            "location": "测试区", "min_stock": threshold,
        })["item"]
        if stock:
            self.movement(item, stock, business_no="OPEN-" + code)
        if not active:
            self.store.update_item(self.admin, item["id"], {"active": False})
        return item

    def movement(self, item, quantity, kind="IN", business_no="B001", recipient="U_A", **extra):
        return self.store.post_movement(self.admin, {
            "business_no": business_no, "item_id": item["id"], "type": kind,
            "quantity": quantity, "recipient_id": recipient if kind == "OUT" else None,
            "note": extra.get("note", "独立测试记录"),
        })

    def current_item(self, item):
        return next(value for value in self.store.state(self.admin)["items"] if value["id"] == item["id"])

    def item_movements(self, item):
        return self.store.movements(self.admin, {"item_id": item["id"]})["movements"]

    def alert_ids(self):
        return {item["id"] for item in self.store.alerts(self.admin)["items"]}

    def reconciliation(self, item):
        return next(row for row in self.store.reconcile(self.admin)["rows"] if row["item_id"] == item["id"])

    def assert_error(self, expected_code, function, *args, **kwargs):
        with self.assertRaises(server.AppError) as context:
            function(*args, **kwargs)
        self.assertEqual(context.exception.code, expected_code)
        return context.exception


class ReportCases(IsolatedStoreCase):
    def test_TC01_normal_inbound(self):
        """TC01 正常入库20，库存与流水同时建立。"""
        item = self.create_item()
        result = self.movement(item, 20)
        self.assertEqual(result["current_stock"], 20)
        self.assertEqual(self.item_movements(item)[0]["quantity"], 20)
        self.assertEqual(self.reconciliation(item)["difference"], 0)

    def test_TC02_invalid_inbound_quantities(self):
        """TC02 零、负数、小数、文字、布尔和空值入库全部拒绝。"""
        item = self.create_item(stock=8)
        before = self.item_movements(item)
        for value in (0, -1, 1.5, "3", True, False, None, {}):
            with self.subTest(quantity=value):
                self.assert_error("INVALID_QUANTITY", self.movement, item, value)
                self.assertEqual(self.current_item(item)["current_stock"], 8)
                self.assertEqual(self.item_movements(item), before)

    def test_TC03_normal_outbound(self):
        """TC03 库存20领用7，剩余13并保存经办人与领用人。"""
        item = self.create_item(stock=20)
        result = self.movement(item, 7, "OUT")
        self.assertEqual(result["current_stock"], 13)
        self.assertEqual(result["movement"]["recipient_id"], "U_A")
        self.assertEqual(result["movement"]["operator_id"], "U_ADMIN")

    def test_TC04_outbound_equal_stock(self):
        """TC04 领用量等于库存时允许并归零。"""
        item = self.create_item(stock=8)
        self.assertEqual(self.movement(item, 8, "OUT")["current_stock"], 0)
        self.assertEqual(len(self.item_movements(item)), 2)

    def test_TC05_outbound_over_stock(self):
        """TC05 库存8领用9被拒绝，库存和历史均不改变。"""
        item = self.create_item(stock=8)
        self.assert_error("INSUFFICIENT_STOCK", self.movement, item, 9, "OUT")
        self.assertEqual(self.current_item(item)["current_stock"], 8)
        self.assertEqual(len(self.item_movements(item)), 1)

    def test_TC06_invalid_outbound_quantities(self):
        """TC06 非法领用数量被拒绝。"""
        item = self.create_item(stock=8)
        for value in (0, -1, 1.5, "2", True, None):
            with self.subTest(quantity=value):
                self.assert_error("INVALID_QUANTITY", self.movement, item, value, "OUT")
        self.assertEqual(self.current_item(item)["current_stock"], 8)
        self.assertEqual(len(self.item_movements(item)), 1)

    def test_TC07_idempotent_replay(self):
        """TC07 同单号同内容两次提交只领用一次。"""
        item = self.create_item(stock=10)
        first = self.movement(item, 3, "OUT")
        second = self.movement(item, 3, "OUT")
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        self.assertEqual(first["movement"], second["movement"])
        self.assertEqual(second["current_stock"], 7)
        self.assertEqual(len(self.item_movements(item)), 2)

    def test_TC08_business_number_conflict(self):
        """TC08 同单号不同数量返回冲突且不改变数据。"""
        item = self.create_item(stock=10)
        self.movement(item, 3, "OUT")
        self.assert_error("BUSINESS_CONFLICT", self.movement, item, 4, "OUT")
        self.assertEqual(self.current_item(item)["current_stock"], 7)
        self.assertEqual(len(self.item_movements(item)), 2)

    def test_TC09_member_cannot_write(self):
        """TC09 普通成员不能调用入库和领用管理操作。"""
        item = self.create_item(stock=8)
        for kind in ("IN", "OUT"):
            error = self.assert_error("FORBIDDEN", self.store.post_movement, self.member_a, {
                "business_no": "NO", "item_id": item["id"], "type": kind,
                "quantity": 1, "recipient_id": "U_A", "note": "",
            })
            self.assertEqual(error.status, 403)
        self.assertEqual(self.current_item(item)["current_stock"], 8)

    def test_TC10_member_cannot_read_other_records(self):
        """TC10 成员只得到本人OUT记录，主动查询他人返回403。"""
        item = self.create_item(stock=8)
        self.movement(item, 2, "OUT", "A-OUT", "U_A")
        self.movement(item, 1, "OUT", "B-OUT", "U_B")
        state = self.store.state(self.member_a)
        self.assertEqual([u["id"] for u in state["users"]], ["U_A"])
        self.assertTrue(all(m["recipient_id"] == "U_A" and m["type"] == "OUT" for m in state["movements"]))
        self.assert_error("FORBIDDEN", self.store.movements, self.member_a, {"recipient_id": "U_B"})

    def test_TC11_inventory_filter_empty_result(self):
        """TC11 编码或名称筛选返回匹配项，不存在的编码返回空列表。"""
        item = self.create_item(code="TEST-BATTERY", name="测试电池")
        self.create_item(code="TEST-PARTS", name="测试元件包")
        self.assertEqual([x["id"] for x in self.store.list_items(self.admin, "TEST-BATTERY")["items"]], [item["id"]])
        self.assertEqual(self.store.list_items(self.admin, "不存在的独立编码")["items"], [])

    def test_TC12_conservation(self):
        """TC12 从零入库20、10再领用7，库存与全历史净额均为23。"""
        item = self.create_item()
        self.movement(item, 20, business_no="IN-1")
        self.movement(item, 10, business_no="IN-2")
        self.movement(item, 7, "OUT", "OUT-1")
        row = self.reconciliation(item)
        self.assertEqual((row["current_stock"], row["ledger_stock"], row["difference"]), (23, 23, 0))

    def test_TC13_below_threshold(self):
        """TC13 库存4下限5进入预警列表。"""
        item = self.create_item(stock=4, threshold=5)
        self.assertIn(item["id"], self.alert_ids())

    def test_TC14_equal_threshold(self):
        """TC14 库存5等于下限5仍进入预警列表。"""
        item = self.create_item(stock=5, threshold=5)
        self.assertIn(item["id"], self.alert_ids())

    def test_TC15_above_threshold(self):
        """TC15 库存6高于下限5不进入预警列表。"""
        item = self.create_item(stock=6, threshold=5)
        self.assertNotIn(item["id"], self.alert_ids())

    def test_TC16_threshold_update_validation(self):
        """TC16 调整下限改变预警，非法下限拒绝且保持原设置。"""
        item = self.create_item(stock=6, threshold=5)
        self.store.update_item(self.admin, item["id"], {"min_stock": 6})
        self.assertIn(item["id"], self.alert_ids())
        for value in (-1, 1.5, "5", None, True):
            with self.subTest(threshold=value):
                self.assert_error("INVALID_QUANTITY", self.store.update_item, self.admin, item["id"], {"min_stock": value})
        self.assertEqual(self.current_item(item)["min_stock"], 6)

    def test_TC17_transaction_rollback(self):
        """TC17 仅在隔离测试中注入写流水前失败，整笔库存事务回滚。"""
        item = self.create_item(stock=8)
        with patch.object(self.store, "_after_stock_update", side_effect=RuntimeError("isolated simulated failure")):
            with self.assertRaises(RuntimeError):
                self.movement(item, 3, "OUT")
        self.assertEqual(self.current_item(item)["current_stock"], 8)
        self.assertEqual(len(self.item_movements(item)), 1)
        self.assertEqual(self.reconciliation(item)["difference"], 0)

    def test_TC18_restock_clears_alert(self):
        """TC18 库存4下限5，入库2后刷新解除预警。"""
        item = self.create_item(stock=4, threshold=5)
        self.assertIn(item["id"], self.alert_ids())
        self.movement(item, 2)
        self.assertEqual(self.current_item(item)["current_stock"], 6)
        self.assertNotIn(item["id"], self.alert_ids())

    def test_TC19_item_constraints(self):
        """TC19 新档案库存为零，重复编码、空名称及直接写库存被拒绝。"""
        item = self.create_item(code="C001", threshold=0)
        self.assertEqual(self.current_item(item)["current_stock"], 0)
        self.assertEqual(self.item_movements(item), [])
        self.assert_error("DUPLICATE_CODE", self.create_item, code="C001")
        self.assert_error("INVALID_FIELD", self.create_item, code="C002", name="   ")
        self.assert_error("UNSUPPORTED_FIELD", self.store.create_item, self.admin, {
            "code": "C003", "name": "不能直接初始化库存", "unit": "件", "current_stock": 7,
        })

    def test_TC20_member_cannot_set_threshold(self):
        """TC20 普通成员修改库存下限返回403，原值不变。"""
        item = self.create_item(threshold=5)
        self.assert_error("FORBIDDEN", self.store.update_item, self.member_a, item["id"], {"min_stock": 6})
        self.assertEqual(self.current_item(item)["min_stock"], 5)

    def test_TC21_inactive_and_zero_threshold(self):
        """TC21 停用保留历史并排除预警，启用恢复预警；零库存零下限仍预警。"""
        item = self.create_item(stock=4, threshold=5, active=False)
        self.assertNotIn(item["id"], self.alert_ids())
        self.assertEqual(len(self.item_movements(item)), 1)
        self.assert_error("ITEM_INACTIVE", self.movement, item, 1, "IN")
        self.assert_error("ITEM_INACTIVE", self.movement, item, 1, "OUT")
        self.store.update_item(self.admin, item["id"], {"active": True})
        self.assertIn(item["id"], self.alert_ids())
        zero = self.create_item(code="ZERO", threshold=0)
        self.assertIn(zero["id"], self.alert_ids())

    def test_TC22_detect_tampering_full_history(self):
        """TC22 隔离测试库人为设库存10、历史8，日期筛选不影响全历史差额2。"""
        item = self.create_item(stock=8)
        with self.store.transaction() as connection:
            connection.execute("UPDATE items SET current_stock=10 WHERE id=?", (item["id"],))
        future = (datetime.now(server.CHINA_TZ).date() + timedelta(days=10)).isoformat()
        self.assertEqual(self.store.movements(self.admin, {"item_id": item["id"], "start": future})["movements"], [])
        row = self.reconciliation(item)
        self.assertEqual((row["current_stock"], row["ledger_stock"], row["difference"]), (10, 8, 2))
        self.assertEqual(self.current_item(item)["current_stock"], 10)


class AdditionalServiceCases(IsolatedStoreCase):
    def test_replay_after_empty_inactive_and_later_stock_change(self):
        """同内容重试在库存耗尽及耗材停用后仍成功，当前数量单独刷新。"""
        item = self.create_item(stock=8)
        first = self.movement(item, 8, "OUT", "RETRY")
        self.store.update_item(self.admin, item["id"], {"active": False})
        retry = self.movement(item, 8, "OUT", "RETRY")
        self.assertEqual(retry["movement"], first["movement"])
        self.assertTrue(retry["idempotent"])
        self.store.update_item(self.admin, item["id"], {"active": True})
        self.movement(item, 4, business_no="LATER")
        retry = self.movement(item, 8, "OUT", "RETRY")
        self.assertEqual(retry["current_stock"], 4)

    def test_normalization_and_immutable_item_fields(self):
        """规范化备注与IN领用人；编码、单位、库存不能通过更新修改。"""
        item = self.create_item()
        first = self.movement(item, 1.0, note="  说明  ")
        replay = self.store.post_movement(self.admin, {
            "business_no": " B001 ", "item_id": item["id"], "type": "IN",
            "quantity": 1, "recipient_id": "not-relevant-to-IN", "note": "说明",
        })
        self.assertEqual(first["movement"], replay["movement"])
        self.assertIsNone(replay["movement"]["recipient_id"])
        for payload in ({"code": "OTHER"}, {"unit": "盒"}, {"current_stock": 900}, {"active": 1}):
            with self.subTest(payload=payload):
                with self.assertRaises(server.AppError):
                    self.store.update_item(self.admin, item["id"], payload)

    def test_quantity_limit_and_invalid_recipient(self):
        """库存最大值与有效领用人规则由服务端拒绝越界写入。"""
        item = self.create_item()
        self.movement(item, server.MAX_QUANTITY, business_no="MAX")
        self.assert_error("STOCK_LIMIT", self.movement, item, 1, business_no="TOO-MUCH")
        self.assert_error("INVALID_QUANTITY", self.movement, item, server.MAX_QUANTITY + 1)
        self.assert_error("INVALID_RECIPIENT", self.movement, item, 1, "OUT", recipient="U_ADMIN")
        self.assertEqual(self.current_item(item)["current_stock"], server.MAX_QUANTITY)

    def test_database_constraints_enforce_types_and_references(self):
        """绕过服务层的隔离SQL写入仍受整数、非空、外键与非负约束保护。"""
        item = self.create_item()
        for value in (-1, 1.5, None):
            with self.subTest(stock=value):
                with self.assertRaises(sqlite3.IntegrityError):
                    with self.store.transaction() as connection:
                        connection.execute("UPDATE items SET current_stock=? WHERE id=?", (value, item["id"]))
        with self.assertRaises(sqlite3.IntegrityError):
            with self.store.transaction() as connection:
                connection.execute("INSERT INTO movements VALUES (?,?,?,?,?,?,?,?,?)", (
                    "BAD", "BAD", "missing", "IN", 1, None, "U_ADMIN", "", server.timestamp()))

    def test_password_hashing_sessions_and_persistence(self):
        """密码用随机盐PBKDF2保存，会话只存令牌摘要，重启不重置业务数据。"""
        item = self.create_item(stock=7)
        with self.store.connection() as connection:
            hashes = [r[0] for r in connection.execute("SELECT password_hash FROM users")]
        self.assertTrue(all(value.startswith("pbkdf2_sha256$") for value in hashes))
        self.assertEqual(len(hashes), len(set(hashes)))
        token = self.store.create_session(self.admin)
        with self.store.connection() as connection:
            saved = connection.execute("SELECT token_hash FROM sessions").fetchone()[0]
        self.assertNotEqual(token, saved)
        reopened = server.Store(self.db_path, ROOT / "seed.json")
        saved_item = next(x for x in reopened.state(self.admin)["items"] if x["id"] == item["id"])
        self.assertEqual(saved_item["current_stock"], 7)
        self.assertEqual(reopened.session_user(token)["id"], "U_ADMIN")
        self.assert_error("INVALID_CREDENTIALS", self.store.login, "admin", "incorrect")

    def test_concurrent_unique_outbounds_never_oversell(self):
        """12个并发请求竞争10件库存，恰好10笔成功且不出现负数。"""
        item = self.create_item(stock=10)
        barrier = threading.Barrier(12)
        def issue(index):
            barrier.wait(timeout=10)
            try:
                self.movement(item, 1, "OUT", f"PARALLEL-{index}")
                return "success"
            except server.AppError as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(issue, range(12)))
        self.assertEqual(results.count("success"), 10)
        self.assertEqual(results.count("INSUFFICIENT_STOCK"), 2)
        self.assertEqual(self.current_item(item)["current_stock"], 0)
        self.assertEqual(self.reconciliation(item)["difference"], 0)

    def test_concurrent_same_business_number_commits_once(self):
        """12个同单号并发重试仅一笔入账，其余返回原流水。"""
        item = self.create_item(stock=10)
        barrier = threading.Barrier(12)
        def retry(_):
            barrier.wait(timeout=10)
            return self.movement(item, 3, "OUT", "CONCURRENT-SAME")
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(retry, range(12)))
        self.assertEqual(sum(not result["idempotent"] for result in results), 1)
        self.assertEqual(len({result["movement"]["id"] for result in results}), 1)
        self.assertEqual(self.current_item(item)["current_stock"], 7)
        self.assertEqual(len(self.item_movements(item)), 2)

    def test_reconciliation_snapshot_during_concurrent_writes(self):
        """读写并发时核对使用一致快照，不将不同时点误报为库存差额。"""
        item = self.create_item(stock=1)
        barrier = threading.Barrier(2)
        def write():
            barrier.wait(timeout=10)
            for index in range(30):
                self.movement(item, 1, "IN", f"SNAP-IN-{index}")
                self.movement(item, 1, "OUT", f"SNAP-OUT-{index}")
        def read():
            barrier.wait(timeout=10)
            for _ in range(50):
                self.assertEqual(self.reconciliation(item)["difference"], 0)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(write), pool.submit(read)]
            for future in futures:
                future.result(timeout=20)
        self.assertEqual(self.current_item(item)["current_stock"], 1)


class HTTPContractCases(IsolatedStoreCase):
    def setUp(self):
        super().setUp()
        self.web_root = Path(self.directory.name) / "web"
        self.web_root.mkdir()
        (self.web_root / "index.html").write_text("<!doctype html><title>独立HTTP测试</title>", encoding="utf-8")
        self.httpd = server.LabHTTPServer(("127.0.0.1", 0), self.store, self.web_root)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.cookie = ""

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        super().tearDown()

    def request(self, method, path, payload=None, *, cookie=None, headers=None, raw=None):
        request_headers = dict(headers or {})
        body = raw
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        token = self.cookie if cookie is None else cookie
        if token:
            request_headers["Cookie"] = token
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            content = response.read()
            response_headers = dict(response.getheaders())
            data = json.loads(content) if content and "application/json" in response_headers.get("Content-Type", "") else content
            return response.status, data, response_headers
        finally:
            connection.close()

    def login_http(self, username="admin", password="Admin123!"):
        status, body, headers = self.request("POST", "/api/login", {"username": username, "password": password}, cookie="")
        self.assertEqual(status, 200)
        self.cookie = headers["Set-Cookie"].split(";", 1)[0]
        return body, headers

    def test_http_login_cookie_and_anonymous_state(self):
        """真实HTTP：匿名会话、401、密码登录与HttpOnly/SameSite Cookie。"""
        status, payload, _ = self.request("GET", "/api/session")
        self.assertEqual((status, payload["data"]["user"]), (200, None))
        self.assertEqual(self.request("GET", "/api/state")[0], 401)
        self.assertEqual(self.request("POST", "/api/login", {"username": "admin", "password": "wrong"})[0], 401)
        _, headers = self.login_http()
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Strict", headers["Set-Cookie"])
        status, payload, _ = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["mode"], "server")
        self.assertNotIn("password", json.dumps(payload))

    def test_http_member_authorization_and_replay(self):
        """真实HTTP：成员越权写入、预警、核对及查询他人记录被403拒绝。"""
        item = self.create_item(stock=8)
        original = self.movement(item, 2, "OUT", "ADMIN-REPLAY")["movement"]
        self.login_http("member_a", "Member123!")
        mutation = {key: original[key] for key in ("business_no", "item_id", "type", "quantity", "recipient_id", "note")}
        for method, path, body in (
            ("POST", "/api/movements", mutation),
            ("PATCH", "/api/items/" + item["id"], {"min_stock": 2}),
            ("GET", "/api/alerts", None),
            ("GET", "/api/reconciliation", None),
            ("GET", "/api/movements?recipient_id=U_B", None),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, body)[0], 403)
        _, payload, _ = self.request("GET", "/api/state")
        self.assertEqual(len(payload["data"]["users"]), 1)
        self.assertTrue(all(m["recipient_id"] == "U_A" for m in payload["data"]["movements"]))

    def test_http_origin_host_and_content_type(self):
        """真实HTTP：跨站Origin、伪造Host、跨站元信息和表单内容类型被拒绝。"""
        self.login_http()
        item = {"code": "HTTP-CSRF", "name": "HTTP测试", "unit": "件"}
        self.assertEqual(self.request("POST", "/api/items", item, headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/items", item, headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("GET", "/api/state", headers={"Host": f"evil.example:{self.port}"})[0], 403)
        self.assertEqual(self.request("POST", "/api/items", raw=b"code=x", headers={"Content-Type": "application/x-www-form-urlencoded"})[0], 415)
        self.assertEqual(self.request("POST", "/api/items", item, headers={"Origin": f"http://127.0.0.1:{self.port}"})[0], 201)

    def test_http_no_fault_or_mutable_movement_endpoints(self):
        """真实HTTP：无故障注入接口，流水无编辑和删除接口。"""
        self.login_http()
        for method, path in (("POST", "/api/test/fail"), ("POST", "/api/fault"),
                             ("PATCH", "/api/movements/DEMO-IN-I001"), ("DELETE", "/api/movements/DEMO-IN-I001")):
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, {})[0], 404)

    def test_http_logout_and_expiration(self):
        """真实HTTP：退出撤销会话，已过期Cookie不再能读取受限数据。"""
        self.login_http()
        old_cookie = self.cookie
        self.assertEqual(self.request("POST", "/api/logout", {})[0], 200)
        self.assertEqual(self.request("GET", "/api/state", cookie=old_cookie)[0], 401)
        self.login_http()
        with self.store.transaction() as connection:
            connection.execute("UPDATE sessions SET expires_at=0")
        self.assertEqual(self.request("GET", "/api/state")[0], 401)

    def test_http_static_query_and_path_safety(self):
        """真实HTTP：静态首页支持查询参数，不能越过web目录读取后端文件。"""
        status, body, headers = self.request("GET", "/?app=inventory")
        self.assertEqual(status, 200)
        self.assertIn("独立HTTP测试", body.decode())
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        for path in ("/server.py", "/../seed.json", "/%2e%2e/seed.json", "/.secret"):
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_http_query_alerts_and_china_dates(self):
        """真实HTTP：库存筛选、预警和北京时间自然日筛选；核对不受日期参数限制。"""
        item = self.create_item(stock=4, code="HTTP-DATE", threshold=5)
        self.login_http()
        _, payload, _ = self.request("GET", "/api/items?" + urlencode({"q": "HTTP-DATE"}))
        self.assertEqual([x["id"] for x in payload["data"]["items"]], [item["id"]])
        _, payload, _ = self.request("GET", "/api/alerts")
        self.assertIn(item["id"], {x["id"] for x in payload["data"]["items"]})
        today = datetime.now(server.CHINA_TZ).date().isoformat()
        _, payload, _ = self.request("GET", "/api/movements?" + urlencode({"item_id": item["id"], "start": today, "end": today}))
        self.assertEqual(len(payload["data"]["movements"]), 1)
        self.assertEqual(self.request("GET", "/api/movements?start=bad-date")[0], 400)
        _, payload, _ = self.request("GET", "/api/reconciliation?start=2999-01-01")
        row = next(r for r in payload["data"]["rows"] if r["item_id"] == item["id"])
        self.assertEqual(row["ledger_stock"], 4)

    def test_http_reset_requires_confirmation(self):
        """真实HTTP：明确确认后才重置演示数据，当前管理员获新会话。"""
        item = self.create_item(stock=7, code="REMOVE-ON-RESET")
        self.login_http()
        old_cookie = self.cookie
        self.assertEqual(self.request("POST", "/api/demo/reset", {"confirm": "no"})[0], 400)
        self.assertEqual(self.current_item(item)["current_stock"], 7)
        status, payload, headers = self.request("POST", "/api/demo/reset", {"confirm": "RESET_DEMO"})
        self.assertEqual((status, payload["data"]["reset"]), (200, True))
        self.cookie = headers["Set-Cookie"].split(";", 1)[0]
        self.assertNotEqual(old_cookie, self.cookie)
        self.assertEqual(self.request("GET", "/api/state", cookie=old_cookie)[0], 401)
        _, payload, _ = self.request("GET", "/api/state")
        self.assertFalse(any(x["id"] == item["id"] for x in payload["data"]["items"]))
        self.assertTrue(all(row["difference"] == 0 for row in self.store.reconcile(self.admin)["rows"]))

    def test_http_json_and_unsupported_fields(self):
        """真实HTTP：非法JSON、非标准数值与伪造故障字段被拒绝。"""
        self.login_http()
        for raw in (b"{", b'{"quantity":NaN}', b"[]"):
            self.assertEqual(self.request("POST", "/api/movements", raw=raw, headers={"Content-Type": "application/json"})[0], 400)
        item = self.create_item(stock=3)
        body = {"business_no": "BAD-HOOK", "item_id": item["id"], "type": "OUT", "quantity": 1, "recipient_id": "U_A", "fail_after_stock": True}
        status, payload, _ = self.request("POST", "/api/movements", body)
        self.assertEqual((status, payload["error"]["code"]), (400, "UNSUPPORTED_FIELD"))

    def test_http_idempotency_and_conflict_status(self):
        """真实HTTP：重复提交保持200并标记幂等，内容冲突为409。"""
        item = self.create_item(stock=10)
        self.login_http()
        body = {"business_no": "HTTP-RETRY", "item_id": item["id"], "type": "OUT", "quantity": 3, "recipient_id": "U_A", "note": ""}
        first = self.request("POST", "/api/movements", body)
        second = self.request("POST", "/api/movements", body)
        self.assertEqual((first[0], second[0]), (200, 200))
        self.assertEqual(first[1]["data"]["movement"], second[1]["data"]["movement"])
        self.assertTrue(second[1]["data"]["idempotent"])
        body["quantity"] = 4
        self.assertEqual(self.request("POST", "/api/movements", body)[0], 409)


class StartupIntegrationCases(IsolatedStoreCase):
    def test_help_does_not_build_downloads(self):
        """CLI帮助在构建和数据库初始化前结束，不生成下载文件。"""
        with patch("package_release.create_release") as builder, patch.object(server, "Store") as store:
            with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as stopped:
                server.main(["--help"])
        self.assertEqual(stopped.exception.code, 0)
        builder.assert_not_called()
        store.assert_not_called()

    def test_failed_release_preserves_database_and_session(self):
        """CLI构建失败清晰报错且不启动服务，已有数据库和会话不变。"""
        item = self.create_item(stock=7, code="PRESERVE-ON-FAILURE")
        token = self.store.create_session(self.admin)
        before = self.db_path.read_bytes()
        error_output = io.StringIO()
        with patch("package_release.create_release", side_effect=OSError("isolated packaging failure")):
            with patch.object(server, "Store") as constructor, patch.object(server, "LabHTTPServer") as httpd:
                with redirect_stderr(error_output), self.assertRaises(SystemExit) as stopped:
                    server.main(["--db", str(self.db_path)])
        self.assertEqual(stopped.exception.code, 1)
        self.assertIn("生成本地下载文件失败", error_output.getvalue())
        self.assertIn("现有业务数据库未改动", error_output.getvalue())
        constructor.assert_not_called()
        httpd.assert_not_called()
        self.assertEqual(before, self.db_path.read_bytes())
        self.assertEqual(self.current_item(item)["current_stock"], 7)
        self.assertEqual(self.store.session_user(token)["id"], "U_ADMIN")

    def test_real_cli_start_generates_downloads_and_preserves_state(self):
        """Linux实际CLI启动生成三类下载包，原始HTTP核对MIME/字节/ZIP和既有数据会话。"""
        # Copy the project so the real CLI can build releases without touching live downloads.
        project = Path(self.directory.name) / "site"
        excluded = shutil.ignore_patterns(
            ".git", ".openai", "data", "downloads", "dist", "node_modules", "__pycache__",
            ".sites-runtime", ".sites-checkout", "test-artifacts", "*.db", "*.sqlite", "*.log", "*.pyc",
            "lab-case-*", "lab-master-*",
        )
        shutil.copytree(ROOT, project, ignore=excluded)
        item = self.create_item(stock=7, code="PRESERVE-ON-START")
        token = self.store.create_session(self.admin)
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8"
        process = subprocess.Popen(
            [sys.executable, "server.py", "--port", "0", "--db", str(self.db_path)],
            cwd=project, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", bufsize=1,
        )
        lines = Queue()
        def capture_output():
            for line in process.stdout:
                lines.put(line)
            lines.put(None)
        reader = threading.Thread(target=capture_output, daemon=True)
        reader.start()
        output = []
        port = None
        try:
            deadline = time.monotonic() + 20
            while port is None and time.monotonic() < deadline:
                try:
                    line = lines.get(timeout=max(0.1, deadline - time.monotonic()))
                except Empty:
                    break
                if line is None:
                    break
                output.append(line)
                match = re.search(r"http://127\.0\.0\.1:(\d+)", line)
                if match and "已启动" in line:
                    port = int(match.group(1))
            self.assertIsNotNone(port, "CLI did not start:\n" + "".join(output))
            def get(path, cookie=None):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                try:
                    connection.request("GET", path, headers={"Cookie": cookie} if cookie else {})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()
            for page in ("/", "/app.html?app=inventory", "/guide.html", "/download.html"):
                self.assertEqual(get(page)[0], 200, page)
            downloads = project / "web" / "downloads"
            expected_types = {".zip": "application/zip", ".html": "text/html", ".txt": "text/plain"}
            files = [path for path in downloads.iterdir() if path.suffix in expected_types]
            self.assertEqual(sorted(path.suffix for path in files), sorted(expected_types))
            for path in files:
                status, headers, content = get("/downloads/" + server.quote(path.name, safe=""))
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"].split(";")[0], expected_types[path.suffix])
                self.assertTrue(headers["Content-Disposition"].startswith("attachment;"))
                self.assertEqual(content, path.read_bytes())
                self.assertEqual(int(headers["Content-Length"]), len(content))
            archive = next(path for path in files if path.suffix == ".zip")
            with ZipFile(archive) as compressed:
                self.assertIsNone(compressed.testzip())
                self.assertFalse(any("/downloads/" in name or "/data/" in name for name in compressed.namelist()))
            self.assertEqual(get("/downloads/%2e%2e/%2e%2e/seed.json")[0], 404)
            status, _, content = get("/api/state", f"{server.COOKIE_NAME}={token}")
            self.assertEqual(status, 200)
            state = json.loads(content)["data"]
            self.assertEqual(next(x for x in state["items"] if x["id"] == item["id"])["current_stock"], 7)
            self.assertEqual(state["user"]["id"], "U_ADMIN")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            reader.join(timeout=2)
            process.stdout.close()


class RecordingResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = {}
        self.started = {}

    def startTest(self, test):
        self.started[test.id()] = time.perf_counter()
        super().startTest(test)

    def _record(self, test, status, detail=None):
        name = test.id()
        tc = re.search(r"test_(TC\d{2})_", name)
        self.records[name] = {
            "name": name, "description": test.shortDescription() or "",
            "status": status, "report_case": tc.group(1) if tc else None,
            "layer": ("startup+http+release" if "StartupIntegrationCases" in name
                      else "http" if "HTTPContractCases" in name else "service+sqlite"),
            "duration_seconds": round(time.perf_counter() - self.started.get(name, time.perf_counter()), 4),
        }
        if detail:
            self.records[name]["detail"] = detail

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "failed", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "error", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "skipped", reason)

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err:
            self._record(test, "failed", self._exc_info_to_string(err, test))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=ROOT / "docs" / "backend-test-results.json")
    args = parser.parse_args()
    suite = unittest.TestSuite()
    for cls in (ReportCases, AdditionalServiceCases, HTTPContractCases, StartupIntegrationCases):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    started = time.perf_counter()
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult).run(suite)
    records = list(result.records.values())
    report = {
        "generated_at": server.timestamp(), "python_version": platform.python_version(),
        "platform": platform.platform(), "sqlite_version": sqlite3.sqlite_version,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "tests_run": result.testsRun, "passed": sum(r["status"] == "passed" for r in records),
        "failed": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped),
        "successful": result.wasSuccessful(),
        "report_cases_covered": sorted(r["report_case"] for r in records if r["report_case"]),
        "scope": "真实执行的Python业务服务、隔离SQLite数据库、本机原始HTTP、CLI启动及下载构建测试；不包含真实问卷、管理员访谈或用户验收。",
        "safety": "所有数据库均位于临时测试目录，未修改data/lab.db；故障注入仅由测试进程替换内部方法，没有HTTP故障入口。",
        "launchers": "Windows批处理仅静态检查；本报告不声称在Windows或macOS真机运行。",
        "results": records,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n实测结果：{args.report}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
