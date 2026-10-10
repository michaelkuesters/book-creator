"""Build reading PDF, EPUB and combined Markdown from a Leanpub-style package."""
from __future__ import annotations

from pathlib import Path
import hashlib
import html
import json
import re
import shutil
import subprocess
import textwrap

import yaml
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    Image as RLImage,
    Indenter,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

from book_creator.slug import slugify

PACKAGE_DIR = Path(__file__).resolve().parent
BUNDLED_FONTS = PACKAGE_DIR / "fonts"
BUNDLED_CSS = PACKAGE_DIR / "epub.css"
PANDOC_FROM = "markdown+lists_without_preceding_blankline-blank_before_blockquote"


def _pandoc_chapter_option() -> str:
    help_text = subprocess.check_output(["pandoc", "--help"], text=True)
    if "--split-level" in help_text:
        return "--split-level=1"
    return "--epub-chapter-level=1"


class BuildError(RuntimeError):
    pass


def edition_stem(meta: dict) -> str:
    return slugify(str(meta.get("title") or "book"))


def read_order(root: Path) -> list[str]:
    manuscript = root / "manuscript"
    book_txt = manuscript / "Book.txt"
    if not book_txt.is_file():
        raise BuildError("manuscript/Book.txt is required")
    order = [s.strip() for s in book_txt.read_text(encoding="utf-8").splitlines() if s.strip()]
    files = [manuscript / name for name in order]
    if not order:
        raise BuildError("Book.txt has no chapters")
    if len(set(order)) != len(order) or not all(p.is_file() for p in files):
        raise BuildError("Invalid chapter manifest")
    return order


def register_fonts(root: Path) -> None:
    if "BookSerif" in pdfmetrics.getRegisteredFontNames():
        return
    font_dirs = [root / "fonts", BUNDLED_FONTS]
    for name, filename in [
        ("BookSerif", "DejaVuSerif.ttf"),
        ("BookSerif-Bold", "DejaVuSerif-Bold.ttf"),
        ("BookSerif-Italic", "DejaVuSerif-Italic.ttf"),
        ("BookSerif-BoldItalic", "DejaVuSerif-BoldItalic.ttf"),
        ("BookSans", "DejaVuSans.ttf"),
        ("BookSans-Bold", "DejaVuSans-Bold.ttf"),
        ("BookMono", "DejaVuSansMono.ttf"),
    ]:
        font_path = None
        for directory in font_dirs:
            candidate = directory / filename
            if candidate.is_file():
                font_path = candidate
                break
        if font_path is None:
            fallback_name = "DejaVuSerif-Bold.ttf" if "BoldItalic" in filename else "DejaVuSerif.ttf"
            for directory in font_dirs:
                candidate = directory / fallback_name
                if candidate.is_file():
                    font_path = candidate
                    break
        if font_path is None:
            raise BuildError(f"Missing font {filename}")
        pdfmetrics.registerFont(TTFont(name, str(font_path)))
    pdfmetrics.registerFontFamily(
        "BookSerif",
        normal="BookSerif",
        bold="BookSerif-Bold",
        italic="BookSerif-Italic",
        boldItalic="BookSerif-BoldItalic",
    )
    pdfmetrics.registerFontFamily(
        "BookSans",
        normal="BookSans",
        bold="BookSans-Bold",
        italic="BookSans",
        boldItalic="BookSans-Bold",
    )


def _clear_dist(dist: Path) -> None:
    """Remove prior edition outputs so only the current build remains."""
    if not dist.is_dir():
        return
    for path in dist.iterdir():
        if path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)


def build_editions(root: Path) -> dict:
    root = root.resolve()
    manuscript = root / "manuscript"
    dist = root / "dist"
    dist.mkdir(exist_ok=True)
    _clear_dist(dist)
    meta_path = root / "metadata.yaml"
    if not meta_path.is_file():
        raise BuildError("metadata.yaml is required")
    meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
    order = read_order(root)
    files = [manuscript / name for name in order]
    stem = edition_stem(meta)

    combined = dist / f"{stem}.md"
    combined.write_text(
        "---\n"
        + meta_path.read_text(encoding="utf-8").strip()
        + "\n---\n\n"
        + "\n\n".join(p.read_text(encoding="utf-8").strip() for p in files)
        + "\n",
        encoding="utf-8",
    )
    try:
        document = json.loads(
            subprocess.check_output(
                [
                    "pandoc",
                    str(combined),
                    f"--from={PANDOC_FROM}",
                    "--to=json",
                    f"--resource-path={manuscript}",
                ],
                text=True,
            )
        )
    except FileNotFoundError as exc:
        raise BuildError("pandoc is not installed") from exc
    except subprocess.CalledProcessError as exc:
        raise BuildError(exc.stderr or str(exc)) from exc

    register_fonts(root)
    pdf_path = dist / f"{stem}.pdf"
    _write_pdf(root, meta, document, pdf_path)
    epub_path = dist / f"{stem}.epub"
    _write_epub(root, combined, manuscript, epub_path)

    report = {
        "title": meta.get("title"),
        "author": meta.get("author"),
        "chapter_files": order,
        "word_count": sum(len(re.findall(r"\b[\w'-]+\b", p.read_text(encoding="utf-8"))) for p in files),
        "pdf_pages": len(PdfReader(str(pdf_path)).pages),
        "files": {},
    }
    for path in [combined, pdf_path, epub_path]:
        report["files"][path.name] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    (dist / "build-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _write_epub(root: Path, combined: Path, manuscript: Path, epub_path: Path) -> None:
    css = root / "styles" / "epub.css"
    if not css.is_file():
        css = BUNDLED_CSS
    command = [
        "pandoc",
        str(combined),
        f"--from={PANDOC_FROM}",
        "--to=epub3",
        "--metadata-file=" + str(root / "metadata.yaml"),
        "--toc",
        "--toc-depth=1",
        _pandoc_chapter_option(),
        "--css=" + str(css),
        f"--resource-path={manuscript}",
        "--output=" + str(epub_path),
    ]
    cover = manuscript / "resources" / "cover.png"
    if cover.is_file():
        command.insert(-2, "--epub-cover-image=" + str(cover))
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise BuildError(exc.stderr or exc.stdout or str(exc)) from exc


def _write_pdf(root: Path, meta: dict, document: dict, pdf_path: Path) -> None:
    width, height = 405, 648
    left, right, top, bottom = 48, 48, 49, 48
    content_width = width - left - right
    ink = colors.HexColor("#182b32")
    accent = colors.HexColor("#126270")
    base = dict(
        fontName="BookSerif",
        fontSize=10.4,
        leading=14.6,
        textColor=ink,
        spaceAfter=7,
        allowWidows=0,
        allowOrphans=0,
    )
    styles = {
        "body": ParagraphStyle("Body", **base),
        "h1": ParagraphStyle(
            "Chapter",
            fontName="BookSans-Bold",
            fontSize=22,
            leading=27,
            textColor=ink,
            spaceBefore=22,
            spaceAfter=22,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "Section",
            fontName="BookSans-Bold",
            fontSize=12,
            leading=16,
            textColor=accent,
            spaceBefore=13,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Subsection",
            fontName="BookSans-Bold",
            fontSize=10.5,
            leading=14,
            spaceBefore=10,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "title": ParagraphStyle("Title", fontName="BookSans-Bold", fontSize=31, leading=37, textColor=ink, spaceAfter=28),
        "subtitle": ParagraphStyle("Subtitle", fontName="BookSans", fontSize=17, leading=23, textColor=accent, spaceAfter=32),
        "author": ParagraphStyle("Author", fontName="BookSans", fontSize=14, leading=19),
        "small": ParagraphStyle("Small", fontName="BookSerif", fontSize=9, leading=13, textColor=ink, spaceAfter=10),
        "code": ParagraphStyle(
            "Code",
            fontName="BookMono",
            fontSize=7.6,
            leading=10.5,
            backColor=colors.HexColor("#eef3f4"),
            borderPadding=8,
            leftIndent=8,
            rightIndent=8,
            spaceBefore=5,
            spaceAfter=12,
        ),
        "cell": ParagraphStyle("Cell", fontName="BookSerif", fontSize=8.1, leading=11, textColor=ink),
        "toc": ParagraphStyle(
            "ContentsEntry",
            fontName="BookSans",
            fontSize=9,
            leading=13,
            leftIndent=0,
            firstLineIndent=0,
            rightIndent=20,
            spaceBefore=4,
            textColor=ink,
        ),
    }

    manuscript_root = (root / "manuscript").resolve()

    def resolve_image_path(url: str) -> Path | None:
        if not url or "://" in url or url.startswith("data:"):
            return None
        rel = url.replace("\\", "/").lstrip("/")
        if rel.startswith("./"):
            rel = rel[2:]
        candidate = (manuscript_root / rel).resolve()
        try:
            candidate.relative_to(manuscript_root)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    def image_flowable(path: Path):
        img = RLImage(str(path))
        iw, ih = float(img.imageWidth), float(img.imageHeight)
        if iw <= 0 or ih <= 0:
            return None
        if iw > content_width:
            scale = content_width / iw
            img.drawWidth = content_width
            img.drawHeight = ih * scale
        img.hAlign = "CENTER"
        return img

    def inline(items):
        out = []
        for item in items:
            kind, value = item["t"], item.get("c")
            if kind == "Str":
                out.append(html.escape(value))
            elif kind in {"Space", "SoftBreak"}:
                out.append(" ")
            elif kind == "LineBreak":
                out.append("<br/>")
            elif kind in {"Emph", "Strong"}:
                tag = "i" if kind == "Emph" else "b"
                out.append(f"<{tag}>{inline(value)}</{tag}>")
            elif kind == "Code":
                out.append('<font name="BookMono" size="8.4">' + html.escape(value[1]) + "</font>")
            elif kind == "Link":
                target = html.escape(value[2][0], quote=True)
                out.append(f'<link href="{target}" color="#126270">{inline(value[1])}</link>')
            elif kind == "Quoted":
                out.append("&quot;" + inline(value[1]) + "&quot;")
            elif kind == "Span":
                out.append(inline(value[1]))
            elif kind == "Image":
                # Alt text only in contexts that cannot embed (headers, cells, plain()).
                out.append(inline(value[1]))
            elif kind == "Cite":
                # Pandoc Cite: [citations, display_inlines] — render display text only.
                out.append(inline(value[1]))
            elif kind == "RawInline":
                fmt, raw = value[0], value[1]
                if fmt == "html" and re.match(r"^<br\s*/?>$", str(raw).strip(), re.IGNORECASE):
                    out.append("<br/>")
                # Other raw HTML (or non-HTML raw) is omitted so residual markup does not fail the build.
            elif kind == "Note":
                raise BuildError("Footnote rendering not configured")
            else:
                raise BuildError(f"Unsupported inline: {kind}")
        return "".join(out)

    def plain(items):
        return re.sub("<[^>]+>", "", html.unescape(inline(items)))

    def has_image(items) -> bool:
        for item in items:
            kind, value = item["t"], item.get("c")
            if kind == "Image":
                return True
            if kind in {"Emph", "Strong", "Span", "Quoted", "Link"} and isinstance(value, list):
                nested = value[1] if kind in {"Quoted", "Link", "Span"} else value
                if isinstance(nested, list) and has_image(nested):
                    return True
        return False

    def para_flowables(items):
        """Render Para/Plain inlines, embedding Image as ReportLab flowables."""
        if not has_image(items):
            text = inline(items)
            if not text.strip():
                return []
            return [Paragraph(text, styles["body"])]

        result = []
        buf = []

        def flush_text():
            nonlocal buf
            if not buf:
                return
            text = inline(buf)
            buf = []
            if text.strip():
                result.append(Paragraph(text, styles["body"]))

        for item in items:
            if item["t"] == "Image":
                flush_text()
                path = resolve_image_path(item["c"][2][0])
                if path is None:
                    alt = inline(item["c"][1])
                    if alt.strip():
                        result.append(Paragraph(alt, styles["body"]))
                    continue
                drawn = image_flowable(path)
                if drawn is not None:
                    result.append(Spacer(1, 6))
                    result.append(drawn)
                    result.append(Spacer(1, 8))
            else:
                buf.append(item)
        flush_text()
        return result

    def cell_text(blocks):
        text = []
        for block in blocks:
            if block["t"] in {"Plain", "Para"}:
                text.append(inline(block["c"]))
            else:
                raise BuildError("Unsupported table cell")
        return "<br/>".join(text)

    def render_table(value):
        head = value[3][1]
        body_rows = []
        for body in value[4]:
            body_rows.extend(body[2])
            body_rows.extend(body[3])
        rows = head + body_rows + value[5][1]
        data = []
        for n, row in enumerate(rows):
            cells = []
            for cell in row[1]:
                text = cell_text(cell[4])
                if n < len(head):
                    text = "<b>" + text + "</b>"
                cells.append(Paragraph(text, styles["cell"]))
            data.append(cells)
        col_count = max(len(data[0]), 1)
        widths = [content_width / col_count] * col_count
        header_labels = [re.sub("<[^>]+>", "", cell_text(c[4])) for c in head[0][1]] if head else []
        if header_labels == ["Priority", "Artifact", "What it governs"]:
            widths = [content_width * fraction for fraction in (0.17, 0.35, 0.48)]
        elif header_labels == ["Step", "Responsibility", "Result"]:
            widths = [content_width * fraction for fraction in (0.23, 0.25, 0.52)]
        elif header_labels == ["File", "Responsibility"]:
            widths = [content_width * fraction for fraction in (0.42, 0.58)]
        table = Table(data, colWidths=widths, repeatRows=len(head), hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (-1, len(head) - 1), colors.HexColor("#e6eff1")),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#b8c9ce")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )
        rendered = [Spacer(1, 5), table, Spacer(1, 12)]
        return [KeepTogether(rendered)] if header_labels in [["Step", "Responsibility", "Result"], ["File", "Responsibility"]] else rendered

    counter = 0

    def flowables(blocks, headings=True):
        nonlocal counter
        result = []
        for block_index, block in enumerate(blocks):
            kind, value = block["t"], block.get("c")
            if kind == "Header":
                level, _attr, items = value
                if level == 1:
                    if len(result) >= 2 and all(
                        isinstance(p, Paragraph) and not hasattr(p, "_heading_level") for p in result[-2:]
                    ):
                        result[-2].keepWithNext = True
                    result.append(PageBreak())
                para = Paragraph(inline(items), styles.get(f"h{level}", styles["h3"]))
                if level > 1 and block_index + 1 < len(blocks):
                    following = blocks[block_index + 1]
                    if (
                        following["t"] in {"Para", "Plain"}
                        and block_index + 2 < len(blocks)
                        and blocks[block_index + 2]["t"] == "Table"
                    ):
                        table_value = blocks[block_index + 2]["c"]
                        head = table_value[3][1]
                        labels = [re.sub("<[^>]+>", "", cell_text(c[4])) for c in head[0][1]] if head else []
                        if labels in [["Step", "Responsibility", "Result"], ["File", "Responsibility"]]:
                            intro = Paragraph(inline(following["c"]), styles["body"])
                            table_height = sum(item.wrap(content_width, height)[1] for item in render_table(table_value)[0]._content)
                            result.append(
                                CondPageBreak(
                                    para.getSpaceBefore()
                                    + para.wrap(content_width, height)[1]
                                    + para.getSpaceAfter()
                                    + intro.wrap(content_width, height)[1]
                                    + intro.getSpaceAfter()
                                    + table_height
                                )
                            )
                    if following["t"] in {"BulletList", "OrderedList"}:
                        entries = following["c"] if following["t"] == "BulletList" else following["c"][1]
                        if entries and entries[0] and entries[0][0]["t"] in {"Plain", "Para"}:
                            first = Paragraph(inline(entries[0][0]["c"]), styles["body"])
                            first_height = first.wrap(content_width - 14, height)[1]
                            heading_height = para.wrap(content_width, height)[1]
                            result.append(
                                CondPageBreak(
                                    para.getSpaceBefore()
                                    + heading_height
                                    + para.getSpaceAfter()
                                    + first_height
                                    + first.getSpaceAfter()
                                )
                            )
                para._heading_level = level
                para._heading_title = plain(items)
                para._heading_key = f"heading-{counter}"
                counter += 1
                result.append(para)
            elif kind in {"Para", "Plain"}:
                rendered = para_flowables(value)
                if not rendered:
                    continue
                if (
                    len(rendered) == 1
                    and isinstance(rendered[0], Paragraph)
                    and block_index + 1 < len(blocks)
                    and blocks[block_index + 1]["t"] == "Table"
                ):
                    head = blocks[block_index + 1]["c"][3][1]
                    labels = [re.sub("<[^>]+>", "", cell_text(c[4])) for c in head[0][1]] if head else []
                    if labels in [["Step", "Responsibility", "Result"], ["File", "Responsibility"]]:
                        rendered[0].keepWithNext = True
                result.extend(rendered)
            elif kind == "RawBlock":
                # Residual raw HTML blocks are omitted (same policy as RawInline).
                continue
            elif kind == "CodeBlock":
                wrapped = []
                max_chars = int((content_width - 16) / pdfmetrics.stringWidth("M", "BookMono", 7.6))
                for line in value[1].splitlines():
                    if len(line) <= max_chars:
                        wrapped.append(line)
                    else:
                        indent = " " * (len(line) - len(line.lstrip()) + 2)
                        wrapped.extend(
                            textwrap.wrap(
                                line,
                                width=max_chars,
                                subsequent_indent=indent,
                                replace_whitespace=False,
                                drop_whitespace=False,
                                break_long_words=True,
                                break_on_hyphens=False,
                            )
                        )
                code = Preformatted("\n".join(wrapped), styles["code"])
                result.append(KeepTogether([code]) if len(wrapped) <= 20 else code)
            elif kind in {"BulletList", "OrderedList"}:
                entries = value if kind == "BulletList" else value[1]
                result.append(
                    ListFlowable(
                        [ListItem(flowables(entry, False)) for entry in entries],
                        bulletType="bullet" if kind == "BulletList" else "1",
                        start=None if kind == "BulletList" else value[0][0],
                        leftIndent=14,
                        bulletFontName="BookSans",
                        bulletFontSize=7,
                        spaceAfter=8,
                    )
                )
            elif kind == "Table":
                result.extend(render_table(value))
            elif kind == "BlockQuote":
                result.append(Indenter(left=12, right=12))
                result.extend(flowables(value, False))
                result.append(Indenter(left=-12, right=-12))
            elif kind == "HorizontalRule":
                result.append(Spacer(1, 10))
            elif kind == "Figure":
                # Pandoc 3: [attr, caption, blocks]; older shapes may nest blocks at [1].
                if isinstance(value, list) and len(value) >= 3 and isinstance(value[2], list):
                    result.extend(flowables(value[2], False))
                elif isinstance(value, list) and len(value) >= 2:
                    result.extend(flowables(value[1], False))
            else:
                raise BuildError(f"Unsupported block: {kind}")
        if headings and len(result) >= 2 and all(
            isinstance(p, Paragraph) and not hasattr(p, "_heading_level") for p in result[-2:]
        ):
            result[-2].keepWithNext = True
        return result

    class BookDoc(BaseDocTemplate):
        def beforeDocument(self):
            self.body_start = None
            self.chapter_pages = set()

        def afterFlowable(self, flowable):
            if not hasattr(flowable, "_heading_level"):
                return
            if flowable._heading_title == "Copyright":
                self.canv.bookmarkPage(flowable._heading_key)
                self.canv.addOutlineEntry("Copyright", flowable._heading_key, 0, closed=True)
                return
            level = flowable._heading_level
            title = flowable._heading_title
            key = flowable._heading_key
            if level == 1 and self.body_start is None:
                self.body_start = self.page
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, min(level - 1, 1), closed=True)
            if level == 1:
                self.chapter_pages.add(self.page)
                start = self.body_start or self.page
                self.notify("TOCEntry", (0, title, self.page - start + 1, key))

    def page_end(canv, doc):
        if doc.body_start is None:
            return
        canv.saveState()
        if doc.page not in doc.chapter_pages:
            canv.setFont("BookSans", 7.1)
            canv.setFillColor(colors.HexColor("#64777e"))
            canv.drawString(left, height - 29, str(meta.get("title") or ""))
        canv.setFont("BookSans", 8)
        canv.setFillColor(colors.HexColor("#64777e"))
        canv.drawCentredString(width / 2, 27, str(doc.page - doc.body_start + 1))
        canv.restoreState()

    dist = pdf_path.parent
    inner_path = dist / "_interior.pdf"
    doc = BookDoc(
        str(inner_path),
        pagesize=(width, height),
        leftMargin=left,
        rightMargin=right,
        topMargin=top,
        bottomMargin=bottom,
        title=str(meta.get("title") or ""),
        author=str(meta.get("author") or ""),
        subject=str(meta.get("subtitle") or ""),
        allowSplitting=True,
    )
    doc.addPageTemplates(
        PageTemplate(
            id="book",
            frames=Frame(
                left,
                bottom,
                content_width,
                height - top - bottom,
                leftPadding=0,
                rightPadding=0,
                topPadding=0,
                bottomPadding=0,
            ),
            onPageEnd=page_end,
        )
    )
    toc = TableOfContents()
    toc.levelStyles = [styles["toc"]]
    toc.dotsMinLevel = 0
    date_line = str(meta.get("date") or "")
    story = [
        Spacer(1, 82),
        Paragraph(html.escape(str(meta.get("title") or "Untitled")), styles["title"]),
        Paragraph(html.escape(str(meta.get("subtitle") or "")), styles["subtitle"]),
        Paragraph(html.escape(str(meta.get("author") or "")), styles["author"]),
        Spacer(1, 130),
        Paragraph(html.escape(date_line), styles["small"]),
    ]
    blocks = document["blocks"]
    copyright_first = (
        blocks
        and blocks[0]["t"] == "Header"
        and plain(blocks[0]["c"][2]) == "Copyright"
    )
    if copyright_first:
        next_chapter = next(
            i for i, block in enumerate(blocks[1:], 1) if block["t"] == "Header" and block["c"][0] == 1
        )
        story.extend(flowables(blocks[:next_chapter]))
        story.extend([PageBreak(), Paragraph("Contents", styles["h1"]), toc])
        story.extend(flowables(blocks[next_chapter:]))
    else:
        story.extend([PageBreak(), Paragraph("Contents", styles["h1"]), toc])
        story.extend(flowables(blocks))
    doc.multiBuild(story)

    writer = PdfWriter()
    cover_png = root / "manuscript" / "resources" / "cover.png"
    cover_path = dist / "_cover.pdf"
    if cover_png.is_file():
        cover = canvas.Canvas(str(cover_path), pagesize=(width, height))
        cover.setFillColor(colors.HexColor("#080e12"))
        cover.rect(0, 0, width, height, fill=1, stroke=0)
        cover.drawImage(
            str(cover_png),
            0,
            0,
            width=width,
            height=height,
            preserveAspectRatio=True,
            anchor="c",
        )
        cover.showPage()
        cover.save()
        writer.append(str(cover_path), import_outline=False)
    writer.append(str(inner_path), import_outline=True)
    writer.add_metadata(
        {
            "/Title": str(meta.get("title") or ""),
            "/Author": str(meta.get("author") or ""),
            "/Subject": str(meta.get("subtitle") or ""),
        }
    )
    writer.write(str(pdf_path))
    inner_path.unlink(missing_ok=True)
    cover_path.unlink(missing_ok=True)
