from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from book_creator.config import ensure_data_dirs
from book_creator.db import init_db
from book_creator.jobs import get_job, list_jobs, start_build
from book_creator.packages import (
    PackageError,
    book_root,
    create_book,
    delete_book,
    delete_file,
    find_cover,
    friendly_when,
    get_book_row,
    has_override,
    import_book,
    list_assets,
    list_chapters,
    list_editions,
    list_files,
    list_library_books,
    load_metadata,
    read_book_txt,
    read_text_file,
    resolve_inside,
    chapter_filename,
    rename_chapter,
    touch_book,
    write_binary_file,
    write_book_txt,
    write_metadata,
    write_text_file,
    zip_package,
)

WEB = Path(__file__).resolve().parent / "web"

app = FastAPI(title="Book Creator")
templates = Jinja2Templates(directory=str(WEB / "templates"))
app.mount("/static", StaticFiles(directory=str(WEB / "static")), name="static")


@app.on_event("startup")
def startup() -> None:
    ensure_data_dirs()
    init_db()


def _book_or_404(book_id: str) -> dict:
    row = get_book_row(book_id)
    if not row:
        raise HTTPException(404, "Book not found")
    return row


def _wants_json(request: Request, flag: bool = False) -> bool:
    return flag or "application/json" in request.headers.get("accept", "")


def _studio_context(book_id: str, building: str | None = None) -> dict:
    book = _book_or_404(book_id)
    root = book_root(book_id)
    editions = list_editions(root)
    jobs = list_jobs(book_id)
    for job in jobs:
        job["when"] = friendly_when(job.get("created_at"))
    return {
        "book": book,
        "meta": load_metadata(root),
        "chapters": list_chapters(root),
        "editions": editions,
        "jobs": jobs,
        "has_override": has_override(root),
        "has_cover": find_cover(root) is not None,
        "assets": list_assets(root),
        "building": building,
    }


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"books": list_library_books()})


@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request):
    return templates.TemplateResponse(request, "settings.html", {})


@app.post("/books")
def new_book(title: str = Form("Untitled book")):
    book = create_book(title.strip() or "Untitled book")
    return RedirectResponse(f"/books/{book['id']}", status_code=303)


@app.post("/books/import")
async def import_zip(package: UploadFile = File(...)):
    data = await package.read()
    try:
        book = import_book(data)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book['id']}", status_code=303)


@app.get("/books/{book_id}", response_class=HTMLResponse)
def book_page(request: Request, book_id: str, file: str | None = None, building: str | None = None):
    ctx = _studio_context(book_id, building)
    root = book_root(book_id)
    chapters = ctx["chapters"]
    selected = file
    if not selected or selected in {"metadata.yaml", "manuscript/Book.txt"}:
        selected = chapters[0]["path"] if chapters else None
    content = ""
    editable = False
    selected_title = "No chapter yet"
    if selected:
        try:
            content = read_text_file(root, selected)
            editable = True
        except PackageError:
            editable = False
        selected_title = next((c["title"] for c in chapters if c["path"] == selected), Path(selected).name)
    ctx.update(
        {
            "files": list_files(root),
            "selected": selected,
            "selected_title": selected_title,
            "content": content,
            "editable": editable,
            "nav": "write",
        }
    )
    return templates.TemplateResponse(request, "book.html", ctx)


@app.get("/books/{book_id}/details", response_class=HTMLResponse)
def details_page(request: Request, book_id: str):
    ctx = _studio_context(book_id)
    root = book_root(book_id)
    ctx.update(
        {
            "order": read_book_txt(root),
            "nav": "details",
        }
    )
    return templates.TemplateResponse(request, "details.html", ctx)


@app.get("/books/{book_id}/assets", response_class=HTMLResponse)
def assets_page(request: Request, book_id: str):
    ctx = _studio_context(book_id)
    ctx["nav"] = "assets"
    return templates.TemplateResponse(request, "assets.html", ctx)


@app.post("/books/{book_id}/delete")
def remove_book(book_id: str):
    _book_or_404(book_id)
    delete_book(book_id)
    return RedirectResponse("/", status_code=303)


@app.post("/books/{book_id}/metadata")
def save_metadata(
    book_id: str,
    title: str = Form(...),
    subtitle: str = Form(""),
    author: str = Form(""),
    lang: str = Form("en-GB"),
    rights: str = Form(""),
    date: str = Form(""),
    description: str = Form(""),
):
    _book_or_404(book_id)
    root = book_root(book_id)
    meta = load_metadata(root)
    meta.update(
        {
            "title": title,
            "subtitle": subtitle,
            "author": author,
            "lang": lang,
            "rights": rights,
            "date": date,
            "description": description,
        }
    )
    write_metadata(root, meta)
    touch_book(book_id, title)
    return RedirectResponse(f"/books/{book_id}/details", status_code=303)


@app.post("/books/{book_id}/files")
def save_file(
    request: Request,
    book_id: str,
    path: str = Form(...),
    content: str = Form(""),
    autosave: bool = False,
):
    _book_or_404(book_id)
    try:
        write_text_file(book_root(book_id), path, content)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _wants_json(request, autosave):
        return JSONResponse({"ok": True, "path": path})
    return RedirectResponse(f"/books/{book_id}?file={path}", status_code=303)


@app.post("/books/{book_id}/files/new")
def add_file(
    book_id: str,
    name: str = Form(...),
):
    _book_or_404(book_id)
    title = " ".join(name.split()).strip() or "Chapter"
    filename = chapter_filename(title)
    relative = f"manuscript/{filename}"
    try:
        write_text_file(
            book_root(book_id),
            relative,
            f"# {title}\n\n",
            add_to_book=True,
        )
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}?file={relative}", status_code=303)


@app.post("/books/{book_id}/files/rename")
def rename_file(request: Request, book_id: str, path: str = Form(...), title: str = Form(...)):
    _book_or_404(book_id)
    try:
        result = rename_chapter(book_root(book_id), path, title)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _wants_json(request):
        return JSONResponse({"ok": True, **result})
    return RedirectResponse(f"/books/{book_id}?file={result['path']}", status_code=303)


@app.post("/books/{book_id}/files/delete")
def remove_file(request: Request, book_id: str, path: str = Form(...)):
    _book_or_404(book_id)
    try:
        delete_file(book_root(book_id), path)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _wants_json(request):
        return JSONResponse({"ok": True, "path": path})
    if path.startswith("manuscript/resources/"):
        return RedirectResponse(f"/books/{book_id}/assets", status_code=303)
    return RedirectResponse(f"/books/{book_id}", status_code=303)


@app.post("/books/{book_id}/resources")
async def upload_resource(
    request: Request,
    book_id: str,
    resource: UploadFile = File(...),
    json: bool = False,
):
    _book_or_404(book_id)
    name = Path(resource.filename or "resource.bin").name
    data = await resource.read()
    try:
        write_binary_file(book_root(book_id), f"manuscript/resources/{name}", data)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _wants_json(request, json):
        return JSONResponse(
            {
                "ok": True,
                "name": name,
                "markdown": f"resources/{name}",
                "url": f"/books/{book_id}/assets/{name}",
            }
        )
    referer = request.headers.get("referer", "")
    if "/assets" in referer:
        return RedirectResponse(f"/books/{book_id}/assets", status_code=303)
    return RedirectResponse(f"/books/{book_id}", status_code=303)


@app.post("/books/{book_id}/order")
def save_order(request: Request, book_id: str, order: str = Form(...)):
    _book_or_404(book_id)
    names = [line.strip() for line in order.splitlines() if line.strip()]
    try:
        write_book_txt(book_root(book_id), names)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _wants_json(request):
        return JSONResponse({"ok": True, "order": names})
    return RedirectResponse(f"/books/{book_id}/details", status_code=303)


@app.post("/books/{book_id}/build")
def build_book(request: Request, book_id: str, use_override: bool = Form(False)):
    _book_or_404(book_id)
    job = start_build(book_id, use_override=use_override)
    if _wants_json(request):
        return JSONResponse({"ok": True, "job_id": job["id"], "status": job["status"]})
    return RedirectResponse(f"/books/{book_id}?building={job['id']}", status_code=303)


@app.get("/books/{book_id}/jobs/{job_id}")
def job_status(book_id: str, job_id: str):
    _book_or_404(book_id)
    job = get_job(job_id)
    if not job or job["book_id"] != book_id:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/books/{book_id}/export.zip")
def export_zip(book_id: str, dist: bool = False):
    book = _book_or_404(book_id)
    payload = zip_package(book_root(book_id), include_dist=dist)
    filename = f"{book['slug']}.zip" if not dist else f"{book['slug']}-with-editions.zip"
    return Response(payload, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/books/{book_id}/editions/{name}")
def download_edition(book_id: str, name: str):
    _book_or_404(book_id)
    path = resolve_inside(book_root(book_id), f"dist/{name}")
    if not path.is_file():
        raise HTTPException(404, "Edition not found")
    return FileResponse(path, filename=name)


@app.get("/books/{book_id}/cover")
def book_cover(book_id: str):
    _book_or_404(book_id)
    path = find_cover(book_root(book_id))
    if path is None:
        raise HTTPException(404, "Cover not found")
    return FileResponse(path)


@app.get("/books/{book_id}/assets/{name}")
def serve_asset(book_id: str, name: str):
    _book_or_404(book_id)
    path = resolve_inside(book_root(book_id), f"manuscript/resources/{Path(name).name}")
    if not path.is_file():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path)


def main() -> None:
    import uvicorn

    uvicorn.run("book_creator.app:app", host="0.0.0.0", port=8080, reload=False)


if __name__ == "__main__":
    main()
