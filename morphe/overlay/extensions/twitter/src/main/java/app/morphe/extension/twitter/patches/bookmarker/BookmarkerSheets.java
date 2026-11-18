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
import app.morphe.extension.shared.ResourceType;
import app.morphe.extension.shared.ResourceUtils;
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
    private static final String MOVE_ICON = "ic_vector_layers_stroke";
    private static final String REMOVE_ICON = "ic_vector_trashcan_stroke";

    /**
     * The gallery row's glyph, as the first of these names this build actually has.
     *
     * <p>{@code ic_vector_bookmark_stroke_on} was the name it used, and on a real
     * device that row was the one icon-less row in the sheet: the name is not one
     * Piko references, and a name that misses resolves to nothing rather than to a
     * near-enough icon. The fallbacks are names Piko does reference, so the chain
     * ends on one that is present.
     */
    static final String[] GALLERY_ICON_CANDIDATES = {
            "ic_vector_bookmark_stroke_on", "ic_vector_book_stroke_on", "ic_vector_bulleted_list"};
    private static final String GALLERY_ICON = firstOf(GALLERY_ICON_CANDIDATES);
    /** Every sheet ends with this row: see {@link #closeAction}. */
    static final String CLOSE_ICON = "ic_vector_close";
    /** The gallery's overflow: a collection that does not exist yet, and a rename. */
    static final String ADD_ICON = NEW_COLLECTION_ICON;
    static final String RENAME_ICON = "ic_vector_pencil_stroke";

    /** Called on the main thread with the chosen collection. */
    public interface PickCallback {
        void onPick(String slug, String name);
    }

    private BookmarkerSheets() {}

    /**
     * The first of these drawable names this build has.
     *
     * <p>The last name is returned whether or not it exists: a row with a missing icon
     * is what the caller sees when the lookup fails anyway, and a name is what
     * {@code BottomSheetAction} takes.
     */
    static String firstOf(String... names) {
        for (int i = 0; i < names.length - 1; i++) {
            if (ResourceUtils.getIdentifier(ResourceType.DRAWABLE, names[i]) != 0) {
                return names[i];
            }
        }
        return names[names.length - 1];
    }

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
        actions.add(closeAction());

        BottomSheetHelper.show(context, draft, "Save to Twitter Bookmarker", actions, null);
    }

    /**
     * What a tap means once the tweet is already in the archive.
     *
     * <p>One information row and three things to do with it: move the bookmark to
     * another collection, take it out of the archive, or go look at the archive.
     * The tweet is in exactly one collection, so there are no collection rows here
     * — offering to save it again would only produce a 409.
     *
     * <p>The removal is a soft delete on the backend, but "recoverable" is not the
     * same as "reversible from this phone", so it asks first and says what it did:
     * see {@link BookmarkerApi#remove}.
     *
     * @param tweetId the tweet the sheet is about; every row that writes needs it.
     */
    public static void showSavedInfo(Context context, String tweetId, String name, String slug) {
        if (context == null) return;
        String where = name == null || name.isEmpty() ? slug : name;
        if (where == null || where.isEmpty()) return;

        // The bound item is a String rather than a Draft: the rows below that open
        // another sheet need the tweet id, which is captured here, and none of them
        // needs the tweet's own fields.
        List<BottomSheetAction<String>> actions = new ArrayList<>();
        actions.add(new BottomSheetAction<>(
                COLLECTION_ICON,
                "Saved in " + where,
                ignored -> {}));
        actions.add(new BottomSheetAction<>(
                MOVE_ICON,
                "Change collection\u2026",
                ignored -> withCollections(context, collections ->
                        showMovePicker(context, tweetId, slug, collections))));
        actions.add(new BottomSheetAction<>(
                REMOVE_ICON,
                "Remove from Bookmarker",
                ignored -> confirmRemove(context, tweetId, where)));
        actions.add(new BottomSheetAction<>(
                GALLERY_ICON,
                "Bookmarker gallery\u2026",
                ignored -> BookmarkerGalleryActivity.open(context)));
        actions.add(closeAction());

        BottomSheetHelper.show(context, where, "Twitter Bookmarker", actions, null);
    }

    /**
     * The collection picker again, this time for a bookmark that already exists.
     *
     * <p>The current collection is left out: a row that moves a bookmark to where it
     * already is would be a request that changes nothing, and the answer would have
     * to explain that. What the user picks is sent as the new slug, and the backend
     * moves the row — nothing is re-saved, so the saved date and the archive's copy
     * of the tweet are untouched.
     */
    public static void showMovePicker(Context context, final String tweetId, final String currentSlug,
                                      List<BookmarkerApi.Collection> collections) {
        if (context == null) return;

        List<BottomSheetAction<String>> actions = new ArrayList<>();
        for (final BookmarkerApi.Collection collection : collections) {
            if (collection.slug.equals(currentSlug)) continue;
            actions.add(new BottomSheetAction<>(
                    COLLECTION_ICON,
                    collection.toString(),
                    ignored -> move(context, tweetId, collection)));
        }
        if (actions.isEmpty()) {
            Utils.showToastShort("Twitter Bookmarker: there is nowhere else to move it");
            return;
        }
        actions.add(new BottomSheetAction<>(
                NEW_COLLECTION_ICON,
                "New collection\u2026",
                ignored -> promptForNewCollection(context, (slug, name) -> {
                    // The collection now exists on the backend; moving into it is the
                    // same request the rows above make, with the slug just created.
                    move(context, tweetId,
                            new BookmarkerApi.Collection(slug, name, "", 0, 0));
                })));
        actions.add(closeAction());

        BottomSheetHelper.show(context, tweetId, "Move to", actions, null);
    }

    /** The row that only closes the sheet; every sheet gets one. */
    static <T> BottomSheetAction<T> closeAction() {
        // Piko's helper dismisses on any tap and runs the callback after, so a row
        // that does nothing *is* a close button — and it is the only way out that
        // does not require the drag gesture to be fast enough to register as a fling.
        return new BottomSheetAction<>(CLOSE_ICON, "Close", ignored -> {});
    }

    /** Runs the callback on the main thread with a usable list of collections. */
    private static void withCollections(Context context, CollectionsCallback onReady) {
        List<BookmarkerApi.Collection> cached = BookmarkerCache.collectionsOrNull();
        if (cached != null) {
            onReady.onCollections(cached);
            return;
        }
        if (!BookmarkerPrefs.isConfigured()) {
            Utils.showToastShort("Twitter Bookmarker: set the backend URL first");
            BookmarkerSettingsDialog.show(Utils.getContext(), null);
            return;
        }

        Utils.runOnBackgroundThread(() -> {
            try {
                final List<BookmarkerApi.Collection> fetched = BookmarkerApi.collections(
                        BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken());
                Utils.runOnMainThread(() -> onReady.onCollections(fetched));
            } catch (Exception e) {
                Logger.printException(() -> "twb: could not list collections", e);
                Utils.runOnMainThread(() -> Utils.showToastLong(
                        "Twitter Bookmarker: could not list the collections"));
            }
        });
    }

    /** One move, off the main thread, reported in the backend's own words. */
    private static void move(Context context, String tweetId, BookmarkerApi.Collection target) {
        Utils.showToastShort("Twitter Bookmarker: moving to \u201c" + target.name + "\u201d\u2026");
        Utils.runOnBackgroundThread(() -> {
            BookmarkerApi.Result result = BookmarkerApi.move(
                    BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken(),
                    tweetId, target.slug);
            Utils.runOnMainThread(() -> {
                if (result.ok) {
                    // The mark on the tweet's own button reads the collection from
                    // here, so this is what makes it say the new name immediately.
                    BookmarkerCache.remember(tweetId, target.slug, target.name);
                    Utils.showToastShort("Twitter Bookmarker: " + result.message);
                } else {
                    Utils.showToastLong("Twitter Bookmarker: " + result.message);
                }
            });
        });
    }

    /**
     * Asks before removing, then removes.
     *
     * <p>The dialog is the point: the backend's delete is recoverable, but only
     * through something that can call the restore, and the phone has no such screen
     * yet. So it says where the bookmark goes rather than pretending nothing is lost.
     */
    private static void confirmRemove(Context context, final String tweetId, String where) {
        if (!BookmarkerPrefs.isConfigured()) {
            Utils.showToastShort("Twitter Bookmarker: set the backend URL first");
            BookmarkerSettingsDialog.show(Utils.getContext(), null);
            return;
        }
        new AlertDialog.Builder(context)
                .setTitle("Remove from Bookmarker?")
                .setMessage("\u201c" + where + "\u201d will not show it any more. The backend "
                        + "moves the bookmark to its trash rather than deleting it, so nothing "
                        + "the archive holds is lost.")
                .setPositiveButton("Remove", (dialog, which) -> remove(tweetId))
                .setNegativeButton("Keep", null)
                .show();
    }

    private static void remove(String tweetId) {
        Utils.runOnBackgroundThread(() -> {
            BookmarkerApi.Result result = BookmarkerApi.remove(
                    BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken(), tweetId);
            Utils.runOnMainThread(() -> {
                if (result.ok) {
                    // Drops the mark on the tweet's button in the same breath, so the
                    // icon stops claiming the tweet is saved the moment the toast does.
                    BookmarkerCache.forget(tweetId);
                    Utils.showToastShort("Twitter Bookmarker: " + result.message);
                } else {
                    Utils.showToastLong("Twitter Bookmarker: " + result.message);
                }
            });
        });
    }

    /** Called on the main thread with the collections to choose from. */
    private interface CollectionsCallback {
        void onCollections(List<BookmarkerApi.Collection> collections);
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
