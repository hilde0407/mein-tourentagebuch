package de.tourentagebuch.app;

import android.graphics.SurfaceTexture;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 2.7.1: wandelt ein HEVC-Video (H.265) auf dem Gerät in H.264 um, damit das WebView es abspielt.
 * Nur Bordmittel: MediaExtractor → Decoder → (OpenGL, skaliert falls nötig) → Encoder-Eingabefläche → MediaMuxer.
 * Ton (AAC) wird unverändert übernommen, die Drehung als Ausrichtungsangabe. Läuft synchron im aufrufenden
 * Hintergrund-Thread (kein Looper nötig); die Bild-fertig-Meldungen kommen über einen eigenen HandlerThread.
 */
final class VideoConvert {
    private VideoConvert() { }

    interface Progress { void at(int pct); }

    static final class Cancelled extends Exception { Cancelled() { super("abgebrochen"); } }

    private static final long TIMEOUT_US = 10_000;
    private static final String AVC = "video/avc";

    /** MIME-Typ der ersten Videospur oder null. */
    static String videoMime(File f) {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                String m = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("video/")) return m;
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            ex.release();
        }
    }

    static boolean isHevc(File f) { return f != null && f.isFile() && VideoPlan.needsConvert(videoMime(f)); }

    private static int track(MediaExtractor ex, String prefix) {
        for (int i = 0; i < ex.getTrackCount(); i++) {
            String m = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (m != null && m.startsWith(prefix)) return i;
        }
        return -1;
    }

    private static int intOf(MediaFormat f, String k, int def) {
        if (!f.containsKey(k)) return def;
        try { return f.getInteger(k); } catch (Exception e) {
            try { return Math.round(f.getFloat(k)); } catch (Exception e2) { return def; }
        }
    }

    /** H.264-Encoder: bevorzugt Hardware (schneller, schont den Akku), sonst der Software-Encoder von Android. */
    private static MediaCodecInfo avcEncoder() {      // Typnamen der Codecs sind klein geschrieben ("video/avc")
        MediaCodecInfo soft = null;
        for (MediaCodecInfo ci : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (!ci.isEncoder()) continue;
            for (String t : ci.getSupportedTypes()) {
                if (!t.equalsIgnoreCase(AVC)) continue;
                boolean hw = Build.VERSION.SDK_INT >= 29 ? ci.isHardwareAccelerated() : !ci.getName().toLowerCase().matches("^(omx\\.google|c2\\.android).*");
                if (hw) return ci;
                if (soft == null) soft = ci;
            }
        }
        return soft;
    }

    /**
     * Wandelt in → out (H.264/AAC, MP4). Bei Fehler oder Abbruch wird out gelöscht und eine Ausnahme geworfen;
     * in bleibt immer unberührt.
     */
    static void convert(File in, File out, AtomicBoolean cancel, Progress progress) throws Exception {
        MediaExtractor vex = new MediaExtractor(), aex = null;
        MediaCodec dec = null, enc = null;
        MediaMuxer mux = null;
        Gl gl = null;
        boolean muxStarted = false, ok = false;
        try {
            vex.setDataSource(in.getAbsolutePath());
            int vt = track(vex, "video/");
            if (vt < 0) throw new Exception("keine Videospur");
            MediaFormat vf = vex.getTrackFormat(vt);
            vex.selectTrack(vt);
            String vmime = vf.getString(MediaFormat.KEY_MIME);
            int w = intOf(vf, MediaFormat.KEY_WIDTH, 0), h = intOf(vf, MediaFormat.KEY_HEIGHT, 0);
            if (w <= 0 || h <= 0) throw new Exception("Videogröße unbekannt");
            long durUs = vf.containsKey(MediaFormat.KEY_DURATION) ? vf.getLong(MediaFormat.KEY_DURATION) : 0;
            int fps = intOf(vf, MediaFormat.KEY_FRAME_RATE, 30);
            int rot = intOf(vf, MediaFormat.KEY_ROTATION, -1);
            if (rot < 0) {                                  // nicht jede Android-Version reicht die Drehung im Spurformat durch
                MediaMetadataRetriever mr = new MediaMetadataRetriever();
                try {
                    mr.setDataSource(in.getAbsolutePath());
                    String r = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
                    rot = r == null ? 0 : Integer.parseInt(r.trim());
                } catch (Exception e) { rot = 0; } finally { try { mr.release(); } catch (Exception e) { /* egal */ } }
            }
            rot = ((rot % 360) + 360) % 360;
            if (rot % 90 != 0) rot = 0;
            long srcBps = vf.containsKey(MediaFormat.KEY_BIT_RATE) ? intOf(vf, MediaFormat.KEY_BIT_RATE, 0) : 0;
            if (srcBps <= 0 && durUs > 0) srcBps = in.length() * 8L * 1_000_000L / durUs;      // Obergrenze (inkl. Ton)
            int transfer = intOf(vf, MediaFormat.KEY_COLOR_TRANSFER, 0);
            boolean hdr = transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG;
            if (hdr && Build.VERSION.SDK_INT < 31) throw new Exception("HDR-Video: Umwandlung erst ab Android 12 möglich");

            // Ton: AAC wird unverändert übernommen
            aex = new MediaExtractor();
            aex.setDataSource(in.getAbsolutePath());
            int at = track(aex, "audio/");
            MediaFormat af = null;
            if (at >= 0) {
                af = aex.getTrackFormat(at);
                if (!"audio/mp4a-latm".equalsIgnoreCase(af.getString(MediaFormat.KEY_MIME))) throw new Exception("Tonspur ist kein AAC (" + af.getString(MediaFormat.KEY_MIME) + ")");
                aex.selectTrack(at);
            }

            // Encoder und Zielgröße
            MediaCodecInfo ci = avcEncoder();
            if (ci == null) throw new Exception("kein H.264-Encoder");
            MediaCodecInfo.VideoCapabilities vc = ci.getCapabilitiesForType(AVC).getVideoCapabilities();
            int maxW = vc.getSupportedWidths().getUpper(), maxH = vc.getSupportedHeights().getUpper();
            int maxLong = Math.max(maxW, maxH), maxShort = Math.min(maxW, maxH);
            int[] s = VideoPlan.size(w, h, maxLong, maxShort);
            for (int k = 0; k < 8 && !vc.isSizeSupported(s[0], s[1]); k++) {
                maxLong = Math.max(s[0], s[1]) * 85 / 100; maxShort = Math.min(s[0], s[1]) * 85 / 100;
                s = VideoPlan.size(w, h, maxLong, maxShort);
            }
            if (!vc.isSizeSupported(s[0], s[1])) throw new Exception("Videogröße " + w + "×" + h + " passt nicht zum H.264-Encoder");
            int ow = s[0], oh = s[1];
            int br = VideoPlan.bitrate(srcBps, w, h, ow, oh, fps, vc.getBitrateRange().getUpper());

            MediaFormat ef = MediaFormat.createVideoFormat(AVC, ow, oh);
            ef.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            ef.setInteger(MediaFormat.KEY_BIT_RATE, br);
            ef.setInteger(MediaFormat.KEY_FRAME_RATE, fps > 0 && fps <= 240 ? fps : 30);
            ef.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            enc = MediaCodec.createByCodecName(ci.getName());
            enc.configure(ef, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            gl = new Gl(enc.createInputSurface(), ow, oh);
            enc.start();

            MediaFormat df = vf;
            df.setInteger(MediaFormat.KEY_ROTATION, 0);     // sonst dreht der Decoder schon auf der Fläche – die Drehung steht als Angabe im Muxer
            if (hdr && Build.VERSION.SDK_INT >= 31) df.setInteger(MediaFormat.KEY_COLOR_TRANSFER_REQUEST, MediaFormat.COLOR_TRANSFER_SDR_VIDEO);
            dec = MediaCodec.createDecoderByType(vmime);
            dec.configure(df, gl.decoderSurface(), null, 0);
            dec.start();

            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            mux.setOrientationHint(rot);
            int muxV = -1, muxA = -1;

            MediaCodec.BufferInfo di = new MediaCodec.BufferInfo(), ei = new MediaCodec.BufferInfo(), ai = new MediaCodec.BufferInfo();
            ByteBuffer abuf = ByteBuffer.allocateDirect(af != null && af.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE) ? Math.max(64 * 1024, af.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)) : 512 * 1024);
            boolean exDone = false, decDone = false, encDone = false, audioDone = at < 0;
            long lastVideoUs = 0;
            int lastPct = -1;
            while (!encDone) {
                if (cancel != null && cancel.get()) throw new Cancelled();
                // 1. Datei → Decoder
                if (!exDone) {
                    int ix = dec.dequeueInputBuffer(TIMEOUT_US);
                    if (ix >= 0) {
                        ByteBuffer b = dec.getInputBuffer(ix);
                        int n = b == null ? -1 : vex.readSampleData(b, 0);
                        if (n < 0) { dec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); exDone = true; }
                        else { dec.queueInputBuffer(ix, 0, n, vex.getSampleTime(), 0); vex.advance(); }
                    }
                }
                // 2. Decoder → OpenGL → Encoder
                if (!decDone) {
                    int ox = dec.dequeueOutputBuffer(di, TIMEOUT_US);
                    if (ox == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (hdr) {
                            int t = intOf(dec.getOutputFormat(), MediaFormat.KEY_COLOR_TRANSFER, 0);
                            if (t == MediaFormat.COLOR_TRANSFER_ST2084 || t == MediaFormat.COLOR_TRANSFER_HLG) throw new Exception("HDR-Video lässt sich auf diesem Handy nicht umwandeln");
                        }
                    } else if (ox >= 0) {
                        boolean render = di.size != 0;
                        long pts = di.presentationTimeUs;
                        boolean eos = (di.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                        dec.releaseOutputBuffer(ox, render);
                        if (render) {
                            gl.awaitFrame();
                            gl.draw(pts * 1000L);
                            int p = VideoPlan.percent(pts, durUs);
                            if (p != lastPct && progress != null) { lastPct = p; progress.at(p); }
                        }
                        if (eos) { enc.signalEndOfInputStream(); decDone = true; }
                    }
                }
                // 3. Encoder leeren → Muxer (und Ton bis zur aktuellen Bildzeit dazwischen)
                while (true) {
                    int ex = enc.dequeueOutputBuffer(ei, decDone ? TIMEOUT_US : 0);
                    if (ex == MediaCodec.INFO_TRY_AGAIN_LATER) break;
                    if (ex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (muxStarted) throw new Exception("Encoderformat änderte sich zweimal");
                        muxV = mux.addTrack(enc.getOutputFormat());
                        if (af != null) muxA = mux.addTrack(af);
                        mux.start();
                        muxStarted = true;
                        continue;
                    }
                    if (ex < 0) continue;
                    ByteBuffer ob = enc.getOutputBuffer(ex);
                    if ((ei.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) ei.size = 0;
                    if (ei.size > 0 && ob != null) {
                        if (!muxStarted) throw new Exception("Encoder lieferte Daten vor dem Format");
                        ob.position(ei.offset); ob.limit(ei.offset + ei.size);
                        mux.writeSampleData(muxV, ob, ei);
                        lastVideoUs = ei.presentationTimeUs;
                    }
                    enc.releaseOutputBuffer(ex, false);
                    if ((ei.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) { encDone = true; break; }
                }
                if (muxStarted && !audioDone) audioDone = copyAudio(aex, mux, muxA, abuf, ai, encDone ? Long.MAX_VALUE : lastVideoUs);
            }
            if (!audioDone && muxStarted) copyAudio(aex, mux, muxA, abuf, ai, Long.MAX_VALUE);
            if (!muxStarted) throw new Exception("keine Bilder umgewandelt");
            ok = true;
        } finally {
            if (dec != null) { try { dec.stop(); } catch (Exception e) { /* egal */ } try { dec.release(); } catch (Exception e) { /* egal */ } }
            if (enc != null) { try { enc.stop(); } catch (Exception e) { /* egal */ } try { enc.release(); } catch (Exception e) { /* egal */ } }
            if (gl != null) gl.release();
            if (mux != null) {
                if (muxStarted) { try { mux.stop(); } catch (Exception e) { if (ok) { ok = false; AppLog.log("Video-Muxer: " + e); } } }
                try { mux.release(); } catch (Exception e) { /* egal */ }
            }
            try { vex.release(); } catch (Exception e) { /* egal */ }
            if (aex != null) { try { aex.release(); } catch (Exception e) { /* egal */ } }
            if (!ok) out.delete();
        }
        if (!ok) throw new Exception("Video-Datei konnte nicht abgeschlossen werden");
    }

    /** Tonproben bis einschließlich untilUs in den Muxer; true, wenn die Tonspur zu Ende ist. */
    private static boolean copyAudio(MediaExtractor aex, MediaMuxer mux, int track, ByteBuffer buf, MediaCodec.BufferInfo ai, long untilUs) {
        if (track < 0) return true;
        while (true) {
            long t = aex.getSampleTime();
            if (t < 0) return true;
            if (t > untilUs) return false;
            buf.clear();
            int n = aex.readSampleData(buf, 0);
            if (n < 0) return true;
            int fl = (aex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
            ai.set(0, n, t, fl);
            mux.writeSampleData(track, buf, ai);
            aex.advance();
        }
    }

    /**
     * OpenGL-Zwischenschritt: der Decoder malt in eine SurfaceTexture, die wird (ggf. verkleinert) auf die Eingabefläche
     * des Encoders gezeichnet. So geht kein Bild verloren (wir warten auf jedes) und Zuschnitt/Skalierung stimmen.
     */
    private static final class Gl implements SurfaceTexture.OnFrameAvailableListener {
        private static final int EGL_RECORDABLE_ANDROID = 0x3142;
        private static final String VS = "attribute vec4 aPos;\nattribute vec4 aTex;\nuniform mat4 uST;\nvarying vec2 vTex;\n"
                + "void main() { gl_Position = aPos; vTex = (uST * aTex).xy; }\n";
        private static final String FS = "#extension GL_OES_EGL_image_external : require\nprecision mediump float;\nvarying vec2 vTex;\n"
                + "uniform samplerExternalOES sTex;\nvoid main() { gl_FragColor = texture2D(sTex, vTex); }\n";
        private final EGLDisplay dpy;
        private final EGLContext ctx;
        private final EGLSurface surf;
        private final Surface encSurface, decSurface;
        private final SurfaceTexture st;
        private final HandlerThread ht;
        private final int prog, tex, aPos, aTex, uST, w, h;
        private final float[] mtx = new float[16];
        private final FloatBuffer quad;
        private final Object lock = new Object();
        private boolean frame;

        Gl(Surface encSurface, int w, int h) throws Exception {
            this.encSurface = encSurface; this.w = w; this.h = h;
            dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
            int[] ver = new int[2];
            if (dpy == EGL14.EGL_NO_DISPLAY || !EGL14.eglInitialize(dpy, ver, 0, ver, 1)) throw new Exception("EGL nicht verfügbar");
            int[] attr = {EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                    EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL_RECORDABLE_ANDROID, 1, EGL14.EGL_NONE};
            EGLConfig[] cfg = new EGLConfig[1];
            int[] num = new int[1];
            if (!EGL14.eglChooseConfig(dpy, attr, 0, cfg, 0, 1, num, 0) || num[0] < 1) throw new Exception("keine passende EGL-Konfiguration");
            ctx = EGL14.eglCreateContext(dpy, cfg[0], EGL14.EGL_NO_CONTEXT, new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE}, 0);
            if (ctx == null || ctx == EGL14.EGL_NO_CONTEXT) throw new Exception("EGL-Kontext fehlt");
            surf = EGL14.eglCreateWindowSurface(dpy, cfg[0], encSurface, new int[]{EGL14.EGL_NONE}, 0);
            if (surf == null || surf == EGL14.EGL_NO_SURFACE) throw new Exception("EGL-Fläche fehlt");
            if (!EGL14.eglMakeCurrent(dpy, surf, surf, ctx)) throw new Exception("EGL makeCurrent fehlgeschlagen");

            prog = program(VS, FS);
            aPos = GLES20.glGetAttribLocation(prog, "aPos");
            aTex = GLES20.glGetAttribLocation(prog, "aTex");
            uST = GLES20.glGetUniformLocation(prog, "uST");
            int[] t = new int[1];
            GLES20.glGenTextures(1, t, 0);
            tex = t[0];
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            float[] q = {-1f, -1f, 0f, 0f, 1f, -1f, 1f, 0f, -1f, 1f, 0f, 1f, 1f, 1f, 1f, 1f};
            quad = ByteBuffer.allocateDirect(q.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
            quad.put(q).position(0);

            ht = new HandlerThread("VideoFrames");
            ht.start();
            st = new SurfaceTexture(tex);
            st.setOnFrameAvailableListener(this, new Handler(ht.getLooper()));
            decSurface = new Surface(st);
        }

        Surface decoderSurface() { return decSurface; }

        @Override public void onFrameAvailable(SurfaceTexture s) {
            synchronized (lock) { frame = true; lock.notifyAll(); }
        }

        void awaitFrame() throws Exception {
            long until = System.currentTimeMillis() + 5000;
            synchronized (lock) {
                while (!frame) {
                    long left = until - System.currentTimeMillis();
                    if (left <= 0) throw new Exception("Zeitüberschreitung beim Dekodieren");
                    lock.wait(left);
                }
                frame = false;
            }
            st.updateTexImage();
            st.getTransformMatrix(mtx);
        }

        void draw(long ptsNs) throws Exception {
            GLES20.glViewport(0, 0, w, h);
            GLES20.glClearColor(0f, 0f, 0f, 1f);
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
            GLES20.glUseProgram(prog);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex);
            quad.position(0);
            GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 16, quad);
            GLES20.glEnableVertexAttribArray(aPos);
            quad.position(2);
            GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 16, quad);
            GLES20.glEnableVertexAttribArray(aTex);
            GLES20.glUniformMatrix4fv(uST, 1, false, mtx, 0);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
            EGLExt.eglPresentationTimeANDROID(dpy, surf, ptsNs);
            if (!EGL14.eglSwapBuffers(dpy, surf)) throw new Exception("eglSwapBuffers fehlgeschlagen");
        }

        private static int shader(int type, String src) throws Exception {
            int s = GLES20.glCreateShader(type);
            GLES20.glShaderSource(s, src);
            GLES20.glCompileShader(s);
            int[] ok = new int[1];
            GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
            if (ok[0] == 0) { String log = GLES20.glGetShaderInfoLog(s); GLES20.glDeleteShader(s); throw new Exception("Shader: " + log); }
            return s;
        }

        private static int program(String vs, String fs) throws Exception {
            int p = GLES20.glCreateProgram();
            GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs));
            GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs));
            GLES20.glLinkProgram(p);
            int[] ok = new int[1];
            GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0);
            if (ok[0] == 0) { String log = GLES20.glGetProgramInfoLog(p); GLES20.glDeleteProgram(p); throw new Exception("Programm: " + log); }
            return p;
        }

        void release() {
            try { decSurface.release(); } catch (Exception e) { /* egal */ }
            try { st.release(); } catch (Exception e) { /* egal */ }
            try {
                EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                EGL14.eglDestroySurface(dpy, surf);
                EGL14.eglDestroyContext(dpy, ctx);
                EGL14.eglReleaseThread();
                EGL14.eglTerminate(dpy);
            } catch (Exception e) { /* egal */ }
            try { encSurface.release(); } catch (Exception e) { /* egal */ }
            try { ht.quitSafely(); } catch (Exception e) { /* egal */ }
        }
    }
}
