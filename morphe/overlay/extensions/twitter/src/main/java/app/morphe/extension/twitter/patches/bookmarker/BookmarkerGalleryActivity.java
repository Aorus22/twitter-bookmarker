/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import app.morphe.extension.shared.Logger;
import app.morphe.extension.shared.Utils;

/**
 * The phone's own bookmark gallery: the archive as the backend holds it, in two
 * levels.
 *
 * <p>The first level is the folder list — the backend's collections, in the
 * backend's order, each with the colour the user gave it. The second is one
 * collection's bookmarks, drawn as cards, with the date filter and the sort the
 * web gallery offers: newest or oldest, by the date the archive saved it or by
 * the date the tweet was posted.
 *
 * <p>Why a real Activity rather than a sheet: the share sheet's rows are one line
 * each, and a gallery row is a card with an author, text, media and a date. It is
 * read-only by design — creating, renaming and recolouring collections happens in
 * the save sheet ({@link BookmarkerSheets}) and in the browser, and this screen
 * only shows what those wrote.
 *
 * <p>The views are built in code rather than inflated from a layout. The overlay
 * is additive and ships no {@code res/} of its own, so there is no layout file to
 * keep in sync with a resource id that the patcher has to allocate; a screen this
 * simple does not need one.
 *
 * <p>Threading: every load runs through {@link Utils#runOnBackgroundThread}, and
 * only the main thread touches a view. A load carries a generation number, so an
 * answer that arrives after the user changed the sort is dropped rather than
 * appended to a list it no longer describes.
 */
public final class BookmarkerGalleryActivity extends Activity {

    /** How many bookmarks a page asks for. The backend caps this at 100. */
    private static final int PAGE_LIMIT = 30;

    /**
     * The names X's link handler has answered to, newest first.
     *
     * <p>The first is what the pinned Piko commit names in its own fingerprints and
     * builds its settings shortcut against, and the second is what older builds
     * called the same activity. Neither is a contract: X renames its own classes
     * whenever it likes, which is why this list is only the fast path and
     * {@link #handlerInApp} exists to ask the app what it registers today.
     */
    private static final String[] POST_HANDLER_CANDIDATES = {
            "com.twitter.deeplink.implementation.UrlInterpreterActivity",
            "com.twitter.android.UrlInterpreterActivity",
    };

    private static final String ISO_UTC = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    private static final int COLOR_TEXT_LIGHT = 0xFF0F1419;
    private static final int COLOR_TEXT_DARK = 0xFFE7E9EA;
    private static final int COLOR_MUTED_LIGHT = 0xFF536471;
    private static final int COLOR_MUTED_DARK = 0xFF71767B;
    private static final int COLOR_CARD_LIGHT = 0xFFF7F9F9;
    private static final int COLOR_CARD_DARK = 0xFF1E2732;
    private static final int COLOR_BORDER_LIGHT = 0xFFEFF3F4;
    private static final int COLOR_BORDER_DARK = 0xFF2F3336;
    private static final int COLOR_ACCENT = 0xFF1D9BF0;

    /**
     * How long a post Twitter would not describe is left alone before asking again.
     *
     * <p>A private or deleted post answers with a code and is remembered for the
     * session; this is only for the failures that might be transient — no network,
     * a timeout, the service having a bad minute — so that scrolling a long
     * collection cannot turn into a request storm against a third party.
     */
    private static final long ENRICH_RETRY_GAP_MS = 60 * 1000L;

    /**
     * Tweet ids being fetched right now, and when a failed one was last tried.
     *
     * <p>Process-wide and touched only from the main thread: a bind starts a fetch,
     * and the answer comes back through {@code runOnMainThread}. Two rows for the
     * same tweet — the same bookmark can appear twice after a re-save — must not
     * produce two requests.
     */
    private static final java.util.Set<String> ENRICH_IN_FLIGHT = new java.util.HashSet<>();
    private static final java.util.Map<String, Long> ENRICH_FAILED_AT = new java.util.HashMap<>();

    /** Opens the gallery; usable from any context the sheet or dialog holds. */
    public static void open(android.content.Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, BookmarkerGalleryActivity.class);
            // The caller is usually a dialog or a sheet, whose context is not an
            // Activity, so the flag is not optional there and harmless elsewhere.
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Logger.printException(() -> "twb: could not open the gallery", e);
            Utils.showToastShort("Twitter Bookmarker: could not open the gallery");
        }
    }

    private boolean dark;

    private TextView titleView;
    private TextView backView;
    private LinearLayout controls;
    private TextView basisSavedChip;
    private TextView basisPostedChip;
    private TextView newestChip;
    private TextView oldestChip;
    private TextView rangeChip;
    private TextView clearRangeChip;
    private TextView statusView;
    private ListView listView;
    private BookmarkerGalleryAdapter.FolderAdapter folderAdapter;
    private BookmarkerGalleryAdapter.PostAdapter postAdapter;

    /* Browsing state. `opened == null` means the folder list is showing. */
    private BookmarkerApi.Collection opened;
    private final List<BookmarkerApi.Post> posts = new ArrayList<>();
    private String cursor = "";
    private boolean hasMore;
    private boolean loading;
    /** Incremented whenever the list is reset; a stale answer is discarded. */
    private int generation;

    /* Filter state. */
    private boolean basisPosted;
    private boolean oldestFirst;
    private boolean anyTime = true;
    private long rangeFromMs;
    private long rangeToMs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // The app's own configuration, not the system's: X can be in "Lights out"
        // while the phone is in light mode, and the screen should follow the app
        // the user is looking at. `Resources.getSystem()` would report the phone.
        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        dark = nightMode == Configuration.UI_MODE_NIGHT_YES;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(backgroundColor());
        // No side padding here: the list draws rows the way X does — edge to edge,
        // separated by a hairline — so the header and the chips carry the inset
        // themselves instead.
        root.setPadding(0, dp(8), 0, 0);

        root.addView(buildHeader());
        controls = buildControls();
        root.addView(controls);

        statusView = new TextView(this);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        statusView.setTextColor(mutedColor());
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(0, dp(16), 0, dp(16));
        root.addView(statusView);

        listView = new ListView(this);
        // X separates posts with a hairline rather than a gap, and the list can draw
        // that itself: a divider between every pair of rows costs no view and no
        // margin, which matters because a ListView child cannot carry margins.
        listView.setDivider(new android.graphics.drawable.ColorDrawable(borderColor()));
        listView.setDividerHeight(Math.max(1, (int) (getResources().getDisplayMetrics().density / 2f)));
        listView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        listView.setOnItemClickListener((parent, view, position, id) -> onRowTapped(position));
        listView.setOnScrollListener(new android.widget.AbsListView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(android.widget.AbsListView view, int scrollState) {}

            @Override
            public void onScroll(android.widget.AbsListView view, int firstVisible, int visibleCount,
                                 int totalCount) {
                // One page before the end, so a flick does not outrun the next fetch.
                if (totalCount > 0 && firstVisible + visibleCount >= totalCount - 2) {
                    loadPosts(false);
                }
            }
        });
        root.addView(listView);

        setContentView(root);

        folderAdapter = new BookmarkerGalleryAdapter.FolderAdapter(this);
        postAdapter = new BookmarkerGalleryAdapter.PostAdapter(this);
        updateChips();
        showFolders();
    }

    /** The title bar: our own, because the app's theme is the app's business. */
    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(4), dp(12), dp(8));

        backView = chip("Close");
        backView.setOnClickListener(v -> onBackPressed());
        header.addView(backView);

        titleView = new TextView(this);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        titleView.setTextColor(textColor());
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleParams.setMarginStart(dp(10));
        titleView.setLayoutParams(titleParams);
        header.addView(titleView);

        TextView refresh = chip("Refresh");
        refresh.setOnClickListener(v -> {
            if (opened == null) {
                showFolders();
            } else {
                loadPosts(true);
            }
        });
        header.addView(refresh);
        return header;
    }

    /**
     * The filter and sort row: which date, which direction, and which range.
     *
     * <p>One date basis drives both the filter and the sort, which is why there is
     * one pair of chips rather than two. "Saved" and "Posted" are the two dates a
     * bookmark has, and mixing them would mean a range on one and an order on the
     * other — expressible on the wire, meaningless to a reader.
     */
    private LinearLayout buildControls() {
        HorizontalScrollView scroller = new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, 0, 0, dp(6));

        basisSavedChip = chip("Saved date");
        basisPostedChip = chip("Posted date");
        newestChip = chip("Newest");
        oldestChip = chip("Oldest");
        rangeChip = chip("Any time");
        clearRangeChip = chip("Clear range");

        basisSavedChip.setOnClickListener(v -> {
            basisPosted = false;
            loadPosts(true);
        });
        basisPostedChip.setOnClickListener(v -> {
            basisPosted = true;
            loadPosts(true);
        });
        newestChip.setOnClickListener(v -> {
            oldestFirst = false;
            loadPosts(true);
        });
        oldestChip.setOnClickListener(v -> {
            oldestFirst = true;
            loadPosts(true);
        });
        rangeChip.setOnClickListener(v -> pickRange());
        clearRangeChip.setOnClickListener(v -> {
            anyTime = true;
            loadPosts(true);
        });

        row.addView(basisSavedChip);
        row.addView(basisPostedChip);
        row.addView(newestChip);
        row.addView(oldestChip);
        row.addView(rangeChip);
        row.addView(clearRangeChip);

        LinearLayout holder = new LinearLayout(this);
        holder.setOrientation(LinearLayout.VERTICAL);
        holder.setPadding(dp(12), 0, dp(12), 0);
        holder.addView(scroller);
        scroller.addView(row);
        return holder;
    }

    /* ---------------------------------------------------------------------- */
    /* Navigation                                                             */
    /* ---------------------------------------------------------------------- */

    private void showFolders() {
        opened = null;
        posts.clear();
        folderAdapter.notifyDataSetChanged();
        postAdapter.notifyDataSetChanged();

        titleView.setText("Twitter Bookmarker");
        backView.setText("Close");
        controls.setVisibility(View.GONE);
        listView.setAdapter(folderAdapter);
        setStatus("Loading folders\u2026");

        final int request = ++generation;
        Utils.runOnBackgroundThread(() -> {
            try {
                List<BookmarkerApi.Collection> collections = BookmarkerApi.collections(
                        BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken());
                Utils.runOnMainThread(() -> {
                    if (request != generation) return;
                    folderAdapter.setItems(collections);
                    setStatus(collections.isEmpty()
                            ? "No folders yet. Save a tweet from its action bar to create one."
                            : "");
                });
            } catch (Exception e) {
                Logger.printInfo(() -> "twb: could not list the folders: " + e);
                Utils.runOnMainThread(() -> {
                    if (request != generation) return;
                    folderAdapter.setItems(new ArrayList<>());
                    setStatus("Could not load the folders: " + reason(e));
                });
            }
        });
    }

    /** Opens one collection: page one of its bookmarks, with the current filters. */
    private void openCollection(BookmarkerApi.Collection collection) {
        if (collection == null) return;
        opened = collection;
        titleView.setText(collection.name);
        backView.setText("\u2039 Back");
        controls.setVisibility(View.VISIBLE);
        listView.setAdapter(postAdapter);
        // Painted before the request, not after: the chips are the screen's only
        // statement of the current filter, and a slow request should not leave them
        // describing the previous one.
        updateChips();
        loadPosts(true);
    }

    @Override
    public void onBackPressed() {
        // One Activity, two levels: back steps out of the collection before it
        // leaves the screen, which is what a folder list implies.
        if (opened != null) {
            showFolders();
            return;
        }
        super.onBackPressed();
    }

    /* ---------------------------------------------------------------------- */
    /* Loading                                                                */
    /* ---------------------------------------------------------------------- */

    private void loadPosts(boolean reset) {
        if (opened == null) return;
        // A reset is never dropped: it is the user asking for a different list, and
        // answering "not now" would leave the chips describing one sort while the
        // rows show another. It instead invalidates whatever is in flight, so the
        // answer that arrives afterwards is discarded by the generation check below.
        // A follow-up page *is* dropped while a page is loading — two requests for
        // the same cursor would append the same rows twice.
        if (!reset && (loading || !hasMore)) return;

        if (reset) {
            cursor = "";
            hasMore = true;
            posts.clear();
            postAdapter.notifyDataSetChanged();
            setStatus("Loading bookmarks\u2026");
            generation++;
        }

        loading = true;

        final BookmarkerApi.Collection collection = opened;
        final int request = generation;
        // Built here, on the main thread that owns the chip state: reading those
        // fields from the worker would race a tap that changed them mid-request.
        final BookmarkerApi.PostQuery query = queryFor(reset ? "" : cursor);

        Utils.runOnBackgroundThread(() -> {
            try {
                BookmarkerApi.Page page = BookmarkerApi.posts(
                        BookmarkerPrefs.backendUrl(), BookmarkerPrefs.backendToken(),
                        collection.slug, query);
                Utils.runOnMainThread(() -> {
                    if (request != generation) return;
                    loading = false;
                    posts.addAll(page.items);
                    cursor = page.nextCursor;
                    hasMore = page.hasMore;
                    postAdapter.setItems(posts, hasMore);
                    setStatus(posts.isEmpty() ? emptyMessage() : "");
                    updateChips();
                });
            } catch (Exception e) {
                Logger.printInfo(() -> "twb: could not load the bookmarks: " + e);
                Utils.runOnMainThread(() -> {
                    if (request != generation) return;
                    loading = false;
                    postAdapter.setItems(posts, false);
                    setStatus("Could not load the bookmarks: " + reason(e));
                    updateChips();
                });
            }
        });
    }

    /** The wire query for the current chips; `from` is the paging cursor. */
    private BookmarkerApi.PostQuery queryFor(String from) {
        String sort;
        if (basisPosted) {
            sort = oldestFirst ? BookmarkerApi.SORT_TWEET_ASC : BookmarkerApi.SORT_TWEET_DESC;
        } else {
            sort = oldestFirst ? BookmarkerApi.SORT_SAVED_ASC : BookmarkerApi.SORT_SAVED_DESC;
        }

        String fromDate = anyTime ? "" : isoUtc(rangeFromMs);
        String toDate = anyTime ? "" : isoUtc(rangeToMs);
        return new BookmarkerApi.PostQuery(
                sort,
                basisPosted ? "" : fromDate,
                basisPosted ? "" : toDate,
                basisPosted ? fromDate : "",
                basisPosted ? toDate : "",
                from,
                PAGE_LIMIT);
    }

    private String emptyMessage() {
        if (!anyTime) return "No bookmarks in that date range.";
        return "No bookmarks in this collection yet.";
    }

    /**
     * A from/to pair of day pickers.
     *
     * <p>Day granularity, converted to an inclusive instant range in the user's
     * own timezone: the backend compares instants, so "the 3rd" has to mean the
     * whole of the 3rd where the user is, not where the server is.
     */
    private void pickRange() {
        Calendar start = Calendar.getInstance();
        if (!anyTime) start.setTimeInMillis(rangeFromMs);

        DatePickerDialog fromDialog = new DatePickerDialog(
                this,
                (view, year, month, day) -> {
                    rangeFromMs = startOfDay(year, month, day);
                    Calendar end = Calendar.getInstance();
                    end.setTimeInMillis(rangeFromMs);
                    // The second picker starts on the day just chosen, so a
                    // single-day range is two taps on the same date.
                    DatePickerDialog toDialog = new DatePickerDialog(
                            BookmarkerGalleryActivity.this,
                            (toView, toYear, toMonth, toDay) -> {
                                rangeToMs = endOfDay(toYear, toMonth, toDay);
                                anyTime = false;
                                loadPosts(true);
                            },
                            end.get(Calendar.YEAR),
                            end.get(Calendar.MONTH),
                            end.get(Calendar.DAY_OF_MONTH));
                    toDialog.setTitle("To");
                    toDialog.show();
                },
                start.get(Calendar.YEAR),
                start.get(Calendar.MONTH),
                start.get(Calendar.DAY_OF_MONTH));
        fromDialog.setTitle("From");
        fromDialog.show();
    }

    private static long startOfDay(int year, int month, int day) {
        Calendar calendar = Calendar.getInstance();
        calendar.set(year, month, day, 0, 0, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        return calendar.getTimeInMillis();
    }

    private static long endOfDay(int year, int month, int day) {
        Calendar calendar = Calendar.getInstance();
        calendar.set(year, month, day, 23, 59, 59);
        calendar.set(Calendar.MILLISECOND, 999);
        return calendar.getTimeInMillis();
    }

    /** An instant as RFC 3339 in UTC, which is what the query parser accepts. */
    private static String isoUtc(long millis) {
        SimpleDateFormat format = new SimpleDateFormat(ISO_UTC, Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    private void onRowTapped(int position) {
        if (opened == null) {
            BookmarkerApi.Collection collection = folderAdapter.itemAt(position);
            if (collection != null) openCollection(collection);
            return;
        }
        if (position >= posts.size()) {
            loadPosts(false);
            return;
        }
        BookmarkerApi.Post post = posts.get(position);
        String link = post.link();
        if (link.isEmpty()) {
            Utils.showToastShort("Twitter Bookmarker: this bookmark has no URL");
            return;
        }
        // Opening the tweet is the one thing a gallery row should do beyond showing
        // itself: the archive is a copy, and the original is where the replies are.
        openInApp(link);
    }

    /* ---------------------------------------------------------------------- */
    /* Enriching a row with the live post                                     */
    /* ---------------------------------------------------------------------- */

    /**
     * Asks Twitter what this post says today, and hands the answer back on the main
     * thread.
     *
     * <p>Only ever called from a row's bind, so the work follows the user's scroll:
     * a collection of a thousand bookmarks costs nothing until the rows are seen.
     * The row is already drawn from the archive at that point, so this is an upgrade
     * rather than a load — which is also why every failure ends in silence.
     *
     * @param onLanded run on the main thread once the post is known; the row that
     *                 asked rebinds itself then.
     */
    void enrich(final BookmarkerApi.Post post, final Runnable onLanded) {
        if (post == null || post.fxRow != null) return;
        final String id = post.tweetId;
        if (id == null || id.isEmpty()) return;
        if (ENRICH_IN_FLIGHT.contains(id)) return;

        Long failedAt = ENRICH_FAILED_AT.get(id);
        if (failedAt != null && System.currentTimeMillis() - failedAt < ENRICH_RETRY_GAP_MS) return;

        ENRICH_IN_FLIGHT.add(id);
        Utils.runOnBackgroundThread(() -> {
            FxTweet.Row row = null;
            try {
                row = FxTweet.fetch(id);
            } catch (Exception e) {
                Logger.printInfo(() -> "twb: could not read post " + id + " from Twitter: " + e);
            }

            final FxTweet.Row fetched = row;
            Utils.runOnMainThread(() -> {
                ENRICH_IN_FLIGHT.remove(id);
                if (fetched == null) {
                    ENRICH_FAILED_AT.put(id, System.currentTimeMillis());
                    return;
                }
                post.fxRow = fetched;
                onLanded.run();
            });
        });
    }

    /**
     * Opens a tweet inside X, falling back to whatever handles the URL.
     *
     * <p>X's own URL interpreter is the activity that turns an {@code x.com} link
     * into the tweet screen, and naming it explicitly is what keeps the user in the
     * app instead of handing them to a browser — a link the launcher resolves
     * normally would let the user's default browser win.
     *
     * <p>Naming it is also how this broke once: the name was a lone literal, wrong
     * for the installed X build, and every tap quietly ended in a browser. So the
     * name is now a list of candidates that are checked against the package manager
     * rather than started blindly, and behind that list is a question to the app
     * itself ({@link #handlerInApp}), which still answers after a rename. The
     * external viewer remains the last resort, and says so in the log.
     */
    private void openInApp(String url) {
        Uri target = Uri.parse(url);

        for (String candidate : POST_HANDLER_CANDIDATES) {
            Intent intent = viewIntent(target);
            intent.setClassName(getPackageName(), candidate);
            // resolveActivity, not a try/catch: a class that does not exist in this
            // build is an expected answer here, not an exception.
            if (intent.resolveActivity(getPackageManager()) == null) continue;
            if (start(intent)) {
                Logger.printInfo(() -> "twb: opened a post with " + candidate);
                return;
            }
        }

        String handler = handlerInApp(target);
        if (handler != null) {
            Intent intent = viewIntent(target);
            intent.setClassName(getPackageName(), handler);
            if (start(intent)) {
                Logger.printInfo(() -> "twb: opened a post with " + handler);
                return;
            }
        }

        Logger.printInfo(() -> "twb: nothing in the app resolved " + url
                + ", so the system had to; a tap landing in a browser is this line");
        Utils.openLink(url);
    }

    /**
     * Whatever this app registers for one of its own links.
     *
     * <p>The package filter is doing two jobs: it keeps the answer inside X, so a
     * browser can never win, and it sidesteps package visibility, which only ever
     * restricts looking at other applications.
     *
     * <p>The name preference picks out the link interpreter when the app registers
     * more than one handler. A wrong pick here is still a screen inside X, and the
     * caller logs which one it was.
     */
    private String handlerInApp(Uri target) {
        try {
            List<ResolveInfo> handlers = getPackageManager().queryIntentActivities(
                    viewIntent(target).setPackage(getPackageName()), 0);
            if (handlers == null || handlers.isEmpty()) return null;

            ResolveInfo chosen = handlers.get(0);
            for (ResolveInfo handler : handlers) {
                String name = handler.activityInfo == null ? "" : handler.activityInfo.name;
                if (name != null && name.contains("UrlInterpreter")) {
                    chosen = handler;
                    break;
                }
            }
            return chosen.activityInfo == null ? null : chosen.activityInfo.name;
        } catch (Exception e) {
            Logger.printInfo(() -> "twb: could not ask the app for a link handler: " + e);
            return null;
        }
    }

    /** The intent both resolution paths start from. */
    private static Intent viewIntent(Uri target) {
        Intent intent = new Intent(Intent.ACTION_VIEW, target);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /** True when the tap did something; a wrong guess must not swallow the tap. */
    private boolean start(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (Exception e) {
            Logger.printInfo(() -> "twb: could not open a post with "
                    + (intent.getComponent() == null ? "?" : intent.getComponent().getClassName())
                    + ": " + e);
            return false;
        }
    }

    /* ---------------------------------------------------------------------- */
    /* View plumbing                                                          */
    /* ---------------------------------------------------------------------- */

    private void updateChips() {
        paintChip(basisSavedChip, !basisPosted);
        paintChip(basisPostedChip, basisPosted);
        paintChip(newestChip, !oldestFirst);
        paintChip(oldestChip, oldestFirst);
        paintChip(clearRangeChip, !anyTime);

        if (anyTime) {
            rangeChip.setText("Any time");
            paintChip(rangeChip, false);
        } else {
            java.text.DateFormat format = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM);
            rangeChip.setText(format.format(new Date(rangeFromMs)) + " \u2013 " + format.format(new Date(rangeToMs)));
            paintChip(rangeChip, true);
        }
        clearRangeChip.setVisibility(anyTime ? View.GONE : View.VISIBLE);
    }

    /** Paint a chip as selected (accent) or not (outline). */
    private void paintChip(TextView chip, boolean selected) {
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(14));
        if (selected) {
            background.setColor(COLOR_ACCENT);
        } else {
            background.setColor(Color.TRANSPARENT);
            background.setStroke(dp(1), mutedColor());
        }
        chip.setBackground(background);
        chip.setTextColor(selected ? Color.WHITE : textColor());
    }

    private TextView chip(String label) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        chip.setTextColor(textColor());
        chip.setPadding(dp(12), dp(6), dp(12), dp(6));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMarginEnd(dp(6));
        chip.setLayoutParams(params);
        paintChip(chip, false);
        return chip;
    }

    private void setStatus(String message) {
        statusView.setText(message == null ? "" : message);
        statusView.setVisibility(message == null || message.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /** The card and body colour, for the rows that draw their own background. */
    int cardColor() {
        return dark ? COLOR_CARD_DARK : COLOR_CARD_LIGHT;
    }

    /** The window's own background: X is white or black, not a card. */
    int backgroundColor() {
        return dark ? 0xFF000000 : 0xFFFFFFFF;
    }

    /** The hairline between two posts, and the outline of a quoted one. */
    int borderColor() {
        return dark ? COLOR_BORDER_DARK : COLOR_BORDER_LIGHT;
    }

    /** The body text colour, so a row can match the screen it sits on. */
    int textColor() {
        return dark ? COLOR_TEXT_DARK : COLOR_TEXT_LIGHT;
    }

    /** The secondary colour, for counts and dates. */
    int mutedColor() {
        return dark ? COLOR_MUTED_DARK : COLOR_MUTED_LIGHT;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    private static String reason(Exception e) {
        String message = e == null ? null : e.getMessage();
        return message == null || message.isEmpty() ? "unknown error" : message;
    }
}
