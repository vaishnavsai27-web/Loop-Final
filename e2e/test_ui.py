"""Interface quality: every route at three sizes, no script errors, no horizontal overflow,
accessibility (axe-core), keyboard use, and honest loading / empty / error states."""
import re
import time

import pytest
from playwright.sync_api import expect

from conftest import ADMIN, VIEWPORTS, Watch, api, axe_violations, new_context, register, shot, sign_in

PUBLIC = ["/", "/login", "/register"]
USER = ["/discover", "/search?q=calm", "/library", "/library?tab=liked", "/library?tab=moods", "/library?tab=hidden",
        "/settings", "/settings/preferences", "/settings/security", "/settings/artist", "/settings/account", "/nowhere"]
ADMIN_ROUTES = ["/admin", "/admin/users", "/admin/applications", "/admin/uploads", "/admin/catalogue", "/admin/media",
                "/admin/permissions", "/admin/health"]


def check_layout(page, name):
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 1, f"{name}: page scrolls sideways by {overflow}px"
    expect(page.locator("h1").first).to_be_attached()


@pytest.mark.parametrize("viewport", list(VIEWPORTS))
def test_public_and_user_routes_render_cleanly(browser, viewport):
    ctx = new_context(browser, viewport)
    page = ctx.new_page()
    watch = Watch(page)
    for path in PUBLIC:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        check_layout(page, f"{viewport} {path}")
    register(page)
    for path in USER:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        check_layout(page, f"{viewport} {path}")
        shot(page, f"{viewport}{path.replace('/', '_').replace('?', '_')}")
    if VIEWPORTS[viewport][0] < 960:   # phones and portrait tablets get the bottom tab bar
        expect(page.get_by_role("navigation", name="Main navigation (mobile)")).to_be_visible()
    else:
        expect(page.get_by_role("navigation", name="Main navigation", exact=True)).to_be_visible()
    watch.assert_clean()
    ctx.close()


@pytest.mark.parametrize("viewport", list(VIEWPORTS))
def test_admin_routes_render_cleanly(browser, viewport):
    ctx = new_context(browser, viewport)
    page = ctx.new_page()
    watch = Watch(page)
    sign_in(page, *ADMIN)
    for path in ADMIN_ROUTES:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        check_layout(page, f"{viewport} {path}")
    if VIEWPORTS[viewport][0] < 960:
        expect(page.get_by_role("navigation", name="Admin sections")).to_be_visible()
    watch.assert_clean()
    ctx.close()


def test_accessibility_of_key_screens(page):
    pages = ["/", "/login", "/register"]
    for path in pages:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        found = axe_violations(page)
        if found is None:
            pytest.skip("axe-core is not installed (npm ci installs it as a dev dependency)")
        assert not found, f"{path}: {found}"
    register(page)
    for path in ["/discover", "/library", "/settings", "/settings/preferences", "/search?q=calm"]:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        assert not axe_violations(page), path
    page.goto("/discover")
    page.get_by_role("group", name=re.compile("Moods")).get_by_role("button").first.click()
    page.get_by_role("button", name="Find music").click()
    expect(page.locator("ol.songs > li.song").first).to_be_visible()
    assert not axe_violations(page), "discover results"


def test_keyboard_only_mood_request(page):
    register(page)
    page.goto("/discover")
    expect(page.get_by_role("button", name="Find music")).to_be_visible()
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Skip to content")).to_be_focused()
    page.get_by_label(re.compile(r"How are you feeling")).focus()
    page.keyboard.type("I want something calm")
    page.keyboard.press("Enter")
    expect(page.locator("ol.songs > li.song").first).to_be_visible()


def test_backend_failure_is_explained_not_hidden(page):
    register(page)
    page.route("**/api/recommendations/mood", lambda route: route.fulfill(status=503, content_type="application/json",
              body='{"error":{"code":"DATABASE_NOT_CONFIGURED","message":"LOOP is deployed, but its MySQL database connection is not configured yet."}}'))
    page.goto("/discover")
    page.get_by_role("group", name=re.compile("Moods")).get_by_role("button").first.click()
    page.get_by_role("button", name="Find music").click()
    expect(page.get_by_role("alert")).to_contain_text("MySQL database connection is not configured")
    page.unroute("**/api/recommendations/mood")
    page.route("**/api/playlists", lambda route: route.abort())
    page.goto("/library")
    expect(page.get_by_role("alert")).to_contain_text("can’t be reached")
    expect(page.get_by_role("button", name="Try again")).to_be_visible()


def test_empty_states_guide_a_new_user(page):
    register(page)
    page.goto("/library")
    expect(page.get_by_text("Nothing saved yet")).to_be_visible()
    expect(page.get_by_role("link", name="Find music for a mood")).to_be_visible()
    page.goto("/library?tab=liked")
    expect(page.get_by_text("No liked songs yet")).to_be_visible()
    page.goto("/library?tab=moods")
    expect(page.get_by_text("No mood requests yet")).to_be_visible()


def test_loading_state_is_shown_while_recommendations_are_built(page):
    register(page)
    page.route("**/api/recommendations/mood", lambda route: (time.sleep(0.6), route.continue_()))
    page.goto("/discover")
    page.get_by_role("group", name=re.compile("Moods")).get_by_role("button").first.click()
    page.get_by_role("button", name="Find music").click()
    expect(page.get_by_role("button", name="Finding music…")).to_be_visible()
    expect(page.locator("ol.songs > li.song").first).to_be_visible()


def test_dialogs_close_with_escape(page):
    register(page)
    page.goto("/discover")
    page.get_by_role("group", name=re.compile("Moods")).get_by_role("button").first.click()
    page.get_by_role("button", name="Find music").click()
    page.locator("ol.songs > li.song").first.get_by_role("button", name=re.compile(r"^Save .* to a playlist")).click()
    expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_have_count(0)


def test_no_third_party_music_services_in_the_interface(page):
    banned = re.compile(r"spotify|apple music|itunes|youtube|jamendo|deezer|soundcloud|kaggle|theaudiodb|musicbrainz", re.I)
    for path in ["/", "/login", "/register"]:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        assert not banned.search(page.content()), path
    register(page)
    for path in USER:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        assert not banned.search(page.content()), path
