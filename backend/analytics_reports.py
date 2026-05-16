"""Report generation utilities for adaptive analytics snapshots and downloads."""
from __future__ import annotations

import io
from datetime import datetime, timezone
from html import escape
from uuid import uuid4

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from analytics_summary import filter_runs_for_period, run_time, summarize_runs


# ---------- Rwendo brand palette (kept in sync with frontend Tailwind theme) -
RWENDO_ACCENT = colors.HexColor("#f97316")
RWENDO_TEXT = colors.HexColor("#0f172a")
RWENDO_MUTED = colors.HexColor("#64748b")
RWENDO_SURFACE = colors.HexColor("#f8fafc")
RWENDO_BORDER = colors.HexColor("#e2e8f0")
RWENDO_TABLE_HEAD_BG = colors.HexColor("#0f172a")
RWENDO_TABLE_HEAD_TEXT = colors.HexColor("#ffffff")


def build_report(runs: list[dict], period_label: str = "7d") -> dict:
    filtered = filter_runs_for_period(runs, period_label=period_label)
    summary = summarize_runs(filtered)
    fallback = datetime.min.replace(tzinfo=timezone.utc)
    ordered = sorted(filtered, key=lambda run: run_time(run) or fallback)

    if ordered:
        period_start = (run_time(ordered[0]) or datetime.now().astimezone()).isoformat()
        period_end = (run_time(ordered[-1]) or datetime.now().astimezone()).isoformat()
    else:
        now = datetime.now().astimezone().isoformat()
        period_start = now
        period_end = now

    generated_at = datetime.now().astimezone().isoformat()
    averages = summary["averages"]
    return {
        "report_id": uuid4().hex[:10],
        "generated_at": generated_at,
        "period": {
            "label": period_label,
            "start": period_start,
            "end": period_end,
        },
        "network": {
            "runs_analyzed": len(filtered),
            "average_wait_time": averages["avg_wait_time"],
            "average_throughput": averages["throughput_per_min"],
            "average_queue_length": averages["avg_queue_length"],
            "average_spillback_frequency": averages["spillback_frequency"],
            "average_emergency_preemptions": averages["emergency_preemptions"],
            "average_green_wave_success_rate": averages["green_wave_success_rate"],
            "peak_traffic_times": summary["peak_traffic_hours"],
            "low_volume_periods": summary["low_volume_periods"],
        },
        "trends": summary["trend_rows"],
        "runs": summary["history_rows"],
    }


def build_report_html(report: dict) -> str:
    title = f"Rwendo Report {escape(report['report_id'])}"
    peak_times = ", ".join(report["network"].get("peak_traffic_times") or ["N/A"])
    low_volume_times = ", ".join(report["network"].get("low_volume_periods") or ["N/A"])
    trend_rows = "".join(
        (
            "<tr>"
            f"<td>{escape(row['label'])}</td>"
            f"<td>{row['avg_wait_time']:.1f}s</td>"
            f"<td>{row['throughput_per_min']:.1f} veh/min</td>"
            f"<td>{row['avg_queue_length']:.1f}</td>"
            f"<td>{row['spillback_events']:.1f}</td>"
            f"<td>{row['preemption_events']:.1f}</td>"
            f"<td>{row['green_wave_success_rate']:.1f}%</td>"
            "</tr>"
        )
        for row in report.get("trends", [])
    )
    run_rows = "".join(
        (
            "<tr>"
            f"<td>{escape(str(row.get('run_id') or 'N/A'))}</td>"
            f"<td>{escape(str(row.get('recorded_at') or 'N/A'))}</td>"
            f"<td>{escape(str(row.get('scenario') or 'off_peak'))}</td>"
            f"<td>{float(row.get('avg_wait_time') or 0.0):.1f}s</td>"
            f"<td>{float(row.get('throughput_per_min') or 0.0):.1f} veh/min</td>"
            f"<td>{float(row.get('avg_queue_length') or 0.0):.1f}</td>"
            f"<td>{float(row.get('spillback_events') or 0.0):.0f}</td>"
            f"<td>{float(row.get('preemption_events') or 0.0):.0f}</td>"
            f"<td>{float(row.get('green_wave_success_rate') or 0.0):.1f}%</td>"
            "</tr>"
        )
        for row in report.get("runs", [])
    )
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }}
    h1, h2 {{ margin-bottom: 8px; }}
    .cards {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }}
    .card {{ border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; background: #fff; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
    th, td {{ border-bottom: 1px solid #e2e8f0; padding: 10px; text-align: left; font-size: 14px; }}
    th {{ color: #475569; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <div>Generated: {escape(report['generated_at'])}</div>
  <div>Period: {escape(report['period']['start'])} to {escape(report['period']['end'])}</div>
  <div>Adaptive runs analyzed: {int(report['network'].get('runs_analyzed') or 0)}</div>
  <div class="cards">
    <div class="card"><strong>Average Wait Time</strong><br />{report['network']['average_wait_time']:.1f}s</div>
    <div class="card"><strong>Average Throughput</strong><br />{report['network']['average_throughput']:.1f} veh/min</div>
    <div class="card"><strong>Average Queue Length</strong><br />{report['network']['average_queue_length']:.1f}</div>
    <div class="card"><strong>Spillback Frequency</strong><br />{report['network']['average_spillback_frequency']:.1f}</div>
    <div class="card"><strong>Emergency Preemptions</strong><br />{report['network']['average_emergency_preemptions']:.1f}</div>
    <div class="card"><strong>Green Wave</strong><br />{report['network']['average_green_wave_success_rate']:.1f}%</div>
  </div>
  <div><strong>Peak traffic times:</strong> {escape(peak_times)}</div>
  <div><strong>Low volume periods:</strong> {escape(low_volume_times)}</div>
  <h2>Adaptive Trends</h2>
  <table>
    <thead><tr><th>Run</th><th>Wait</th><th>Throughput</th><th>Queue</th><th>Spillback</th><th>Preemptions</th><th>Green Wave</th></tr></thead>
    <tbody>{trend_rows}</tbody>
  </table>
  <h2>Stored Adaptive Runs</h2>
  <table>
    <thead><tr><th>Run ID</th><th>Recorded At</th><th>Scenario</th><th>Wait</th><th>Throughput</th><th>Queue</th><th>Spillback</th><th>Preemptions</th><th>Green Wave</th></tr></thead>
    <tbody>{run_rows}</tbody>
  </table>
</body>
</html>"""


# --------------------------------------------------------------------- PDF -----

def _pdf_styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "RwendoTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=RWENDO_TEXT,
            spaceAfter=4,
            alignment=TA_LEFT,
        ),
        "subtitle": ParagraphStyle(
            "RwendoSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=RWENDO_MUTED,
            alignment=TA_LEFT,
        ),
        "h2": ParagraphStyle(
            "RwendoH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=18,
            textColor=RWENDO_TEXT,
            spaceBefore=18,
            spaceAfter=8,
        ),
        "metric_label": ParagraphStyle(
            "MetricLabel",
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=RWENDO_MUTED,
            spaceAfter=4,
        ),
        "metric_value": ParagraphStyle(
            "MetricValue",
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=RWENDO_TEXT,
        ),
        "metric_detail": ParagraphStyle(
            "MetricDetail",
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=RWENDO_MUTED,
        ),
        "body": ParagraphStyle(
            "Body",
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=RWENDO_TEXT,
        ),
    }


def _metric_card(label: str, value: str, detail: str, styles: dict) -> Table:
    inner = [
        [Paragraph(label.upper(), styles["metric_label"])],
        [Paragraph(value, styles["metric_value"])],
        [Paragraph(detail, styles["metric_detail"])],
    ]
    card = Table(inner, colWidths=[2.05 * inch])
    card.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, RWENDO_BORDER),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("BACKGROUND", (0, 0), (-1, -1), RWENDO_SURFACE),
        ])
    )
    return card


def _styled_table(header: list[str], rows: list[list[str]], col_widths_inches: list[float]) -> Table:
    """Build a styled table. `col_widths_inches` is in INCHES — converted to
    reportlab's point unit here. Earlier this method took raw numbers which
    reportlab interpreted as points (≈ 1/72 inch each), collapsing the
    columns and visually overlapping the rows of the trends/runs tables."""
    data = [header] + rows
    table = Table(data, colWidths=[w * inch for w in col_widths_inches], hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), RWENDO_TABLE_HEAD_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), RWENDO_TABLE_HEAD_TEXT),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("TEXTCOLOR", (0, 1), (-1, -1), RWENDO_TEXT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, 0), 0.4, RWENDO_TABLE_HEAD_BG),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, RWENDO_SURFACE]),
            ("LINEBELOW", (0, 1), (-1, -1), 0.2, RWENDO_BORDER),
        ])
    )
    return table


def _header_footer(canvas, doc):
    canvas.saveState()
    # Header band
    canvas.setFillColor(RWENDO_ACCENT)
    canvas.rect(0, doc.pagesize[1] - 0.4 * inch, doc.pagesize[0], 0.4 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(0.6 * inch, doc.pagesize[1] - 0.27 * inch, "RWENDO")
    canvas.setFont("Helvetica", 9)
    canvas.drawRightString(
        doc.pagesize[0] - 0.6 * inch,
        doc.pagesize[1] - 0.27 * inch,
        "Adaptive Traffic Analytics Report",
    )
    # Footer
    canvas.setFillColor(RWENDO_MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(0.6 * inch, 0.45 * inch, f"Rwendo Report {doc.report_id}")
    canvas.drawRightString(doc.pagesize[0] - 0.6 * inch, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def _format_dt(value) -> str:
    if not value:
        return "N/A"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return str(value)


def build_report_pdf(report: dict) -> bytes:
    """Render the report dict to a styled PDF byte string."""
    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer,
        pagesize=LETTER,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title=f"Rwendo Report {report['report_id']}",
        author="Rwendo",
    )
    doc.report_id = report["report_id"]
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height - 0.4 * inch,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="content",
    )
    doc.addPageTemplates([PageTemplate(id="rwendo", frames=[frame], onPage=_header_footer)])

    styles = _pdf_styles()
    network = report.get("network", {})
    period = report.get("period", {})
    flow: list = []

    flow.append(Paragraph(f"Rwendo Report {report['report_id']}", styles["title"]))
    flow.append(Paragraph(
        f"Generated {_format_dt(report.get('generated_at'))} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Period {period.get('label', '')}: {_format_dt(period.get('start'))} – {_format_dt(period.get('end'))} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Adaptive runs analyzed: <b>{int(network.get('runs_analyzed') or 0)}</b>",
        styles["subtitle"],
    ))
    flow.append(Spacer(1, 0.25 * inch))

    # ----- metric cards in a 3-column grid -----
    cards = [
        _metric_card("Average Wait Time", f"{float(network.get('average_wait_time') or 0):.1f}s",
                     "Across adaptive runs", styles),
        _metric_card("Average Throughput", f"{float(network.get('average_throughput') or 0):.1f} veh/min",
                     "Network total", styles),
        _metric_card("Average Queue Length", f"{float(network.get('average_queue_length') or 0):.1f}",
                     "Across approaches", styles),
        _metric_card("Spillback Frequency", f"{float(network.get('average_spillback_frequency') or 0):.1f}",
                     "Events per run", styles),
        _metric_card("Emergency Preemptions", f"{float(network.get('average_emergency_preemptions') or 0):.1f}",
                     "Events per run", styles),
        _metric_card("Green Wave Success", f"{float(network.get('average_green_wave_success_rate') or 0):.1f}%",
                     "Rate across runs", styles),
    ]
    grid_data = [cards[i:i + 3] for i in range(0, len(cards), 3)]
    grid = Table(grid_data, colWidths=[2.3 * inch, 2.3 * inch, 2.3 * inch], hAlign="LEFT")
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    flow.append(grid)

    # ----- peak / low-volume periods -----
    peaks = ", ".join(network.get("peak_traffic_times") or ["N/A"])
    lows = ", ".join(network.get("low_volume_periods") or ["N/A"])
    flow.append(Spacer(1, 0.15 * inch))
    flow.append(Paragraph(f"<b>Peak traffic times:</b> {escape(peaks)}", styles["body"]))
    flow.append(Paragraph(f"<b>Low volume periods:</b> {escape(lows)}", styles["body"]))

    # ----- adaptive trends -----
    flow.append(Paragraph("Adaptive Trends", styles["h2"]))
    trend_header = ["Run", "Wait", "Throughput", "Queue", "Spillback", "Preemptions", "Green Wave"]
    trend_rows = [
        [
            str(row.get("label") or ""),
            f"{float(row.get('avg_wait_time') or 0):.1f}s",
            f"{float(row.get('throughput_per_min') or 0):.1f} veh/min",
            f"{float(row.get('avg_queue_length') or 0):.1f}",
            f"{float(row.get('spillback_events') or 0):.0f}",
            f"{float(row.get('preemption_events') or 0):.0f}",
            f"{float(row.get('green_wave_success_rate') or 0):.1f}%",
        ]
        for row in report.get("trends", [])
    ]
    if trend_rows:
        flow.append(_styled_table(trend_header, trend_rows, [0.75, 0.7, 1.15, 0.7, 0.9, 1.05, 0.95]))
    else:
        flow.append(Paragraph("No adaptive runs recorded for this period.", styles["body"]))

    # ----- stored runs -----
    flow.append(Paragraph("Stored Adaptive Runs", styles["h2"]))
    runs_header = ["Run ID", "Recorded", "Scenario", "Wait", "Throughput", "Queue", "Spillback", "Preempt.", "Green Wave"]
    runs_rows = [
        [
            str(row.get("run_id") or "N/A"),
            _format_dt(row.get("recorded_at")),
            str(row.get("scenario") or "off_peak"),
            f"{float(row.get('avg_wait_time') or 0):.1f}s",
            f"{float(row.get('throughput_per_min') or 0):.1f} veh/min",
            f"{float(row.get('avg_queue_length') or 0):.1f}",
            f"{float(row.get('spillback_events') or 0):.0f}",
            f"{float(row.get('preemption_events') or 0):.0f}",
            f"{float(row.get('green_wave_success_rate') or 0):.1f}%",
        ]
        for row in report.get("runs", [])
    ]
    if runs_rows:
        flow.append(_styled_table(runs_header, runs_rows, [0.7, 0.95, 0.7, 0.65, 1.05, 0.6, 0.75, 0.7, 0.85]))
    else:
        flow.append(Paragraph("No stored runs for this period.", styles["body"]))

    doc.build(flow)
    return buffer.getvalue()
