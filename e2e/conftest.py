"""Shared fixtures for LOOP's browser tests (pytest + Playwright, sync API).

Run against a running LOOP (API + built frontend + MySQL):
    BASE_URL=http://localhost:4000 python -m pytest e2e -q

Seeded development/CI accounts are used by default; override with
E2E_ADMIN_LOGIN / E2E_ADMIN_PASSWORD for another environment.
Every test creates its own users, so tests do not depend on each other.
"""
import json
import os
import re
import secrets
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect, sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4000").rstrip("/")
ADMIN = (os.environ.get("E2E_ADMIN_LOGIN", "admin"), os.environ.get("E2E_ADMIN_PASSWORD", "Admin@123"))
SHOTS = Path(os.environ.get("SHOTS", Path(__file__).parent / "screenshots"))
AXE = Path(__file__).resolve().parent.parent / "node_modules" / "axe-core" / "axe.min.js"
VIEWPORTS = {"mobile": (390, 844), "tablet": (820, 1180), "desktop": (1440, 900)}


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Watch:
    """Collects console errors, page errors and failed API responses for a page."""

    def __init__(self, page: Page, allow_status=()):
        self.errors = []
        self.allow = set(allow_status)
        page.on("console", lambda m: m.type == "error" and not _expected_console(m.text) and self.errors.append(f"console: {m.text}"))
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        page.on("response", self._response)

    def _response(self, r):
        if "/api/" in r.url and r.status >= 500 and r.status not in self.allow:
            self.errors.append(f"{r.status} {r.request.method} {r.url}")

    def assert_clean(self):
        assert not self.errors, "\n".join(self.errors)


def _expected_console(text):
    # Browsers log every non-2xx fetch as a console error; failures are asserted
    # separately through responses, so only real script errors count here.
    return bool(re.search(r"Failed to load resource: the server responded with a status of 4\d\d", text))


@pytest.fixture
def page(browser):
    # bypass_csp only lets the test inject axe-core; the app itself runs under its normal CSP.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, base_url=BASE_URL, bypass_csp=True)
    pg = ctx.new_page()
    pg.watch = Watch(pg)
    yield pg
    ctx.close()


def new_context(browser, viewport="desktop"):
    w, h = VIEWPORTS[viewport]
    return browser.new_context(viewport={"width": w, "height": h}, base_url=BASE_URL, bypass_csp=True)


def uid():
    return secrets.token_hex(3)


def register(page: Page, name=None):
    """Create a User through the registration form; returns (username, password)."""
    username = name or f"e2e_{uid()}"
    password = "Listen1234"
    page.goto("/register")
    page.get_by_label("Name", exact=True).fill("E2E Listener")
    page.get_by_label(re.compile(r"^Username")).fill(username)
    page.get_by_label("Email").fill(f"{username}@example.test")
    page.get_by_label(re.compile(r"^Password")).fill(password)
    page.get_by_label("Confirm password").fill(password)
    page.get_by_role("button", name="Create account").click()
    expect(page).to_have_url(re.compile(r"/settings/preferences\?welcome=1"))
    return username, password


def sign_in(page: Page, login, password):
    page.goto("/login")
    page.get_by_label("Username or email").fill(login)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    expect(page).not_to_have_url(re.compile(r"/login"))


def sign_out(page: Page):
    page.get_by_role("button", name="Sign out").first.click()
    expect(page).to_have_url(re.compile(r"/login\?signedOut=1"))


def api(page: Page, method, path, body=None):
    """Call LOOP's API with the page's own cookies (and CSRF token), like the app does."""
    csrf = next((c["value"] for c in page.context.cookies() if c["name"] == "muse_csrf"), "")
    r = page.request.fetch(f"{BASE_URL}/api{path}", method=method, data=json.dumps(body) if body is not None else None,
                           headers={"Content-Type": "application/json", "X-CSRF-Token": csrf})
    try:
        return r.status, r.json()
    except Exception:
        return r.status, None


def axe_violations(page: Page):
    """Serious and critical axe-core violations on the current page (None when axe-core is not installed)."""
    if not AXE.exists():
        return None
    page.add_script_tag(path=str(AXE))
    result = page.evaluate("async () => await axe.run(document, { resultTypes: ['violations'] })")
    return [f"{v['id']}: {v['help']} ({len(v['nodes'])})" for v in result["violations"] if v["impact"] in ("serious", "critical")]


def shot(page: Page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
