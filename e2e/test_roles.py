"""Role boundaries: User → Artist application → Admin approval → Artist studio; Admin console; wrong-role access."""
import re

from playwright.sync_api import expect

from conftest import ADMIN, BASE_URL, api, register, sign_in, sign_out, uid

ADMIN_PAGES = ["/admin", "/admin/users", "/admin/applications", "/admin/uploads", "/admin/catalogue", "/admin/media", "/admin/permissions", "/admin/health"]
STUDIO_PAGES = ["/studio", "/studio/profile", "/studio/upload", "/studio/submissions", "/studio/rights"]


def apply_and_approve(page, browser):
    """Register, apply for Artist access in the UI, approve as Admin in a second browser. Returns (username, password, stage)."""
    username, password = register(page)
    page.goto("/settings/artist")
    stage = f"The E2E Band {uid()}"
    page.get_by_label("Artist or stage name").fill(stage)
    page.get_by_role("button", name="Send application").click()
    expect(page.get_by_text("Your application is waiting for an Admin.")).to_be_visible()
    ctx = browser.new_context(base_url=BASE_URL, viewport={"width": 1440, "height": 900})
    admin = ctx.new_page()
    sign_in(admin, *ADMIN)
    admin.goto("/admin/applications")
    item = admin.locator("li.list-item", has_text=stage)
    item.get_by_role("button", name="Approve").click()
    expect(admin.get_by_role("status").last).to_contain_text("is now an Artist")
    ctx.close()
    return username, password, stage


def test_user_sees_only_listener_navigation_and_is_denied_studio_and_admin(page):
    register(page)
    page.goto("/discover")
    nav = page.get_by_role("navigation", name="Main navigation")
    for item in ["Discover", "Search", "Library", "Settings"]:
        expect(nav.get_by_role("link", name=item)).to_be_visible()
    expect(page.get_by_role("link", name="Admin console")).to_have_count(0)
    expect(page.get_by_role("link", name="Artist studio")).to_have_count(0)
    page.goto("/admin/users")
    expect(page.get_by_role("heading", name="This area is for Admins")).to_be_visible()
    page.goto("/studio/upload")
    expect(page.get_by_role("heading", name="This area is for Artists")).to_be_visible()
    for path in ["/admin/overview", "/admin/users", "/admin/permissions"]:
        assert api(page, "GET", path)[0] == 403, path
    status, body = api(page, "PATCH", "/admin/users/1", {"role": "ADMIN"})
    assert status == 403


def test_artist_application_approval_and_studio(page, browser):
    username, password, stage = apply_and_approve(page, browser)
    page.reload()
    expect(page.get_by_text("Your Artist access is active.")).to_be_visible()
    page.get_by_role("link", name="Artist studio").first.click()
    expect(page).to_have_url(re.compile(r"/studio$"))
    expect(page.get_by_role("heading", name=stage)).to_be_visible()
    for path in STUDIO_PAGES:
        page.goto(path)
        expect(page.locator("h1").first).to_be_visible()
    # profile management
    page.goto("/studio/profile")
    page.get_by_label(re.compile(r"^Bio")).fill("Songs written on night trains.")
    page.get_by_role("button", name="Save profile").click()
    expect(page.get_by_role("status").last).to_contain_text("Artist profile saved")
    # an Artist is still denied the Admin console, in the UI and the API
    page.goto("/admin")
    expect(page.get_by_role("heading", name="This area is for Admins")).to_be_visible()
    assert api(page, "GET", "/admin/artist-uploads")[0] == 403
    assert api(page, "POST", "/admin/artist-uploads/" + "a" * 32 + "/publish", {})[0] == 403


def test_upload_form_validates_or_explains_that_uploads_are_off(page, browser):
    apply_and_approve(page, browser)
    page.goto("/studio/upload")
    status, me = api(page, "GET", "/artist/me")
    if not me["uploadsEnabled"]:
        expect(page.get_by_text("Uploads are paused on this deployment.")).to_be_visible()
        expect(page.get_by_role("button", name="Upload recording")).to_be_disabled()
        return
    page.get_by_role("button", name="Upload recording").click()
    expect(page.get_by_text("Enter the recording title.")).to_be_visible()
    expect(page.get_by_text("Choose an audio file.")).to_be_visible()
    expect(page.get_by_text("Confirm that you have the rights to publish this recording.")).to_be_visible()


def test_admin_console_navigation_and_permission_rules(page):
    sign_in(page, *ADMIN)
    expect(page).to_have_url(re.compile(r"/admin$"))
    for path in ADMIN_PAGES:
        page.goto(path)
        expect(page.locator("h1").first).to_be_visible()
    page.goto("/admin/permissions")
    expect(page.get_by_role("columnheader", name="User")).to_be_visible()
    expect(page.get_by_role("columnheader", name="Artist")).to_be_visible()
    expect(page.get_by_role("columnheader", name="Admin")).to_be_visible()
    # the console offers no way to grant Admin, and the API refuses it
    page.goto("/admin/users")
    selects = page.locator("select[aria-label^='Role for']")
    expect(selects.first).to_be_visible()
    assert "ADMIN" not in selects.first.locator("option").evaluate_all("els => els.map(e => e.value)")
    status, body = api(page, "GET", "/admin/users?q=")
    target = next(u for u in body if u["role"] == "LISTENER")
    status, body = api(page, "PATCH", f"/admin/users/{target['id']}", {"role": "ADMIN"})
    assert status == 403 and body["error"]["code"] == "ADMIN_PROVISIONING_ONLY"
    page.watch.assert_clean()


def test_admin_rejects_an_application_and_deactivates_a_user(page, browser):
    username, password = register(page)
    page.goto("/settings/artist")
    stage = f"Rejected Act {uid()}"
    page.get_by_label("Artist or stage name").fill(stage)
    page.get_by_role("button", name="Send application").click()
    sign_out(page)
    sign_in(page, *ADMIN)
    page.goto("/admin/applications")
    item = page.locator("li.list-item", has_text=stage)
    item.get_by_label(re.compile("Note for")).fill("Please add a link to your work.")
    item.get_by_role("button", name="Reject").click()
    expect(page.get_by_role("status").last).to_contain_text("Application rejected")
    page.goto("/admin/users")
    page.get_by_label("Find a user").fill(username)
    page.get_by_role("button", name="Find").click()
    row = page.locator("tr", has_text=username)
    row.get_by_role("button", name="Deactivate").click()
    expect(row.get_by_text("deactivated")).to_be_visible()
    # the deactivated user can no longer sign in
    ctx = browser.new_context(base_url=BASE_URL)
    p2 = ctx.new_page()
    p2.goto("/login")
    p2.get_by_label("Username or email").fill(username)
    p2.get_by_label("Password").fill(password)
    p2.get_by_role("button", name="Sign in").click()
    expect(p2.get_by_role("alert")).to_contain_text("deactivated")
    ctx.close()
    row.get_by_role("button", name="Reactivate").click()
    expect(row.get_by_text("active", exact=True)).to_be_visible()


def test_admin_catalogue_hide_and_activate(page):
    sign_in(page, *ADMIN)
    page.goto("/admin/catalogue")
    first = page.locator("tbody tr").first
    title = first.locator("strong").inner_text()
    first.get_by_role("button", name="Hide").click()
    expect(page.get_by_role("status").last).to_contain_text("hidden")
    row = page.locator("tbody tr", has_text=title)
    row.get_by_role("button", name="Activate").click()
    expect(page.get_by_role("status").last).to_contain_text("is active")
