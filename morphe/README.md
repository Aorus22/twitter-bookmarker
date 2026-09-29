# Twitter Bookmarker — Morphe patch for X

Adds a **Save to Twitter Bookmarker** button to X's tweet action bar, next to the
native bookmark action. This is the phone-side client of the backend the browser
extension already talks to: the tweet is read *inside* the app, and the app's own
bookmark state is never touched, so X's bookmark and a Twitter Bookmarker
collection stay independent of each other.

This directory is an **additive overlay** on [Piko](https://github.com/crimera/piko),
not a fork. `build.sh` checks out Piko at a pinned commit and copies `overlay/`
on top of it, so upstream stays untouched and upgrading is a one-line change to
the pin.

## Status

Phase 3: the button saves into a collection. Tapping it reads the tweet out of
the action bar, lists the backend's collections in a native bottom sheet, and
posts the tweet to the chosen one; long-pressing it edits the backend address and
token. The app's own bookmark state is still never read or written.

| Step | State |
|---|---|
| Button appears in the action bar | verified on a device (X `12.19.1-release.0`) |
| Tweet object read from the action bar | verified on a device |
| Patch bundle builds, with the Android parts present | CI builds it on every change to the overlay, and refuses to publish a bundle without `classes.dex` |
| Settings (base URL, token, test connection) | written, not yet run on a device |
| `GET /api/gallery/collections` + `POST /v1/bookmarks` + collection sheet | written, not yet run on a device |
| Saved state from `GET /v1/index`, move/delete from the phone | not written (Phase 4) |

## Layout

```text
morphe/
├── build.sh                 fetch the pin, apply overlay/, build the .mpp
├── LICENSE                  GPLv3 (Piko's, which this overlay is under)
├── NOTICE                   Piko's NOTICE, kept per GPLv3 §7(b)
└── overlay/                 copied verbatim onto the pinned checkout
    ├── patches/src/main/kotlin/app/crimera/patches/twitter/bookmarker/
    │   ├── SaveToBookmarkerPatch.kt           the bytecode patch
    │   └── SaveToBookmarkerResourcePatch.kt   ships the button icon
    ├── patches/src/main/resources/twitter/bookmarker/drawable/
    │   └── ic_twb_bookmark.xml
    └── extensions/twitter/src/main/java/app/morphe/extension/twitter/patches/bookmarker/
        ├── SaveButton.java                    the action-bar button and the tap flow
        ├── BookmarkerSheets.java              the collection picker (Piko's own bottom sheet)
        ├── BookmarkerSettingsDialog.java      backend URL, token, "Test"
        ├── BookmarkerPrefs.java               where those two values live
        ├── BookmarkerApi.java                 HTTP only: health, collections, save
        ├── TweetDraft.java                    tweet object -> the backend's fields
        └── Slug.java                          name -> slug, mirroring the browser extension
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
   horizontal `LinearLayout` with our `ImageView` after it, and the styling
   (padding, scale type, tint, layout params) is copied from the last visible
   action so it matches whichever theme and tweet layout is on screen.
4. **The icon is our own resource.** `copyResources` puts
   `ic_twb_bookmark.xml` into the app's drawable table, so our button is visually
   distinct from the native bookmark it sits next to. If the lookup ever fails,
   the code falls back to an icon that is known to exist in the app and logs it.

## Saving a tweet

1. **Tap** the button. With no backend set yet, the first tap is the one that
   asks for one: it opens the settings dialog. Nothing is guessed and nothing is
   sent.
2. The tweet is turned into the backend's fields (`TweetDraft`): the link, the
   profile name, the `@handle`, the text, the media URLs, and the date — see
   below for where the date comes from.
3. `GET /api/gallery/collections` fills a native bottom sheet, one row per
   collection, plus **New collection…**. That row is not a nicety: collections
   exist only once something has been saved into them, so without it a phone with
   an empty database could never save anything. The name is slugged locally
   (`Slug.java`, mirroring `extension/src/shared/slug.ts`) before it is sent.
4. The chosen slug goes to `POST /v1/bookmarks`. A `201` toasts the collection, a
   `409` says where the tweet already lives (the backend names the owning
   collection, which may not be the one just picked), a `401` names the token, and
   an unreachable backend says so and saves nothing.

**Long-press** reopens the settings dialog. **Test** inside it checks `/health`
for reachability and then `/v1/index` for the token, because those are two
different failures: a tunnel that is up with a wrong token looks like a working
setup until a save fails.

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
restarts — and of the backend being reachable by anyone who has that URL, since a
tunnel on this machine connects from loopback and is exempt from the token (see
the root README, "A tunnel is a third way in"). Neither path has been exercised
from the phone yet.

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
   at the bottom. Pick one; the toast names it.

If the button does not appear, the hook did not land — check Morphe's patch log
for the patch name rather than guessing from the UI.

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
