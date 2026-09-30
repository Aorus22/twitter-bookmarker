package app.morphe.extension.twitter.patches.bookmarker;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/**
 * The glyphs this overlay draws itself, in the units of a 24 dp icon box.
 *
 * <p>X's own drawables could be borrowed for these — that is what the verified badge
 * does — but only for the names that are actually in the installed build, and a name
 * that misses shows a hole. That happened: the action bar's four glyphs were looked up
 * by guesswork ({@code ic_vector_reply}, {@code ic_vector_retweet}, …), none of them
 * resolved on a real device, and a post ended up with a row of bare numbers and no
 * icons at all. The same was true of the filter button, which fell back to the word.
 *
 * <p>Drawing them removes the lookup: a shape drawn here cannot be missing, cannot be
 * renamed by an app update, and costs nothing at runtime. The shapes are X's, near
 * enough to read as the same set at 17 dp: an outlined heart, two arrows chasing each
 * other, a bubble, four bars, and three sliders.
 *
 * <p>Each glyph is scaled to the bounds it is given, so one instance fits a 17 dp
 * action-bar slot and a 20 dp header button alike.
 */
final class BookmarkerGlyphs {

    /** Replies, reposts, likes, views — in the order X's action bar shows them. */
    static final int REPLY = 0;
    static final int REPOST = 1;
    static final int LIKE = 2;
    static final int VIEWS = 3;

    /** The sliders glyph on the gallery's filter button. */
    static final int FILTER = 4;

    private BookmarkerGlyphs() {}

    /** One glyph, in one colour. */
    static Drawable of(int glyph, int color) {
        return new Glyph(glyph, color);
    }

    private static final class Glyph extends Drawable {

        private final int glyph;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        Glyph(int glyph, int color) {
            this.glyph = glyph;
            paint.setColor(color);
            // X's icons are rounded at every corner and cap; without this the arrows
            // and the heart read as a wireframe rather than as a drawing.
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override
        public void draw(Canvas canvas) {
            Rect bounds = getBounds();
            if (bounds.width() <= 0 || bounds.height() <= 0) return;

            // One unit is a twenty-fourth of the shorter side, which is the box these
            // shapes were designed in; a stroke of 1.9 units is X's own weight.
            float unit = Math.min(bounds.width(), bounds.height()) / 24f;
            canvas.save();
            canvas.translate(bounds.left, bounds.top);
            paint.setStrokeWidth(1.9f * unit);

            switch (glyph) {
                case REPLY:
                    reply(canvas, unit);
                    break;
                case REPOST:
                    repost(canvas, unit);
                    break;
                case LIKE:
                    like(canvas, unit);
                    break;
                case VIEWS:
                    views(canvas, unit);
                    break;
                case FILTER:
                    filter(canvas, unit);
                    break;
                default:
                    break;
            }
            canvas.restore();
        }

        /**
         * A speech bubble with a tail, filled.
         *
         * <p>Filled rather than outlined because the tail has to meet the bubble: an
         * outline would show the bubble's bottom edge running through the tail unless
         * the shape were built as a single path by hand, and at this size the filled
         * version reads the same.
         */
        private void reply(Canvas canvas, float unit) {
            paint.setStyle(Paint.Style.FILL);
            Path path = new Path();
            path.addRoundRect(new RectF(2.9f * unit, 3.3f * unit, 21.1f * unit, 16.7f * unit),
                    4.4f * unit, 4.4f * unit, Path.Direction.CW);
            path.moveTo(7.1f * unit, 15.2f * unit);
            path.lineTo(7.1f * unit, 21.3f * unit);
            path.lineTo(12.5f * unit, 16.7f * unit);
            path.close();
            canvas.drawPath(path, paint);
        }

        /** Two arrows chasing each other: the repost glyph. */
        private void repost(Canvas canvas, float unit) {
            paint.setStyle(Paint.Style.STROKE);
            Path path = new Path();
            // The top arrow runs left to right and turns down at the right edge.
            path.moveTo(7.3f * unit, 9.6f * unit);
            path.lineTo(7.3f * unit, 7.1f * unit);
            path.lineTo(16.7f * unit, 7.1f * unit);
            path.moveTo(13.9f * unit, 4.3f * unit);
            path.lineTo(16.9f * unit, 7.1f * unit);
            path.lineTo(13.9f * unit, 9.9f * unit);
            // The bottom arrow is that shape mirrored.
            path.moveTo(16.7f * unit, 14.4f * unit);
            path.lineTo(16.7f * unit, 16.9f * unit);
            path.lineTo(7.3f * unit, 16.9f * unit);
            path.moveTo(10.1f * unit, 14.1f * unit);
            path.lineTo(7.1f * unit, 16.9f * unit);
            path.lineTo(10.1f * unit, 19.7f * unit);
            canvas.drawPath(path, paint);
        }

        /** The heart, outlined: X's like glyph. */
        private void like(Canvas canvas, float unit) {
            paint.setStyle(Paint.Style.STROKE);
            Path path = new Path();
            path.moveTo(12f * unit, 20.4f * unit);
            path.cubicTo(4.7f * unit, 15.3f * unit, 2.7f * unit, 12.4f * unit, 2.7f * unit, 9.2f * unit);
            path.cubicTo(2.7f * unit, 6.0f * unit, 5.2f * unit, 3.5f * unit, 8.2f * unit, 3.5f * unit);
            path.cubicTo(10.0f * unit, 3.5f * unit, 11.4f * unit, 4.5f * unit, 12f * unit, 5.3f * unit);
            path.cubicTo(12.6f * unit, 4.5f * unit, 14.0f * unit, 3.5f * unit, 15.8f * unit, 3.5f * unit);
            path.cubicTo(18.8f * unit, 3.5f * unit, 21.3f * unit, 6.0f * unit, 21.3f * unit, 9.2f * unit);
            path.cubicTo(21.3f * unit, 12.4f * unit, 19.3f * unit, 15.3f * unit, 12f * unit, 20.4f * unit);
            path.close();
            canvas.drawPath(path, paint);
        }

        /** Four bars of rising height: the impressions glyph. */
        private void views(Canvas canvas, float unit) {
            paint.setStyle(Paint.Style.FILL);
            float[] heights = {4.6f, 8.4f, 12.2f, 16.0f};
            float width = 3.0f * unit;
            float bottom = 20.4f * unit;
            for (int bar = 0; bar < heights.length; bar++) {
                float left = (3.5f + bar * 4.9f) * unit;
                canvas.drawRoundRect(
                        new RectF(left, bottom - heights[bar] * unit, left + width, bottom),
                        width / 2f, width / 2f, paint);
            }
        }

        /** Three sliders: the filter glyph, with a knob on each line. */
        private void filter(Canvas canvas, float unit) {
            float[] lines = {6.8f, 12f, 17.2f};
            float[] knobs = {15.6f, 8.6f, 13.4f};
            paint.setStyle(Paint.Style.STROKE);
            for (float y : lines) {
                canvas.drawLine(3.2f * unit, y * unit, 20.8f * unit, y * unit, paint);
            }
            Paint knob = new Paint(paint);
            knob.setStyle(Paint.Style.FILL);
            for (int i = 0; i < lines.length; i++) {
                canvas.drawCircle(knobs[i] * unit, lines[i] * unit, 2.6f * unit, knob);
            }
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(ColorFilter filter) {
            paint.setColorFilter(filter);
        }

        @Override
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }
}
