"""User journeys: mood discovery → recommendations → feedback and saving; search; library; preferences."""
import re

from playwright.sync_api import expect

from conftest import BASE_URL, api, register, uid


def discover(page, text=None, moods=()):
    page.goto("/discover")
    if text:
        page.get_by_label(re.compile(r"How are you feeling")).fill(text)
    for m in moods:
        page.get_by_role("group", name=re.compile("Moods")).get_by_role("button", name=m, exact=True).click()
    page.get_by_role("button", name="Find music").click()
    rows = page.locator("ol.songs > li.song")
    expect(rows.first).to_be_visible()
    return rows


def test_mood_chips_produce_explained_recommendations(page):
    register(page)
    rows = discover(page, moods=["Calm"])
    assert rows.count() > 0
    expect(page.get_by_text("Your mood sounds like")).to_be_visible()
    expect(rows.first.locator(".song-why")).not_to_be_empty()
    # songs without LOOP audio have no play control and are labelled honestly
    assert page.locator("ol.songs .cover-play").count() <= rows.count()
    page.watch.assert_clean()


def test_free_text_is_interpreted_live_and_used(page):
    register(page)
    page.goto("/discover")
    page.get_by_label(re.compile(r"How are you feeling")).fill("I feel calm and a little nostalgic tonight")
    expect(page.locator(".hears")).to_contain_text("LOOP hears")
    page.get_by_role("button", name="Find music").click()
    expect(page.locator("ol.songs > li.song").first).to_be_visible()


def test_unrecognised_text_explains_what_to_do(page):
    register(page)
    page.goto("/discover")
    page.get_by_label(re.compile(r"How are you feeling")).fill("qwzx plorb")
    page.get_by_role("button", name="Find music").click()
    expect(page.get_by_role("alert")).to_contain_text("could not find a mood")


def test_like_save_dismiss_and_explore_similar(page):
    register(page)
    rows = discover(page, moods=["Calm"])
    first = rows.first
    title = first.locator(".song-title").inner_text()
    first.get_by_role("button", name=re.compile(r"^Like ")).click()
    expect(first.get_by_role("button", name=re.compile(r"^Unlike "))).to_have_attribute("aria-pressed", "true")
    # save the song to a new playlist from the dialog
    first.get_by_role("button", name=re.compile(r"^Save .* to a playlist")).click()
    dialog = page.get_by_role("dialog")
    name = f"E2E {uid()}"
    dialog.get_by_label("New playlist").fill(name)
    dialog.get_by_role("button", name="Create and save").click()
    expect(page.get_by_role("status").last).to_contain_text(f"Saved to {name}")
    # not interested
    second = rows.nth(1)
    second.get_by_role("button", name=re.compile(r"^Not interested in ")).click()
    expect(second).to_have_attribute("data-dismissed", "true")
    # save the whole mix
    page.get_by_role("button", name="Save this mix").click()
    expect(page.get_by_role("status").last).to_contain_text("to your library")
    # explore similar
    first.get_by_role("button", name=re.compile(r"^Find songs similar to ")).click()
    expect(page).to_have_url(re.compile(r"/discover\?similar=\d+"))
    expect(page.get_by_text("Songs that sound like")).to_be_visible()
    # library reflects all of it
    page.get_by_role("link", name="Library").first.click()
    expect(page.get_by_role("link", name=name)).to_be_visible()
    page.get_by_role("tab", name="Liked songs").click()
    expect(page.get_by_role("link", name=title).first).to_be_visible()
    page.get_by_role("tab", name="Not interested").click()
    expect(page.locator("li.song")).to_have_count(1)


def test_recent_moods_reopen_the_same_list(page):
    register(page)
    discover(page, text="feeling calm")
    page.goto("/library?tab=moods")
    page.get_by_role("link", name="feeling calm").click()
    expect(page).to_have_url(re.compile(r"/discover\?batch=\d+"))
    expect(page.locator("ol.songs > li.song").first).to_be_visible()


def test_search_finds_moods_and_songs(page):
    register(page)
    page.get_by_role("link", name="Search").first.click()
    page.get_by_label("Search LOOP").fill("calm")
    page.get_by_role("button", name="Search").click()
    expect(page.get_by_role("heading", name="Moods")).to_be_visible()
    page.get_by_role("link", name="Calm").first.click()
    expect(page).to_have_url(re.compile(r"/discover\?mood=\d+"))
    expect(page.get_by_role("button", name="Calm", exact=True)).to_have_attribute("aria-pressed", "true")
    page.goto("/search?q=xyzzyplugh")
    expect(page.get_by_text("Nothing in LOOP matches")).to_be_visible()


def test_playlist_rename_and_delete(page):
    register(page)
    page.goto("/library")
    name = f"Drive {uid()}"
    page.get_by_label("New playlist").fill(name)
    page.get_by_role("button", name="Create").click()
    page.get_by_role("link", name=name).click()
    page.get_by_role("button", name="Rename").click()
    page.get_by_role("dialog").get_by_label("Name").fill(f"{name} renamed")
    page.get_by_role("dialog").get_by_role("button", name="Rename").click()
    expect(page.get_by_role("heading", name=f"{name} renamed")).to_be_visible()
    page.get_by_role("button", name="Delete").click()
    page.get_by_role("dialog").get_by_role("button", name="Delete playlist").click()
    expect(page).to_have_url(re.compile(r"/library$"))
    expect(page.get_by_role("link", name=f"{name} renamed")).to_have_count(0)


def test_preferences_and_profile_are_saved(page):
    register(page)
    # registration lands on Preferences
    page.get_by_role("group", name=re.compile("Languages")).get_by_role("button").first.click()
    page.get_by_role("group", name=re.compile("Moods you often want")).get_by_role("button").first.click()
    page.get_by_role("button", name="Save preferences").click()
    expect(page).to_have_url(re.compile(r"/discover"))
    status, prefs = api(page, "GET", "/me/preferences")
    assert status == 200 and len(prefs["current"]["languageIds"]) == 1
    page.goto("/settings")
    page.get_by_label("Display name").fill("Renamed Listener")
    page.get_by_role("button", name="Save profile").click()
    expect(page.get_by_role("status").last).to_contain_text("Profile saved")
    expect(page.locator(".who strong")).to_have_text("Renamed Listener")


def test_users_cannot_see_each_others_private_records(page, browser):
    register(page)
    discover(page, moods=["Calm"])
    status, history = api(page, "GET", "/recommendations/history")
    batch = history[0]["id"]
    status, lists = api(page, "POST", "/playlists", {"name": f"Private {uid()}"})
    ctx = browser.new_context(base_url=BASE_URL)
    other = ctx.new_page()
    register(other)
    assert api(other, "GET", f"/recommendations/batches/{batch}")[0] == 404
    assert api(other, "GET", f"/playlists/{lists['id']}")[0] == 404
    ctx.close()
