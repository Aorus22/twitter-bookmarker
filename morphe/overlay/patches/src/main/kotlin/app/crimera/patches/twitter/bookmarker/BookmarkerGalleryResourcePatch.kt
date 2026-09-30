/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.crimera.patches.twitter.bookmarker

import app.morphe.patcher.patch.resourcePatch
import org.w3c.dom.Element

/**
 * Registers the gallery screen's Activity in the app's manifest.
 *
 * The class itself ships in the extension dex, which
 * [saveToBookmarkerPatch] depends on anyway; all this patch adds is the one
 * `<activity>` entry the framework needs to be able to launch it. Appending to
 * the manifest is Piko's own pattern for Instagram's settings screen
 * (`SettingsResourcePatch.kt`), and the edit runs in `finalize` so it happens
 * after every other manifest change.
 *
 * Two deliberate omissions:
 *
 *  - No `android:theme`. The app's own theme is the closest thing to what X looks
 *    like, and it already carries the dim/light variants the user chose. Pinning
 *    `Theme.DeviceDefault` here would ignore that choice, which is exactly the
 *    mismatch the overlay does not want on a screen that is meant to read like the
 *    rest of the app. If the app theme turns out to add a title bar, the screen's
 *    own header row makes it a duplicate rather than a breakage — a device check,
 *    noted in `morphe/README.md`.
 *  - No `android:exported="true"`. Nothing outside the app ever launches this, and
 *    an exported Activity is a way in.
 */
@Suppress("unused")
val bookmarkerGalleryResourcePatch =
    resourcePatch(
        description = "Adds the Twitter Bookmarker gallery screen to the app's manifest.",
    ) {
        finalize {
            document("AndroidManifest.xml").use { document ->
                val application =
                    document.getElementsByTagName("application").item(0) as? Element

                // A manifest without an <application> is not a manifest this patch
                // can help; skipping leaves the rest of the bundle intact rather
                // than failing the whole build on an impossible document.
                if (application != null) {
                    val activity = document.createElement("activity")
                    activity.setAttribute(
                        "android:name",
                        "app.morphe.extension.twitter.patches.bookmarker.BookmarkerGalleryActivity",
                    )
                    activity.setAttribute("android:label", "Twitter Bookmarker")
                    activity.setAttribute("android:exported", "false")
                    // The screen re-reads the archive when it opens, so a
                    // configuration change does not need a rebuild of it — and a
                    // rebuild would drop the user's chosen sort mid-scroll.
                    activity.setAttribute(
                        "android:configChanges",
                        "orientation|screenSize|keyboardHidden|uiMode",
                    )
                    application.appendChild(activity)
                }
            }
        }
    }
