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
            self.drawString(54, 750, "CRIF High Mark Consumer Submission — Data Correction & Audit Report (Member: 024FP04147)")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(54, 742, 558, 742)
        
        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(54, 42, 558, 42)
        
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 28, page_text)
        self.drawString(54, 28, "CONFIDENTIAL — FOR INTERNAL ACCOUNTING & OPERATIONS USE ONLY")
        self.restoreState()

def build_pdf(output_pdf_path):
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=45,
        bottomMargin=45
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    COLOR_PRIMARY = colors.HexColor("#0F172A")     # Dark Slate Navy
    COLOR_SECONDARY = colors.HexColor("#0284C7")   # Deep Cyan / Blue
    COLOR_RED = colors.HexColor("#DC2626")         # Critical Red
    COLOR_AMBER = colors.HexColor("#D97706")       # Warning Amber
    COLOR_GREEN = colors.HexColor("#16A34A")       # Success Green
    COLOR_TEXT = colors.HexColor("#334155")        # Body Slate
    COLOR_BG_LIGHT = colors.HexColor("#F8FAFC")    # Very light gray
    COLOR_BG_CARD = colors.HexColor("#F1F5F9")     # Card background
    COLOR_BORDER = colors.HexColor("#CBD5E1")
    COLOR_CODE_BG = colors.HexColor("#0F172A")

    # Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=20,
        textColor=COLOR_PRIMARY,
        spaceAfter=2
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13,
        textColor=COLOR_SECONDARY,
        spaceAfter=8
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=COLOR_PRIMARY,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=COLOR_PRIMARY,
        spaceBefore=6,
        spaceAfter=3,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=COLOR_TEXT,
        spaceAfter=4
    )

    body_bold = ParagraphStyle(
        'Body_Bold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    code_style = ParagraphStyle(
        'CodeStyle',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#E2E8F0")
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=9.5,
        textColor=colors.white
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7,
        leading=9,
        textColor=COLOR_TEXT
    )

    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=table_cell_style,
        fontName='Helvetica-Bold'
    )

    story = []

    # Title & Subtitle
    story.append(Paragraph("CRIF HIGH MARK CONSUMER SUBMISSION AUDIT REPORT", title_style))
    story.append(Paragraph("Technical Rejection Analysis ('Reason-CSV file in TUDF') & Accountant Action Items", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_SECONDARY, spaceBefore=0, spaceAfter=8))

    # Metadata Card Table
    meta_data = [
        [
            Paragraph("<b>Reporting Member ID:</b> 024FP04147", table_cell_style),
            Paragraph("<b>Member Short Name:</b> VINZOLCFL", table_cell_style),
            Paragraph("<b>Reporting Cycle Date:</b> 16-08-2026", table_cell_style)
        ],
        [
            Paragraph("<b>Source Master Sheet:</b> 024FP04147_16082026_17082026_145520.xlsx", table_cell_style),
            Paragraph("<b>Total Borrowers:</b> 17 Loans (Rows 11-27)", table_cell_style),
            Paragraph("<b>File Creation Date:</b> 20-08-2026", table_cell_style)
        ],
        [
            Paragraph("<b>Rejection Reason from Portal:</b> <font color='#DC2626'><b>Reason-CSV file in TUDF</b></font>", table_cell_style),
            Paragraph("<b>Submitted Files Audited:</b> .tXT & .tudf", table_cell_style),
            Paragraph("<b>Target Output Format:</b> Canonical TUDF (.tudf)", table_cell_style)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[205, 175, 160])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), COLOR_BG_CARD),
        ('BOX', (0, 0), (-1, -1), 1, COLOR_BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8))

    # Executive Summary
    story.append(Paragraph("1. Executive Summary & Why the Portal Rejected the File", h1_style))
    story.append(Paragraph(
        "CRIF High Mark rejected the submission with the error: <b>'Reason-CSV file in TUDF'</b>. "
        "The audit reveals that the uploaded <code>.tudf</code> file is byte-for-byte identical to the raw flat file. "
        "<b>Simply renaming a flat text file's extension to <code>.tudf</code> does not convert it into TUDF format.</b> "
        "The bureau gateway expects structured, self-describing TLV segment tags (<code>PN03N01</code>, <code>ID03I01</code>, <code>PA03A01</code>, <code>TL04T00</code>, <code>ES02**TRLR</code>). "
        "Furthermore, <b>two mandatory bureau fields were omitted in the Excel sheet</b>, preventing successful validation.",
        body_style
    ))

    # Action Items Table
    action_headers = ["#", "Issue Type", "Location / Column", "What Was Found", "Required Fix from Accountant", "Severity"]
    action_rows = [
        [
            Paragraph("1", table_cell_bold),
            Paragraph("Format Mismatch", table_cell_style),
            Paragraph("<b>Internal File Encoding</b>", table_cell_style),
            Paragraph("Raw flat text renamed to .tudf without segment tags", table_cell_style),
            Paragraph("Export using the engine's <b>Canonical TUDF format</b> (Coded-Field TLV with PN, ID, PA, TL tags).", table_cell_style),
            Paragraph("<font color='#DC2626'><b>BLOCKER</b></font>", table_cell_style)
        ],
        [
            Paragraph("2", table_cell_bold),
            Paragraph("Mandatory Field Missing", table_cell_style),
            Paragraph("<b>Col AZ (Col 52)</b><br/>Suit Filed / Wilful Default", table_cell_style),
            Paragraph("<font color='#DC2626'><b>BLANK</b></font> across all 17 rows in Excel", table_cell_style),
            Paragraph("Enter value <b>'00'</b> (No Suit Filed) for all rows 11 to 27.", table_cell_style),
            Paragraph("<font color='#DC2626'><b>CRITICAL</b></font>", table_cell_style)
        ],
        [
            Paragraph("3", table_cell_bold),
            Paragraph("Mandatory Field Missing", table_cell_style),
            Paragraph("<b>Col BG (Col 59)</b><br/>Rate of Interest", table_cell_style),
            Paragraph("<font color='#DC2626'><b>BLANK</b></font> across all 17 rows in Excel", table_cell_style),
            Paragraph("Enter sanctioned annual interest rate (e.g. <b>12, 18, 24</b>) in Col BG.", table_cell_style),
            Paragraph("<font color='#DC2626'><b>CRITICAL</b></font>", table_cell_style)
        ],
        [
            Paragraph("4", table_cell_bold),
            Paragraph("Filename Violation", table_cell_style),
            Paragraph("<b>File Name & Extension</b>", table_cell_style),
            Paragraph("Previous upload had ' (1)' and '.tXT'", table_cell_style),
            Paragraph("Save strictly as <b>024FP04147_16082026_20082026_145520.tudf</b> (no copy tags, lowercase extension).", table_cell_style),
            Paragraph("<font color='#DC2626'><b>BLOCKER</b></font>", table_cell_style)
        ],
        [
            Paragraph("5", table_cell_bold),
            Paragraph("Data Hygiene", table_cell_style),
            Paragraph("<b>Col A (Name) & Col X (Addr)</b>", table_cell_style),
            Paragraph("Trailing spaces in 5 names & 5 addresses", table_cell_style),
            Paragraph("Trim whitespace before/after names & address strings.", table_cell_style),
            Paragraph("<font color='#D97706'><b>WARNING</b></font>", table_cell_style)
        ]
    ]

    action_table = Table([[Paragraph(h, table_header_style) for h in action_headers]] + action_rows, colWidths=[16, 75, 95, 115, 185, 54])
    action_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLOR_PRIMARY),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, COLOR_BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(action_table)
    story.append(Spacer(1, 8))

    # Section 2: Technical Breakdown: Flat vs Canonical TUDF Format
    story.append(Paragraph("2. Technical Format Comparison: Why Bureau Gateway Rejects Flat Files", h1_style))
    story.append(Paragraph(
        "Credit bureaus require a specific internal encoding for the TUDF portal upload slot. Below is the structural difference between what was submitted and what is required:",
        body_style
    ))

    format_compare_data = [
        [
            Paragraph("<b>Rejected Submission (Flat / CSV-like Concatenation):</b>", ParagraphStyle('H', parent=table_cell_bold, textColor=COLOR_RED)),
            Paragraph("<b>Required Format (Canonical TUDF Coded-Field Stream):</b>", ParagraphStyle('H2', parent=table_cell_bold, textColor=COLOR_GREEN))
        ],
        [
            Paragraph("TUDF024FP04147    VINZOLCFL...<br/>DANTANI BHARATBHAI060819932BRWPD8211J...<br/><i>(Raw concatenated strings, no segment headers, no field tags. Bureau parser flags this as 'CSV file in TUDF'.)</i>", table_cell_style),
            Paragraph("TUDF12024FP04147...PN03N010118DANTANI BHARATBHAI07080608199308012ID03I010102010210BRWPD8211JPT03T01...PA03A01...TL04T00...ES02**TRLR<br/><i>(Tagged TLV segments with exact length prefixes and End-of-Subject trailer.)</i>", table_cell_style)
        ]
    ]
    format_table = Table(format_compare_data, colWidths=[270, 270])
    format_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor("#FEF2F2")),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor("#F0FDF4")),
        ('BOX', (0, 0), (-1, -1), 1, COLOR_BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(format_table)
    story.append(Spacer(1, 8))

    # Page Break for Row-by-Row Matrix
    story.append(PageBreak())

    # Section 3: Row-by-Row Data Correction Matrix
    story.append(Paragraph("3. Row-by-Row Excel Correction Matrix (All 17 Accounts)", h1_style))
    story.append(Paragraph(
        "The accountant must enter the missing values in <b>Column AZ</b> (Suit Filed) and <b>Column BG</b> (Rate of Interest) in the Master Sheet before regenerating:",
        body_style
    ))

    matrix_headers = ["Row", "Borrower Name", "Account Number", "Type / Own", "Col AZ (Suit)", "Col BG (ROI)", "Col BH (Tenure)", "Col BI (EMI)"]
    
    rows_data = [
        ("11", "DANTANI BHARATBHAI", "VCFL/2024-25/02", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "24", "-"),
        ("12", "BALDEVBHAI AMTHABHAI DESAI", "VCFL/2025-26/01", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "24", "-"),
        ("13", "PATEL CHIRAG HITENDRABHAI", "VCFL/2025-26/03", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "36", "36,152"),
        ("14", "CHARULBEN PATEL", "VCFL/2025-26/03", "51 / 3 (Gua)", "Fill '00'", "Enter ROI %", "36", "36,152"),
        ("15", "AMAN JAIN", "VCFL/2025-26/05", "05 / 1 (Ind)", "Fill '00'", "Enter ROI %", "36", "5,054"),
        ("16", "KAN SINGH", "VCFL/2025-26/08", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "84", "38,594"),
        ("17", "DURGESH SINGH RAJAWAT", "VCFL/2025-26/08", "51 / 3 (Gua)", "Fill '00'", "Enter ROI %", "84", "38,594"),
        ("18", "ARVIND KUMAR", "VCFL/2025-26/09", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "24", "24,962"),
        ("19", "JAIN DIMPLE ARVINDKUMAR", "VCFL/2025-26/09", "51 / 3 (Gua)", "Fill '00'", "Enter ROI %", "24", "24,962"),
        ("20", "RAVISHANKAR MAHESHPRASAD", "VCFL/2025-26/10", "05 / 1 (Ind)", "Fill '00'", "Enter ROI %", "36", "11,149"),
        ("21", "DIVYA SINGH", "VCFL/2025-26/10", "05 / 3 (Gua)", "Fill '00'", "Enter ROI %", "36", "11,149"),
        ("22", "SHYAMSINH RUPSINH RAJPUROHIT", "VCFL/2025-26/13", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "36", "70,314"),
        ("23", "ABHISHEK VERMA", "VCFL/2026-27/001", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "60", "26,494"),
        ("24", "REKHA VERMA", "VCFL/2026-27/001", "51 / 3 (Gua)", "Fill '00'", "Enter ROI %", "60", "26,494"),
        ("25", "ANSH SUJAL PATEL", "VCFL/2026-27/003", "51 / 1 (Ind)", "Fill '00'", "Enter ROI %", "12", "183,360"),
        ("26", "RIYA ANSH PATEL", "VCFL/2026-27/003", "51 / 3 (Gua)", "Fill '00'", "Enter ROI %", "12", "183,360"),
        ("27", "MOHIT JAIN", "VCFL/2026-27/004", "05 / 1 (Ind)", "Fill '00'", "Enter ROI %", "60", "65,227"),
    ]

    matrix_table_rows = []
    for r in rows_data:
        matrix_table_rows.append([
            Paragraph(r[0], table_cell_bold),
            Paragraph(r[1], table_cell_style),
            Paragraph(r[2], table_cell_style),
            Paragraph(r[3], table_cell_style),
            Paragraph(f"<font color='#DC2626'><b>{r[4]}</b></font>", table_cell_style),
            Paragraph(f"<font color='#DC2626'><b>{r[5]}</b></font>", table_cell_style),
            Paragraph(r[6], table_cell_style),
            Paragraph(r[7], table_cell_style),
        ])

    matrix_table = Table([[Paragraph(h, table_header_style) for h in matrix_headers]] + matrix_table_rows, colWidths=[20, 120, 95, 65, 60, 65, 55, 60])
    matrix_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLOR_PRIMARY),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, COLOR_BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(matrix_table)
    story.append(Spacer(1, 10))

    # Section 4: Step-by-Step Instructions for Accountant / Operations
    story.append(Paragraph("4. Step-by-Step Instructions for Accountant & Operations", h1_style))
    
    steps = [
        "<b>Step 1 — Open Master Sheet:</b> Open <code>024FP04147_16082026_17082026_145520.xlsx</code> in Microsoft Excel.",
        "<b>Step 2 — Populate Column AZ (Suit Filed):</b> Go to Column <code>AZ</code> (Column 52) and enter value <code>00</code> for all data rows 11 to 27.",
        "<b>Step 3 — Populate Column BG (Rate of Interest):</b> Go to Column <code>BG</code> (Column 59) and enter the annual interest rate (e.g. <code>12</code>, <code>18</code>, <code>24</code>) as per loan agreements for all rows 11 to 27.",
        "<b>Step 4 — Clean Whitespace:</b> Trim trailing spaces in Column A (Names) for rows 11, 12, 18, 25, 26 and Column X (Addresses) for rows 15, 16, 17, 19, 27.",
        "<b>Step 5 — Export as Canonical TUDF:</b> Generate the output file using the <b>TUDF format profile</b> (<code>consumer-ucrf12</code>) so that all <code>PN</code>, <code>ID</code>, <code>PT</code>, <code>PA</code>, <code>TL</code> tags are generated.",
        "<b>Step 6 — Verify & Upload:</b> Confirm the filename is strictly <code>024FP04147_16082026_20082026_145520.tudf</code> and upload to the CRIF High Mark portal."
    ]

    for s in steps:
        story.append(Paragraph(f"&bull; {s}", body_style))

    story.append(Spacer(1, 8))
    
    # Sign-off box
    signoff_data = [
        [
            Paragraph("<b>Audit Status:</b> <font color='#DC2626'>REJECTED — PENDING EXCEL CORRECTIONS</font>", table_cell_style),
            Paragraph("<b>Target Resolution Time:</b> &lt; 15 mins", table_cell_style),
            Paragraph("<b>Prepared By:</b> CRIF Compliance & Export Audit Engine", table_cell_style)
        ]
    ]
    signoff_table = Table(signoff_data, colWidths=[200, 150, 190])
    signoff_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), COLOR_BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 1, COLOR_BORDER),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(signoff_table)

    # Build document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated at: {output_pdf_path}")

if __name__ == '__main__':
    target_path = sys.argv[1] if len(sys.argv) > 1 else 'CRIF_Consumer_Data_Correction_Report_024FP04147.pdf'
    build_pdf(target_path)
