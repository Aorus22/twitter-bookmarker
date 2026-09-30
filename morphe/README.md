# Twitter Bookmarker — Morphe patch for X

Adds a **Save to Twitter Bookmarker** button to X's tweet action bar, next to the
native bookmark action, and a screen that shows the archive it saves into. This is
the phone-side client of the backend the browser extension already talks to: the
tweet is read *inside* the app, the collections come from the backend rather than
from a list of the phone's own, and the app's bookmark state is never touched, so
X's bookmark and a Twitter Bookmarker collection stay independent of each other.

This directory is an **additive overlay** on [Piko](https://github.com/crimera/piko),
not a fork. `build.sh` checks out Piko at a pinned commit and copies `overlay/`
on top of it, so upstream stays untouched and upgrading is a one-line change to
the pin.

## Status

Phase 4: the button saves into a collection, and a second screen shows them.
Tapping the button reads the tweet out of the action bar, opens the collection
picker from cache, and posts the tweet to the chosen one; **New collection…**
creates it on the backend and then saves into it; long-pressing the button opens
the settings dialog, which also opens the gallery. A tweet that is already in the
archive is marked, and tapping it says which collection holds it. The app's own
bookmark state is still never read or written.

| Step | State |
|---|---|
| Button appears in the action bar | verified on a device (X `12.19.1-release.0`) |
| Tweet object read from the action bar | verified on a device |
| Patch bundle builds, with the Android parts present | CI builds it on every change to the overlay, and refuses to publish a bundle without `classes.dex` or the two button icons |
| Settings (base URL, token, test connection) | written, not yet run on a device |
| `GET /api/gallery/collections` + `POST /v1/bookmarks` + collection sheet | written, not yet run on a device |
| 48 dp touch target, gap, and its own two glyphs | written, not yet run on a device |
| Saved state from `GET /v1/index` + the "already saved" sheet | written, not yet run on a device |
| Move and remove a bookmark from that sheet (`PUT …/collection`, `DELETE …`) | written, not yet run on a device |
| `POST /v1/collections` from the phone, with the backend choosing the slug | written, not yet run on a device |
| The gallery screen: folders, cards, date filter, four sorts | written, not yet run on a device |
| Live rows: skeletons, the four-stat strip, and the pause when Twitter is away | written, not yet run on a device |

Two things on this list are device-only by nature and are called out again where
they matter: the Activity's **theme** (the manifest entry deliberately does not
override the app's) and the **gallery's memory behaviour** with a long list of
media thumbnails.

## Layout

```text
morphe/
├── build.sh                 fetch the pin, apply overlay/, build the .mpp
├── LICENSE                  GPLv3 (Piko's, which this overlay is under)
├── NOTICE                   Piko's NOTICE, kept per GPLv3 §7(b)
└── overlay/                 copied verbatim onto the pinned checkout
    ├── patches/src/main/kotlin/app/crimera/patches/twitter/bookmarker/
    │   ├── SaveToBookmarkerPatch.kt             the bytecode patch
    │   ├── SaveToBookmarkerResourcePatch.kt     ships the button icons
    │   └── BookmarkerGalleryResourcePatch.kt    adds the gallery <activity>
    ├── patches/src/main/resources/twitter/bookmarker/drawable/
    │   ├── ic_twb_bookmark.xml                outlined bookmark + plus (not saved)
    │   └── ic_twb_bookmark_saved.xml          filled bookmark + tick (saved)
    └── extensions/twitter/src/main/java/app/morphe/extension/twitter/patches/bookmarker/
        ├── SaveButton.java                    the action-bar button and the tap flow
        ├── BookmarkerCache.java               collections + saved index, in memory
        ├── BookmarkerSheets.java              the picker, move/remove, "New collection…", Close
        ├── BookmarkerThreads.java             the two pools our own network work runs on
        ├── BookmarkerSettingsDialog.java      backend URL, token, "Test", gallery row
        ├── BookmarkerPrefs.java               those two values, plus the cached collections
        ├── BookmarkerApi.java                 HTTP only: health, collections, index, save, posts
        ├── BookmarkerGalleryActivity.java     the gallery screen: folders, then cards
        ├── BookmarkerGalleryAdapter.java      its two lists and the thumbnail loader
        └── TweetDraft.java                    tweet object -> the backend's fields
```

## How the hook works

Everything here follows the pattern Piko already uses for its inline Download
button, which is the reason this is a small patch rather than research:

1. **`InlineActionBar.onFinishInflate` is hooked.** The patch inserts
   `invoke-static { p0 }, …SaveButton->onFinishInflate(ViewGroup;)V` right before
   the method returns, so every tweet's action bar is handed to our code.
2. **The tweet is read by reflection, from a name the patch learns at patch
   time.** `SaveButton.getTweetFieldName()` returns the literal `"mTweet"`; the
   patch finds the field the app really writes the tweet into and rewrites that
   literal inside the compiled extension class. No obfuscated name is hardcoded.
3. **The button is a sibling, not a replacement.** The bar is wrapped in a
   horizontal `LinearLayout` with our button after it: the styling that must agree
   with the row (padding, scale type, layout params) is copied from the last
   visible action so it matches whichever theme and tweet layout is on screen,
   while the two things that must *not* agree are ours alone — a 48 dp clickable
   box with an 8 dp gap, and the tint that marks a saved tweet.
4. **The icons are our own resources.** `copyResources` puts both
   `ic_twb_bookmark.xml` (not saved) and `ic_twb_bookmark_saved.xml` (saved) into
   the app's drawable table, so the button is visually distinct from the native
   bookmark it sits next to, and its own two states are distinct from each other.
   If either lookup fails the code falls back to its unsaved glyph, then to an
   icon that is known to exist in the app, and logs it.

## Saving a tweet

1. **Tap** the button. With no backend set yet, the first tap is the one that
   asks for one: it opens the settings dialog. Nothing is guessed and nothing is
   sent.
2. The tweet is turned into the backend's fields (`TweetDraft`): the link, the
   profile name, the `@handle`, the text, the media URLs, and the date — see
   below for where the date comes from.
3. The collection picker is a native bottom sheet, one row per collection, plus
   **New collection…** and **Bookmarker gallery…** — drawn from
   `BookmarkerCache`, not from a request, so it appears in the same frame as the
   tap. **New collection…** posts the name to `POST /v1/collections` and saves
   into the collection the backend answers with; the *backend* derives the slug,
   because it owns the list and a second derivation here would be free to disagree
   with the server and with the browser.
4. The chosen slug goes to `POST /v1/bookmarks`. A `201` toasts the collection and
   marks the tweet, a `409` says where the tweet already lives (the backend names
   the owning collection, which may not be the one just picked), a `401` names the
   token, and an unreachable backend says so and saves nothing.
5. Tapping the button on a tweet that is **already** saved opens a different sheet:
   where it lives, **Change collection…**, **Remove from Bookmarker**, the gallery,
   and **Close**. The two curation rows are the phone's end of the endpoints the web
   gallery already uses — `PUT /v1/bookmarks/{tweet_id}/collection` to move it, and
   `DELETE /v1/bookmarks/{tweet_id}` to take it out of the archive. Nothing is
   re-saved: a move changes one column, and a removal is the backend's soft delete,
   so the row lands in `deleted_bookmarks` and the archive's copy of the tweet is
   untouched. Both ask nothing of the tweet itself — only its id — which is why the
   sheet is opened with the id rather than with a draft.

**Long-press** reopens the settings dialog, which also carries an **Open
bookmarker gallery** row. **Test** inside it checks `/health` for reachability and
then `/v1/index` for the token, because those are two different failures: a tunnel
that is up with a wrong token looks like a working setup until a save fails.

### The gallery screen

Three taps from anywhere: long-press the save button, or open the collection
picker, and choose **Bookmarker gallery…**.

The screen has two levels in one Activity, because that is what a folder list
implies and a second Activity would need a second manifest entry for no gain.

- **Folders.** `GET /api/gallery/collections`, in the order the backend returns,
  each row carrying the collection's own colour bar. The colour comes from the
  stored `color`; an empty one is painted as the shared default `#bf3f2e`. Tapping
  a row opens it.
- **Posts.** One collection's bookmarks, drawn the way X draws a post: the author's
  avatar, the name and handle line with the post's age, the text, up to four media
  items, a quoted post and a poll, then the four counts — replies, reposts, likes
  and views — as an action strip of glyph-plus-figure in four equal columns, which
  is where X puts them. A figure is dropped when it is zero, and the whole strip
  falls back to bare numbers if X's drawables cannot be found by name (see [the
  strip](#the-counts-strip-and-what-it-refuses-to-claim)). Avatar and media boxes
  are drawn at their final size from the first frame, whatever is in them. And, in
  the archive's own voice, each row ends with the line saying when it was saved.
  Tapping anywhere in a row opens the tweet in X, by naming the app's own link
  interpreter (see [the tap target](#the-tap-target-and-why-it-is-not-a-literal))
  and falling back to the system's viewer only when nothing inside the app claims
  the link.

### The header, and where the filters went

The header is X's: a back arrow on the left, the title, and two actions on the right
— a filter button and an overflow. The first version of this screen had a row of
capsule chips under the header for the filters, and it was wrong twice over: X does
not put its filters in the header of a list, and six chips on a phone scroll
sideways off the screen. The filters are now one tap below the filter button, in a
bottom sheet — which is where X puts them too.

The filter button carries the whole state of the screen in its colour: accent when
the list on screen is not the whole collection in its default order, muted when it
is. What the sheet says is the same thing in words, one row per option, with the
active one ticked — and because a row dismisses the sheet when it is tapped, the
tick is what makes a change visible after the sheet has gone.

Both the sort and the filter work off the same **date basis**, because a bookmark has
two dates and mixing them would mean filtering by one and ordering by the other:

| Row in the filter sheet | Wire |
|---|---|
| **Saved date** / **Posted date** | chooses which pair of bounds and which sort family is used |
| **Newest first** / **Oldest first** | `saved_desc` / `saved_asc`, or `tweet_desc` / `tweet_asc` |
| **Date range: any time** | no bounds |
| **Date range: 3 Mar \u2013 9 Mar** | `saved_from`/`saved_to` or `tweet_from`/`tweet_to`, RFC 3339 |
| **Clear the date range** | only present once a range is set; drops the bounds and refetches |

There is deliberately no **Refresh** button. It existed to refetch the list and to
clear the live-posts pause, and neither needs chrome: a filter tap and reopening a
collection already refetch, and the pause is cleared by tapping the line that
reports it (see below). One fewer button, and no dead end.

The overflow holds what changes the collections rather than the list: **New
collection…**, which is `POST /v1/collections` with the backend deriving the slug,
and **Rename this collection…**, which is `PUT /v1/collections/{slug}` with a new
name. The rename row appears only while the open collection is **empty** — the slug
is what every bookmark row stores, so the name is a label rather than a key, and an
empty collection is where a name is still free to be wrong. There is no delete row
anywhere: the backend has none for a collection, by decision, and the two mutating
rows this overlay does offer (move and remove, for a *bookmark*) are in the saved
sheet, not here.

A picked day is converted to an inclusive instant range in the **user's** timezone
(the backend compares instants), paging is 30 rows at a time through
`next_cursor`, and the list fetches the next page two rows before the end.

Every load carries a generation number. If the user changes the sort while a page
is in flight, the answer that arrives afterwards is dropped rather than appended
to a list it no longer describes — and the same guard covers the folders screen.

**Why an Activity of our own, and not a sheet:** the share sheet's rows are one
line each, and a bookmark card is not. **Why no layout XML:** the overlay is
additive and ships no `res/` of its own, so the views are built in code and there
is no resource id for the patcher to allocate. `BookmarkerGalleryResourcePatch.kt`
adds exactly one thing to the app: the `<activity>` entry, in `finalize`, the same
way Piko registers Instagram's settings screen.

### Where a row's content comes from

A bookmark row is not a rendering of the database. The row draws the **post**, and
the post comes from Twitter, fetched by tweet id from the FxEmbed status API
(`https://api.fxtwitter.com/status/<id>`) — the same host Piko's own tweet-info
feature already calls, and one that needs no token, no login and nothing but the
id. `FxTweet` is the whole of that: it fetches, parses, and knows the three answers
that matter — `200` with the post, `401` for a private one, `404` for one that is
gone.

That ordering is deliberate. The id is the only field about a bookmark that cannot
go stale: an archive's `text`, `media` and `author` columns are what the tweet said
when it was saved, and the API may also know an avatar, a quoted post, a poll and
view counts that this database never stored. So the row is painted **first** from
the archive — the list never waits on a third party — and then upgraded in place
when the answer lands. Only the rows the user actually scrolls to are fetched, one
request per post, with results kept in memory and a 60-second backoff after a
failure, because the API's own documentation asks callers not to flood it and the
gallery identifies itself with a `User-Agent` saying so.

The archive is still what the row falls back to, and the fallback is a normal state,
not an error: a private post says so in one muted line, a deleted one says so, and a
network failure says nothing at all — a message the user cannot act on is not worth
a line of the screen. Nothing here depends on our stored `media` or `text`, and
nothing in the sort or the filters changed: which posts are in the list, and in what
order, is still the backend's answer alone.

### The boxes that are drawn before the pictures

A row's layout is finished before its network work starts. That is a decision about
the placeholder, not about the data: the avatar view is a 40 dp circle painted in the
theme's placeholder grey, and every media cell is a grey rounded box at the size the
picture will be — the single photo's aspect-ratio height, the grid's fixed 150 dp —
so nothing in a row shifts or grows when an image lands. It matters most in the case
the archive produces a lot of: a bookmark whose author picture the archive never
stored has an avatar URL of `""`, and the first version of this row responded by
removing the view, which put the text hard against the screen edge on exactly those
rows and made the list look broken rather than empty.

The pictures and the live posts are loaded by **separate thread pools** of our own
(`BookmarkerThreads`), four threads for images and three for the fetches, both
daemon and both named (`twb-image-*`, `twb-live-*`). This was a bug before it was a
design: both used the app's shared background executor, so thirty rows scrolling
into view meant thirty requests with a five-second connect timeout each, all queued
ahead of the thumbnails on a pool this overlay does not size. A host that answers
slowly — or not at all — left the screen with its layout drawn and nothing in it,
which is exactly what a screenshot of the phone showed.

### The counts strip, and what it refuses to claim

X's own stat glyphs have no names this overlay can rely on. `ic_vector_heartline` is
the one name Piko references, and the other three are guesses with fallbacks, so the
rule is **all four or none**: if even one name fails to resolve, no glyph is drawn
and the strip is four bare numbers. One heart beside three numbers would read as a
different kind of row, and a missing drawable is not a design.

What the strip will not do is invent a number. A post Twitter has not answered for
has no counts to show — the archive never stored any — so its strip is the glyphs
alone with the figures omitted, which is the shape of X's action bar and says "the
numbers are in the app" rather than claiming a post has no likes. The numbers
themselves are text: liking or reposting from this screen would be a lie, so the
whole row is one tap target that opens the post.

When Twitter is unreachable altogether — three empty answers in a row — the screen
stops asking for five minutes and says so in one line above the list, because a
strip with no numbers and a silent log are indistinguishable from a patch that does
not work. Tapping that line clears the pause and asks again, which is why the line
is clickable rather than the screen growing a Refresh button. This is also the
honest version of an earlier behaviour, where every failure was logged and nothing
else.

**On tests.** Piko ships no JVM test infrastructure, so there is no automated test
for `FxTweet` — it is the only part of the phone patch that could have one, being
plain Java. It was instead written and checked against real payloads: a plain post,
one with photos, one with a video, and one that is gone, plus the documented
quote/poll shape. Every field is read through an `opt*` accessor with a default, so
a payload whose shape changes degrades into a row drawn from the archive rather than
into an exception out of a `ListView` bind.

**What this is not.** It is not X's own post cell. That cell is a Dagger-built
`ViewDelegateBinder` under `com.twitter.tweetview.*`, driven by a `urt` model parsed
from a timeline response the app fetches itself; Piko's only seam at that layer,
`TimelineEntry.checkEntry`, can drop an entry but cannot supply one, and nothing in
Piko or its extension library ever constructs an X view. Reusing the real component
would take one of two things this patch does not do: an official embed inside a
WebView (real X rendering, but the user asked for native), or writing the archive
into an X bookmark folder so X's own timeline renders it (which mutates the account
and needs rotating internal GraphQL ids). What a row is, then, is our views carrying
Twitter's data, which is why the counts are text rather than buttons: liking or
reposting from here would be a lie, while tapping through to the post is exactly
what X's own screen is for.

### Where the screen is reached from — and where it is not

There are three entry points: the **gallery row** in the settings dialog (reached
by long-pressing the save button), the **gallery row** in the collection picker,
and the saved-notice sheet.

It is deliberately **not** in X's navigation drawer. Piko's `Customise.sideBar(List)`
hook runs on the drawer's own list of nav items and can only *remove* entries: each
element is one of X's internal nav objects, and the hook compares their
`toString()` against a list of names. Adding a row means constructing one of those
objects, and nothing in this overlay can see the class, its fields or how the
drawer turns one into a tap target — so the attempt would be a guess that can crash
the drawer on a device, and the failure mode is the whole app's navigation. Two
taps from the save button is the honest alternative until the drawer's model is
read out of an APK, which is a separate piece of work.

### The tap target, and why it is not a literal

This one broke on a phone before it was written down, so it is worth the paragraph.
A tap on a post has to end up inside X, and the only way to guarantee that is to name
the activity: an ordinary `ACTION_VIEW` for an `x.com` link is a link like any other,
and the user's default browser is entitled to win it. So the row names the app's link
interpreter — and naming it is exactly what went wrong. The first version named
`com.twitter.android.UrlInterpreterActivity`, which does not exist in this build;
`setClassName` threw, the `catch` did its job, and every tap landed in a browser
without a word about why. The class the pinned Piko commit uses is
`com.twitter.deeplink.implementation.UrlInterpreterActivity` — it is the value of
`URL_INTERPRETER_ACTIVITY_CLASS` in Piko's own fingerprints, and Piko's settings
shortcut launches it with `ACTION_VIEW` and an `https://x.com/i/piko/` URI, which is
the same shape of start this row needs.

The literal is a fast path now, not the answer. A tap tries the known names against
`Intent.resolveActivity`, so a name that does not exist in the installed build is a
null check instead of an exception; behind that it asks the package manager which of
*this app's* activities claims the link and prefers one named `UrlInterpreter`; and
only when neither answers does `Utils.openLink` hand the tweet to the system, with a
log line saying that is what happened. The package filter on the query is doing two
jobs — a browser can never be the answer, and looking at our own package cannot run
into Android's package-visibility rules. Every successful tap logs the class it used,
which is what turns the next report about this into a fact instead of a guess.

### The button, and why it looks like that

The first version of this button was too easy to hit by accident: an icon the size
of its neighbours, flush against the native bookmark on one side and Piko's
download button on the other. Three things are deliberate now.

- **A 48 dp touch target with an 8 dp gap.** The glyph still matches the actions
  around it — the clickable box does not, which is the size that matters for a
  thumb.
- **Its own two glyphs**, shipped by `SaveToBookmarkerResourcePatch`: an outlined
  bookmark with a plus (`ic_twb_bookmark`) when the tweet is not in the archive,
  and a filled bookmark with a tick cut out of it (`ic_twb_bookmark_saved`) when
  it is. Both are tinted as a whole at runtime, which is why the tick is a hole
  rather than a second colour.
- **The mark comes from the archive, not from guesswork** — see below.

### Already saved

A tweet that is already in one of the collections is marked, and tapping it says
where instead of offering a save the backend would reject with `409`.

`GET /v1/index` is the source: it returns every saved tweet id at once, so one
request answers for every tweet that scrolls past, and a mark costs a map lookup.
The trade-off, stated because it is a real one:

| | |
|---|---|
| Trusted for | 10 minutes (`TTL_MS`), or until the app is reopened |
| Refreshed by | a tweet scrolling into view once that TTL has passed |
| Attempts spaced by | 30 s (`MIN_ATTEMPT_GAP_MS`), so a wrong token or a stopped backend cannot turn a scroll into a request storm |
| Cost | one ~430 KB body per refresh (3.2k tweets today), zero while idle |
| Immediate | a save made on this phone marks itself from the response, with no refetch |
| On disk | only the collection list is persisted (`twb_settings`), tagged with the backend that wrote it — another archive's slugs are never offered as save targets. The saved index is refetched |

A failed refresh is silent by design: it happens while the user is scrolling, and
the failures worth reporting (unreachable, wrong token) already have a place to be
reported — the settings dialog's **Test**, or the save the user asked for.

### Why the settings are not in Piko's settings screen

Piko's rows are built in Java in `ScreenBuilder` and gated by a static boolean
that `enableSettings("…")` flips at app startup — there is no XML row to add and
no preference registration call. Putting our two fields there would mean shipping
modified copies of `ScreenBuilder.java`, `Settings.java`, `SettingsStatus.java`
and `Pref.java`, and re-checking all four on every pin bump, for two text rows.
The overlay therefore keeps its own preference file (`twb_settings`) and its own
dialog, and stays additive as a result.

## What the date needed, and how it was answered

`POST /v1/bookmarks` requires `tweet_date` as RFC3339 (`backend/internal/storage/store.go`),
and the app's own model is obfuscated: Piko's entities expose id, handle, profile
name, user id, text and media, but no timestamp.

The date comes from the **snowflake id**: X's status ids encode milliseconds
since 2010-11-04 01:42:54.657 UTC in their top 41 bits, so
`(id >> 22) + 1288834974657` *is* the tweet's posting time. That is exact, works
offline, and costs no extra request — it replaced the earlier plan of scanning the
tweet object for a plausible epoch-millis at runtime and falling back to
fxtwitter's `created_at`.

IDs below `4194304 × 1000` are refused rather than dated: pre-snowflake ids are
sequential and small, and the formula would otherwise silently claim
2010-11-04 for them. Such a tweet is reported as "the date this tweet was posted
is not available for this tweet" and nothing is sent — the narrow gap left is
tweets from before November 2010, where the fallback would be an fxtwitter lookup
if it ever matters.

**Plain HTTP, or not.** A LAN address means `http://<lan-ip>:43121`, and X ships a
network security config that may refuse cleartext: if `HttpURLConnection` is
blocked, the fix is to ship a `network_security_config.xml` through the resource
patch that is already here (or replace the app's `android:networkSecurityConfig`
attribute), then a raw socket client, then an Intent to a companion app as the
last resort. A Cloudflare or SSH tunnel sidesteps all of it by serving HTTPS, at
the price of the client pointing at a URL that changes whenever a quick tunnel
restarts — a named tunnel avoids that — and of the backend asking for a password
that a phone cannot type into a dialog (see the root README, "A tunnel is a third
way in"). Over a tunnel the patch therefore needs its token field filled in: it
sends `Authorization: Bearer <that value>`, which is accepted in place of the
browser's dialog. Neither path has been exercised from the phone yet.

## Building

### In CI (the supported path)

`.github/workflows/morphe-patch.yml` builds `morphe/` on a GitHub runner, where
the workflow token can read Morphe's registry, and — when started manually —
publishes the bundle as a release asset:

1. **Actions → Morphe patch bundle → Run workflow.** The optional `version`
   input defaults to `<piko pin>-twb.<short sha>`, e.g. `3.9.0-twb.d0ec851`.
2. On success the release `v<version>` carries `patches-<version>.mpp`, whose
   sha256 is in the run summary. Push and pull-request runs build without
   publishing, so a broken overlay is visible before anything is released.
3. If the registry ever rejects the default workflow token, create a PAT with
   the `read:packages` scope and store it as the **`MORPHE_REGISTRY_TOKEN`**
   secret; the workflow prefers it automatically.

### Locally

```bash
gh auth refresh -h github.com -s read:packages   # once, for the active account
GITHUB_TOKEN="$(gh auth token)" morphe/build.sh
```

The artifact lands in `morphe/out/`. Prerequisites, and why each one is real:

| Requirement | Why |
|---|---|
| GitHub token with **`read:packages`** | Morphe publishes its patch library to GitHub Packages (`maven.pkg.github.com/MorpheApp/registry`), which refuses anonymous reads. The build fails in `settings.gradle.kts` without it. `gpr.user`/`gpr.key` in `~/.gradle/gradle.properties` work too. |
| **JDK 17** (21 probably fine) | Upstream CI uses Temurin 17; the Android Gradle plugin rejects newer JDKs. The wrapper needs Gradle 9.6.1 and will download it. |
| **Android SDK** at `$ANDROID_HOME` (or `~/Android/Sdk`) | The `extensions/*` modules are Android libraries. Only build tools and one platform are needed; no emulator. |
| Network | Gradle, the wrapper distribution, the Morphe plugin. First build is slow. |

`build.sh --refresh` re-fetches upstream before building. The pin itself is the
`UPSTREAM_COMMIT` variable at the top of the script.

## Installing on the phone

**Morphe Manager → Add source → `https://github.com/Aorus22/twitter-bookmarker`.**
Manager resolves the repository's newest release, so the morphe releases are
tagged `v<pin>-twb.<sha>` to stay recognisable among any other releases this
repository may publish later; if it ever picks the wrong one, re-run the workflow
(its release becomes the newest again).

One source is enough: our bundle contains every Piko patch plus ours, so adding
Piko's own release as well would duplicate patch names. Select **Save to Twitter
Bookmarker** when patching, and install the result:

1. Patch `com.twitter.android` `12.19.1-release.0` and install the APK.
2. Open a tweet: the button sits beside the native bookmark action. Tap it, fill
   in the backend URL (and a token if the backend wants one), tap **Test**, then
   **Save**.
3. Tap the button again: a sheet lists the collections, with **New collection…**
   at the bottom. Pick one; the toast names it. The sheet opens straight from the
   cached list, so it appears in the same frame as the tap — the first tap after a
   fresh install is the one that has to fetch, and it says so.
4. The saved tweet is now marked (filled bookmark, blue). Tapping a marked tweet
   opens a sheet naming the collection that holds it, with **Change collection…** to
   move it (the backend's `PUT`, so nothing is re-saved), **Remove from Bookmarker**
   to take it out of the archive (a confirmed `DELETE`, which is the backend's soft
   delete, so the row goes to its trash), the gallery row, and **Close**;
   **long-press** reopens the settings dialog at any time.
5. To see the archive itself: long-press the button, then tap **Open bookmarker
   gallery** in the settings dialog — or pick **Bookmarker gallery…** from the
   collection picker. That screen is [above](#the-gallery-screen).

If the button does not appear, the hook did not land — check Morphe's patch log
for the patch name rather than guessing from the UI. If the gallery opens with a
title bar of X's own above our header, the app theme supplies one; the manifest
entry deliberately does not pin a theme (see `BookmarkerGalleryResourcePatch.kt`),
and the fix is one attribute once a device confirms which way it goes.

## Device checks this patch still needs

Everything below is unverifiable without a phone, and none of it can be reasoned
out from the source:

| What | Why it is a device question | What a failure looks like |
|---|---|---|
| The Activity's theme | the manifest entry inherits the app's theme on purpose | a duplicated title bar, or text the theme makes unreadable |
| The post's tap target across X versions | it is resolved at runtime against the package manager, never measured against a renamed class | the tap opens the system browser; logcat names the candidates that were tried |
| Thumbnail memory over a long list | `LruCache` at heap/8 with `inSampleSize`, never measured | slow scrolling, or an OOM on a collection of thousands |
| The date pickers in a dark theme | `DatePickerDialog` is the platform's, not the app's | a light dialog on a dark screen |
| The filter and overflow glyphs | two of the three names are guesses (`ic_vector_arrow_left` is the one Piko references); each falls back to a word, drawn dots or a chip | a word where an icon belongs, or a chip where the arrow belongs |
| The window's status and navigation bars | set in code from the app's own dark/light choice; the theme is the app's | blue bars on a dark screen, or icons the same colour as the bar |
| The verified badge's drawable name | `ic_vector_verified` is a name this overlay guessed; Piko never names that glyph | verified accounts show no badge (the header still has the name) |
| The four stat glyph names | three of the four are guesses, with the all-or-none rule above | a strip of bare numbers instead of icons — the counts are still right |
| The placeholders before the pictures | whether a recycled row can still show a stale box for a frame is a rendering question | a grey box where a picture should be, or a row that changes height as it loads |
| The live posts' pause | three empty answers is a judgement about a network this overlay cannot see | the "Twitter is not answering" line appears on a working network, or never appears on a broken one |
| Moving and removing from the phone | two writes against the backend's curation endpoints, only reachable on a device | a sheet row that toasts an error, or a database row that did not change |
| The media grid's proportions | one photo uses the API's aspect ratio, a grid uses fixed 150dp cells | a tall photo that squashes the row, or a grid that clips |
| Avatar and media memory together | the circular avatars are a second cache entry per URL | an OOM on a long collection, or blank avatars after a scroll |

### Without Manager

The bundle is a normal `.mpp`: download it from the release and patch on a
desktop with the Morphe CLI (`java -jar morphe-cli.jar patch --patches
patches-<version>.mpp <input>.apkm`; run it with `--help` for your version's exact
flags), or use Morphe Desktop, which accepts a local patch bundle.

### The bundle says "Piko"

Morphe shows the bundle's own metadata, which upstream defines in
`patches/build.gradle.kts` as `name = "Piko"`. Overwriting that file in the
overlay would mean vendoring it and letting it drift on the next pin bump, so the
name stays upstream's; the patch inside is called **Save to Twitter Bookmarker**.

## Licence

The overlay is a derivative work of Piko, so it is **GPLv3**: `LICENSE` is Piko's
verbatim, `NOTICE` carries its GPLv3 §7(b) attribution requirement and must stay
in place in every distribution, and each overlay source file keeps Piko's
copyright header. This covers `morphe/` only; the extension, backend and web app
in the rest of this repository are separate programs that do not link against it.
