"""Authentication journeys: registration, sign-in, sign-out, sessions and protected pages."""
import re

from playwright.sync_api import expect

from conftest import ADMIN, api, register, sign_in, sign_out, uid


def test_registration_creates_a_user_and_opens_preferences(page):
    username, _ = register(page)
    expect(page.get_by_text("Welcome to LOOP.")).to_be_visible()
    status, me = api(page, "GET", "/auth/me")
    assert status == 200 and me["username"] == username and me["role"] == "LISTENER"
    page.watch.assert_clean()


def test_registration_rejects_duplicates_and_invalid_input(page):
    username, _ = register(page)
    sign_out_via_api(page)
    page.goto("/register")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_text("Use 3–30 lowercase letters, digits or _.")).to_be_visible()
    expect(page.get_by_text("Use at least 8 characters with a letter and a number.")).to_be_visible()
    page.get_by_label("Name", exact=True).fill("Copy")
    page.get_by_label(re.compile(r"^Username")).fill(username)
    page.get_by_label("Email").fill(f"other_{uid()}@example.test")
    page.get_by_label(re.compile(r"^Password")).fill("Listen1234")
    page.get_by_label("Confirm password").fill("Listen1234")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("alert")).to_contain_text("That username is taken.")


def sign_out_via_api(page):
    api(page, "POST", "/auth/logout")
    page.context.clear_cookies()


def test_invalid_login_shows_a_generic_error(page):
    page.goto("/login")
    page.get_by_label("Username or email").fill(f"nobody_{uid()}")
    page.get_by_label("Password").fill("WrongPass1")
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("alert")).to_contain_text("That username or password is not right.")
    expect(page).to_have_url(re.compile(r"/login"))


def test_sign_in_lands_on_the_role_home_and_persists_across_reloads(page):
    username, password = register(page)
    sign_out(page)
    sign_in(page, username, password)
    expect(page).to_have_url(re.compile(r"/discover$"))
    page.reload()
    expect(page.get_by_text("How are you feeling")).to_be_visible()
    sign_out(page)
    sign_in(page, *ADMIN)
    expect(page).to_have_url(re.compile(r"/admin$"))


def test_sign_out_revokes_the_session(page):
    register(page)
    sign_out(page)
    status, _ = api(page, "GET", "/auth/me")
    assert status == 401
    page.goto("/library")
    expect(page).to_have_url(re.compile(r"/login\?next=%2Flibrary"))


def test_protected_pages_redirect_to_sign_in_and_return_afterwards(page):
    username, password = register(page)
    sign_out(page)
    page.goto("/settings/security")
    expect(page).to_have_url(re.compile(r"/login\?next="))
    page.get_by_label("Username or email").fill(username)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(re.compile(r"/settings/security$"))


def test_an_expired_or_revoked_session_sends_the_user_to_sign_in(page):
    register(page)
    page.goto("/library")
    expect(page.get_by_text("Nothing saved yet")).to_be_visible()
    # Revoke this session on the server (as "sign out everywhere" from another device would).
    status, _ = api(page, "POST", "/auth/logout-all")
    assert status == 200
    page.get_by_role("tab", name="Liked songs").click()
    expect(page).to_have_url(re.compile(r"/login"))


def test_unauthorized_api_access_is_refused(page):
    page.goto("/")
    for path in ["/auth/me", "/likes", "/playlists", "/admin/users", "/artist/me"]:
        status, body = api(page, "GET", path)
        assert status == 401, path
        assert body["error"]["code"] in ("UNAUTHORIZED", "TOKEN_INVALID")
