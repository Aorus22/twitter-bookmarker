/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import android.app.AlertDialog;
import android.content.Context;
import android.text.InputType;
import android.widget.EditText;

import java.util.ArrayList;
import java.util.List;

import app.morphe.extension.shared.Logger;
import app.morphe.extension.shared.Utils;
import app.morphe.extension.twitter.patches.nativeFeatures.shareMenu.BottomSheetAction;
import app.morphe.extension.twitter.patches.nativeFeatures.shareMenu.BottomSheetHelper;

/**
 * The collection picker: one native bottom sheet row per existing collection,
 * plus a row that creates one and a row that opens the gallery.
 *
 * <p>Creating goes through {@code POST /v1/collections}, not through a save. The
 * backend owns the list, so the phone asks it to make a collection and is told the
 * slug it chose — deriving one here would be a second implementation of a rule the
 * browser and the server already agree on, free to disagree with both. It also
 * means a collection created on the phone carries the colour and the position the
 * backend assigns, which is what makes it appear in the right place in the web
 * gallery and in the gallery screen.
 *
 * <p>The sheet is Piko's own ({@link BottomSheetHelper}), not a dialog of ours, so
 * it matches the app's share sheet and its dark/light theming for free.
 */
public final class BookmarkerSheets {

    /** X drawables that Piko's own sheets already use, so they are present. */
    private static final String COLLECTION_ICON = "ic_vector_book_stroke_on";
    private static final String NEW_COLLECTION_ICON = "ic_vector_compose_dm";
    private static final String GALLERY_ICON = "ic_vector_bookmark_stroke_on";

    /** Called on the main thread with the chosen collection. */
    public interface PickCallback {
        void onPick(String slug, String name);
    }

    private BookmarkerSheets() {}

    /**
     * @param draft the tweet being saved, bound to every row's callback.
     */
    public static void showCollectionPicker(Context context, BookmarkerApi.Draft draft,
                                            List<BookmarkerApi.Collection> collections,
                                            PickCallback onPick) {
        if (context == null) return;

        List<BottomSheetAction<BookmarkerApi.Draft>> actions = new ArrayList<>();
        for (BookmarkerApi.Collection collection : collections) {
            // Each row closes over its own collection: the helper hands every
            // callback the same bound item, so the choice has to be captured here.
            actions.add(new BottomSheetAction<BookmarkerApi.Draft>(
                    COLLECTION_ICON,
                    collection.toString(),
                    ignored -> onPick.onPick(collection.slug, collection.name)));
        }
        actions.add(new BottomSheetAction<BookmarkerApi.Draft>(
                NEW_COLLECTION_ICON,
                "New collection\u2026",
                ignored -> promptForNewCollection(context, onPick)));
        // The gallery row lives here as well as in the settings dialog because this
        // sheet is the one place a user is already thinking about the archive, and
        // the sidebar cannot carry an item of ours (see morphe/README.md).
        actions.add(new BottomSheetAction<BookmarkerApi.Draft>(
                GALLERY_ICON,
                "Bookmarker gallery\u2026",
                ignored -> BookmarkerGalleryActivity.open(context)));

        BottomSheetHelper.show(context, draft, "Save to Twitter Bookmarker", actions, null);
    }

    /**
     * What a tap means once the tweet is already in the archive.
     *
     * <p>One row, and no collection rows: the tweet is in exactly one collection,
     * and offering to save it again would only produce a 409. Moving a tweet
     * between collections needs the backend's move endpoint, which the web
     * curation flow has ({@code PUT /v1/bookmarks/{id}/collection}) but this screen
     * does not use yet — the Phase 5 row in {@code morphe/README.md}.
     */
    public static void showSavedInfo(Context context, String name, String slug) {
        if (context == null) return;
        String where = name == null || name.isEmpty() ? slug : name;
        if (where == null || where.isEmpty()) return;

        // The bound item is a String here rather than a Draft: this sheet only has
        // to say where the tweet lives, and its row needs no tweet data at all.
        List<BottomSheetAction<String>> actions = new ArrayList<>();
        actions.add(new BottomSheetAction<>(
                COLLECTION_ICON,
                "Already saved in " + where,
                ignored -> {}));
        actions.add(new BottomSheetAction<>(
                GALLERY_ICON,
                "Bookmarker gallery\u2026",
                ignored -> BookmarkerGalleryActivity.open(context)));

        BottomSheetHelper.show(context, where, "Twitter Bookmarker", actions, null);
    }

    /**
     * Asks for a name, then asks the backend to create it.
     *
     * <p>The name is only checked for being present: whether it is *usable* is the
     * backend's answer (a slug that collides is a 409, an empty slug is a 400), and
     * repeating those rules here would be guessing at something the server is about
     * to decide anyway.
     */
    static void promptForNewCollection(Context context, PickCallback onPick) {
        EditText input = new EditText(context);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setSingleLine(true);
        input.setHint("e.g. Read Later");

        new AlertDialog.Builder(context)
                .setTitle("New collection")
                .setView(input)
                .setPositiveButton("Create", (dialog, which) -> {
                    String name = input.getText().toString().trim();
                    if (name.isEmpty()) {
                        Utils.showToastShort("Twitter Bookmarker: give the collection a name");
                        return;
                    }
                    createThenPick(name, onPick);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /**
     * Creates the collection on the backend, then hands its slug to the save flow.
     *
     * <p>Two requests, and deliberately so: creating is a real operation on the
     * backend now, and a save that quietly created a collection would leave the
     * phone unable to name it in the gallery or the picker. Failing here means no
     * collection and no save, which is honest — the tweet is still unsaved and the
     * tap can be repeated.
     */
    private static void createThenPick(String name, PickCallback onPick) {
        if (!BookmarkerPrefs.isConfigured()) {
            Utils.showToastShort("Twitter Bookmarker: set the backend URL first");
            BookmarkerSettingsDialog.show(Utils.getContext(), null);
            return;
        }

        Utils.showToastShort("Twitter Bookmarker: creating \u201c" + name + "\u201d\u2026");
        Utils.runOnBackgroundThread(() -> {
            try {
                final BookmarkerApi.Collection created = BookmarkerApi.createCollection(
                        BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken(), name, "");
                // Cached before the save so the picker and the gallery both see it
                // even if the save itself is refused.
                BookmarkerCache.rememberCollection(created);
                Utils.runOnMainThread(() -> onPick.onPick(created.slug, created.name));
            } catch (Exception e) {
                Logger.printException(() -> "twb: could not create the collection", e);
                final String reason = e.getMessage() == null ? "could not create it" : e.getMessage();
                Utils.runOnMainThread(() ->
                        Utils.showToastLong("Twitter Bookmarker: " + reason));
            }
        });
    }
}
