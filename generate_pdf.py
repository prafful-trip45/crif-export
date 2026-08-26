import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (pages 2+)
        if self._pageNumber > 1:
            self.drawString(54, 750, "React Native Lead Interview Revision Guide — Kirana Club Prep")
            self.setStrokeColor(colors.HexColor("#E2E8F0"))
            self.setLineWidth(0.5)
            self.line(54, 742, 558, 742)
        
        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(54, 45, 558, 45)
        
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 30, page_text)
        self.drawString(54, 30, "CONFIDENTIAL & PROPRIETARY — FOR INTERVIEW PREPARATION ONLY")
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    COLOR_PRIMARY = colors.HexColor("#0F172A")    # Dark slate
    COLOR_SECONDARY = colors.HexColor("#0284C7")  # Deep cyan
    COLOR_TEXT = colors.HexColor("#334155")       # Charcoal
    COLOR_BG_LIGHT = colors.HexColor("#F8FAFC")   # Light slate bg
    COLOR_BORDER = colors.HexColor("#CBD5E1")     # Border light
    COLOR_CODE_BG = colors.HexColor("#1E293B")   # Dark code bg

    # Modify / Add styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=COLOR_PRIMARY,
        spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=COLOR_SECONDARY,
        spaceAfter=15
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=COLOR_PRIMARY,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=COLOR_SECONDARY,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=COLOR_TEXT,
        spaceAfter=6
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=12,
        firstLineIndent=-8,
        spaceAfter=4
    )

    code_style = ParagraphStyle(
        'Code_Custom',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#E2E8F0"),
        spaceBefore=4,
        spaceAfter=4
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=body_style,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#1E293B")
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.white
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11.5,
        textColor=COLOR_TEXT
    )

    story = []

    # Title Banner
    story.append(Paragraph("React Native Lead — Interview Revision Guide", title_style))
    story.append(Paragraph("Targeted Crux Notes & Deep-Dive Technical Blueprint | Kirana Club Context", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_SECONDARY, spaceBefore=0, spaceAfter=12))

    # Context Box
    ctx_html = (
        "<b>Target Application Profile (Kirana Club Lens):</b><br/>"
        "• <b>Users:</b> Tier 2/3/4 Indian kirana owners on low-end Android devices (<b>₹8,000–13,000</b> range, ~2–3 GB RAM).<br/>"
        "• <b>Network:</b> Highly constrained, high-latency, unreliable cellular networks (2G/3G/spotty 4G).<br/>"
        "• <b>Content:</b> Media-heavy feed (Images, Videos, Community Posts, B2B Commerce catalog, 1Cr+ downloads).<br/>"
        "• <b>Core Challenge:</b> Delivering 60fps fast-loading feeds on weak CPUs/RAM without memory leaks or scroll jank."
    )
    ctx_table = Table([[Paragraph(ctx_html, callout_style)]], colWidths=[504])
    ctx_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F0F9FF")),
        ('BORDER', (0,0), (-1,-1), 1, colors.HexColor("#BAE6FD")),
        ('PADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(ctx_table)
    story.append(Spacer(1, 10))

    # SECTION 1: RN Internals
    story.append(Paragraph("1. React Native Internals & Architecture Evolution", h1_style))
    
    story.append(Paragraph("Why UI Lag Happens", h2_style))
    story.append(Paragraph("• <b>Single-Threaded JS Model:</b> The JS thread handles business logic, state updates, API parsing, and component rendering calculations. If blocked, frame generation stops, causing UI jank.", bullet_style))
    story.append(Paragraph("• <b>Major Blockers:</b> Synchronous heavy CPU computation, parsing large deeply-nested JSON payloads, promise queue starvation, and JS-driven layout/animation calculations.", bullet_style))

    story.append(Paragraph("JS Event Loop: Micro-tasks vs. Macro-tasks", h2_style))
    story.append(Paragraph("• <b>Micro-tasks:</b> <code>Promise</code> callbacks, <code>queueMicrotask</code>. Processed immediately after current execution stack empties, before the next macro-task.", bullet_style))
    story.append(Paragraph("• <b>Macro-tasks:</b> <code>setTimeout</code>, <code>setInterval</code>, I/O events. Executed in subsequent event loop ticks.", bullet_style))
    story.append(Paragraph("• <i>Interview Insight:</i> Uncontrolled Promise chains clog the micro-task queue, completely starving render updates.", bullet_style))

    story.append(Paragraph("Old Architecture (Bridge) vs. New Architecture", h2_style))
    
    arch_data = [
        [Paragraph("Feature", table_header_style), Paragraph("Old Architecture (Bridge)", table_header_style), Paragraph("New Architecture (JSI / Fabric / Turbo)", table_header_style)],
        [Paragraph("Communication", table_cell_style), Paragraph("Async JSON serialization over bridge queue.", table_cell_style), Paragraph("Direct synchronous C++ calls via <b>JSI</b>.", table_cell_style)],
        [Paragraph("Native Modules", table_cell_style), Paragraph("Eager initialization on app launch.", table_cell_style), Paragraph("<b>TurboModules</b>: Lazy loaded on-demand.", table_cell_style)],
        [Paragraph("UI Renderer", table_cell_style), Paragraph("Paper ViewManager (Async over bridge).", table_cell_style), Paragraph("<b>Fabric</b>: Concurrent, thread-safe, sync layout.", table_cell_style)],
        [Paragraph("JS Engine", table_cell_style), Paragraph("JSC / Hermes standard mode.", table_cell_style), Paragraph("<b>Hermes</b> pre-compiled bytecode (Fast TTI, low RAM).", table_cell_style)],
    ]
    arch_table = Table(arch_data, colWidths=[100, 202, 202])
    arch_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), COLOR_PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, COLOR_BG_LIGHT]),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(arch_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Core Architecture Deep-Dive Terminology", h2_style))
    story.append(Paragraph("• <b>JSI (JavaScript Interface):</b> Replaces the asynchronous JSON bridge with C++ host objects. Enables JS to hold direct memory references to native methods for synchronous execution.", bullet_style))
    story.append(Paragraph("• <b>Fabric:</b> Direct native UI renderer. Allows React to measure and manipulate native view trees synchronously without bridge serialization.", bullet_style))
    story.append(Paragraph("• <b>Hermes:</b> A light JS engine tuned for React Native. Pre-compiles JS into bytecode at build time, eliminating runtime parsing, lowering RAM usage, and accelerating Time-To-Interactive (TTI).", bullet_style))
    story.append(Paragraph("• <b>Yoga:</b> Cross-platform layout engine (written in C++) that converts CSS Flexbox declarations into absolute native view coordinates.", bullet_style))

    story.append(Paragraph("Network Path of an API Call", h2_style))
    story.append(Paragraph("• <b>Flow:</b> <code>fetch/Axios</code> (JS) → JS Wrapper → <b>JSI/Bridge</b> → Native Networking (<code>OkHttp</code> / <code>NSURLSession</code>) → Network → Response parsing → <b>JSI/Bridge</b> → JS Thread (<code>Promise.resolve</code>).", bullet_style))
    story.append(Paragraph("• <b>Cost Drivers:</b> Stringifying/parsing large JSON strings across the JS boundary and JS Heap object allocation overhead during Garbage Collection.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 2: Performance
    story.append(Paragraph("2. Performance Tuning & Rendering Optimization", h1_style))
    story.append(Paragraph("• <b>Key Metrics:</b> Measure FPS (JS vs UI thread), Cold Start TTI, Scroll Jank, and Memory Heap spikes (GC pauses).", bullet_style))
    story.append(Paragraph("• <b>Re-Render Control:</b> Leverage <code>React.memo</code> with custom comparison functions, <code>useCallback</code> and <code>useMemo</code> for referential stability, and component granularity to isolate state updates.", bullet_style))
    story.append(Paragraph("• <b>Memory Leaks & GC:</b> Uncleared timers (<code>setInterval</code>), orphaned <code>DeviceEventEmitter</code> listeners, and un-purged JS-held image caches cause severe memory leaks and GC frame stutter on 2GB RAM phones.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 3: List Rendering
    story.append(Paragraph("3. List Rendering: FlatList vs. FlashList", h1_style))
    story.append(Paragraph("• <b>FlatList Tuning:</b> Use <code>getItemLayout</code> for fixed height items (bypasses layout measurement), reduce <code>windowSize</code> (default 21 → 5-7 on low-end Android), tune <code>maxToRenderPerBatch</code>, and set <code>removeClippedSubviews={true}</code>.", bullet_style))
    story.append(Paragraph("• <b>FlashList (Shopify):</b> Employs <b>Cell Recycling</b> (reuses existing native views like Android <code>RecyclerView</code>) instead of unmounting/remounting elements. Drastically cuts native view creation cost and prevents blank spaces during fast scrolling.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 4: Media Optimization Deep Dive
    story.append(Paragraph("4. Media Optimization (Images & Video) on Weak Networks", h1_style))
    story.append(Paragraph("• <b>Images - Sizing & Caching:</b> Request exact-sized image variants from CDN based on screen density using <code>PixelRatio.getPixelSizeForLayoutSize()</code>. Rely on <code>FastImage</code> (Glide/SDWebImage) for aggressive disk/RAM caching.", bullet_style))
    story.append(Paragraph("• <b>Images - Placeholders & Rendering:</b> Use <b>BlurHash</b> or 50-byte low-res base64 thumbnails (LQIP) while streaming full images. Avoid <code>borderRadius</code> on massive images (causes expensive off-screen rendering on Android); instead use overlay shapes.", bullet_style))
    story.append(Paragraph("• <b>Video - Adaptive Streaming:</b> Use Adaptive Bitrate Streaming (HLS/DASH) to automatically downgrade resolution (e.g., to 360p) on 2G/3G connections.", bullet_style))
    story.append(Paragraph("• <b>Video - Memory Management:</b> Low-end devices (2-3GB RAM) can only decode 1-2 videos simultaneously. Enforce strict pre-buffer limits (max 1 upcoming video) and use exact viewport visibility to auto-pause off-screen players, preventing OOM crashes.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 5: App Boot Time Optimization
    story.append(Paragraph("5. App Boot Time (Cold Start) Optimization", h1_style))
    story.append(Paragraph("• <b>Hermes Engine:</b> Ensure Hermes is enabled to pre-compile JS into bytecode at build time. This bypasses the heavy JS parsing step on device, reducing TTI (Time-To-Interactive) significantly.", bullet_style))
    story.append(Paragraph("• <b>Lazy Loading & TurboModules:</b> Migrate from eager-loaded native modules to JSI-based <b>TurboModules</b> (lazy instantiation). Lazy load JS components via <code>React.lazy</code> that are not immediately visible on the initial screen.", bullet_style))
    story.append(Paragraph("• <b>Asset & API Strategy:</b> Inline small critical icons as SVGs. Delay loading heavy custom fonts until layout completes. Fetch initial feed data synchronously from <b>MMKV</b> local storage on boot to display UI instantly, then revalidate via network in the background.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 6: Animations
    story.append(Paragraph("6. Animations & Threading", h1_style))
    story.append(Paragraph("• <b><code>useNativeDriver: true</code>:</b> Offloads frame updates directly to the UI thread (Android <code>Choreographer</code>). Keeps animations smooth even if the JS thread is frozen. Limited to non-layout properties (<code>transform</code>, <code>opacity</code>).", bullet_style))
    story.append(Paragraph("• <b>Reanimated (v2/v3):</b> Executes JS <b>Worklets</b> on a dedicated UI JS runtime context using JSI, allowing high-performance gesture animations without main JS thread bottleneck.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 7: Storage
    story.append(Paragraph("7. State Management, Storage & Persistence", h1_style))
    
    storage_data = [
        [Paragraph("Storage Metric", table_header_style), Paragraph("AsyncStorage", table_header_style), Paragraph("MMKV (Tencent / react-native-mmkv)", table_header_style)],
        [Paragraph("Architecture", table_cell_style), Paragraph("Async calls via SQLite/SharedPreferences over bridge.", table_cell_style), Paragraph("Synchronous C++ memory-mapped file access via JSI.", table_cell_style)],
        [Paragraph("Read/Write Speed", table_cell_style), Paragraph("Slow (Async overhead, string serialization).", table_cell_style), Paragraph("<b>~10x–30x faster</b> (Direct memory access).", table_cell_style)],
        [Paragraph("Thread Model", table_cell_style), Paragraph("Asynchronous (Promises).", table_cell_style), Paragraph("Synchronous direct read/write.", table_cell_style)],
    ]
    storage_table = Table(storage_data, colWidths=[100, 202, 202])
    storage_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), COLOR_PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, COLOR_BG_LIGHT]),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(storage_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("• <b>Offline Architecture:</b> Serve cached feed data instantly from MMKV on cold start, perform optimistic UI updates, and queue background requests with write-ahead logs.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 8: System Design
    story.append(Paragraph("8. Hands-on System Design: Scroll Event Telemetry & Batching", h1_style))
    story.append(Paragraph("<b>Scenario:</b> Track scroll viewport viewability for items without analytics SDK, resilient to crashes and offline state.", body_style))

    code_snippet = (
        "import { MMKV } from 'react-native-mmkv';\n"
        "const storage = new MMKV();\n"
        "let eventQueue: Event[] = [];\n"
        "const BATCH_SIZE = 20;\n\n"
        "export const trackView = (itemId: string) => {\n"
        "  eventQueue.push({ itemId, timestamp: Date.now() });\n"
        "  if (eventQueue.length >= BATCH_SIZE) flushEvents();\n"
        "};\n\n"
        "const flushEvents = async () => {\n"
        "  if (eventQueue.length === 0) return;\n"
        "  const payload = [...eventQueue];\n"
        "  eventQueue = [];\n"
        "  storage.set('pending_analytics', JSON.stringify(payload)); // MMKV Fallback\n"
        "  try {\n"
        "    await api.post('/analytics/batch', { events: payload });\n"
        "    storage.delete('pending_analytics');\n"
        "  } catch (err) { /* Retry on next tick/launch */ }\n"
        "};"
    )

    code_table = Table([[Paragraph(code_snippet.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style)]], colWidths=[504])
    code_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), COLOR_CODE_BG),
        ('PADDING', (0,0), (-1,-1), 8),
        ('RADIUS', (0,0), (-1,-1), 4),
    ]))
    story.append(code_table)
    story.append(Spacer(1, 10))

    # SECTION 9: Shipping & WebViews
    story.append(Paragraph("9. Shipping, SDUI & WebView Performance", h1_style))
    story.append(Paragraph("• <b>Server-Driven UI (SDUI):</b> Backend sends JSON layout contracts. Protect older apps with strict client side schema validation (Zod) and component fallbacks to prevent crashes.", bullet_style))
    story.append(Paragraph("• <b>OTA Updates (CodePush / Expo Updates):</b> Instantly update JS bundle logic and assets. <i>Hard Limit:</i> Native code changes (Java/Kotlin/ObjC), new native packages, or native permissions require full store release.", bullet_style))
    story.append(Paragraph("• <b>WebView Trade-offs on Low-End Devices:</b>", bullet_style))
    story.append(Paragraph("  - <b>High Memory Footprint:</b> WebViews launch a separate Chromium instance on Android, consuming ~100MB+ RAM just to boot, risking OOM crashes on 2GB RAM phones.", bullet_style))
    story.append(Paragraph("  - <b>Cold Start Penalty:</b> Booting the WebView engine adds 500ms–1s of pure overhead.", bullet_style))
    story.append(Paragraph("  - <b>Lost Native Responsiveness:</b> Multi-touch, list virtualization (FlashList), and hardware-accelerated animations are absent.", bullet_style))
    story.append(Paragraph("  - <b>Strategy:</b> Use strictly for static, low-frequency content (Terms & Conditions, Help). Use Native/SDUI for interactive core feeds.", bullet_style))

    story.append(Spacer(1, 10))

    # SECTION 10: Observability
    story.append(Paragraph("10. Observability & AI Workflow in RN Lead Role", h1_style))
    story.append(Paragraph("• <b>Observability:</b> Instrument Sentry/Crashlytics for dual JS + Native stack traces. Profile rendering via Flipper and Android Studio Profiler.", bullet_style))
    story.append(Paragraph("• <b>AI Workflow:</b> Leverage AI for boilerplate creation, unit testing, and contract verification while maintaining strict human code review for performance edge cases.", bullet_style))

    # Build PDF
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF built successfully at: {filename}")

if __name__ == '__main__':
    output_path = "/Users/praffult45/Desktop/Work/crif-export/React_Native_Lead_Interview_Prep.pdf"
    build_pdf(output_path)
