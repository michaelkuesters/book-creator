from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
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
    get_book_row,
    has_override,
    import_book,
    list_books,
    list_editions,
    list_files,
    load_metadata,
    read_book_txt,
    read_text_file,
    resolve_inside,
    touch_book,
    write_binary_file,
    write_book_txt,
    write_metadata,
    write_text_file,
    zip_package,
)

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"

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


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"books": list_books()})


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
def book_page(request: Request, book_id: str, file: str | None = None):
    book = _book_or_404(book_id)
    root = book_root(book_id)
    files = list_files(root)
    chapters = [item for item in files if item["kind"] == "chapter"]
    selected = file
    if not selected:
        order = read_book_txt(root)
        selected = f"manuscript/{order[0]}" if order else "metadata.yaml"
    content = ""
    editable = True
    try:
        content = read_text_file(root, selected)
    except PackageError:
        editable = False
    return templates.TemplateResponse(
        request,
        "book.html",
        {
            "book": book,
            "meta": load_metadata(root),
            "files": files,
            "chapters": chapters,
            "order": read_book_txt(root),
            "selected": selected,
            "content": content,
            "editable": editable,
            "editions": list_editions(root),
            "jobs": list_jobs(book_id),
            "has_override": has_override(root),
        },
    )


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
    return RedirectResponse(f"/books/{book_id}?file=metadata.yaml", status_code=303)


@app.post("/books/{book_id}/files")
def save_file(
    book_id: str,
    path: str = Form(...),
    content: str = Form(""),
):
    _book_or_404(book_id)
    try:
        write_text_file(book_root(book_id), path, content)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}?file={path}", status_code=303)


@app.post("/books/{book_id}/files/new")
def add_file(
    book_id: str,
    name: str = Form(...),
):
    _book_or_404(book_id)
    filename = Path(name).name
    if not filename.endswith(".md"):
        filename += ".md"
    relative = f"manuscript/{filename}"
    try:
        write_text_file(
            book_root(book_id),
            relative,
            f"# {Path(filename).stem}\n\n",
            add_to_book=True,
        )
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}?file={relative}", status_code=303)


@app.post("/books/{book_id}/files/delete")
def remove_file(book_id: str, path: str = Form(...)):
    _book_or_404(book_id)
    try:
        delete_file(book_root(book_id), path)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}", status_code=303)


@app.post("/books/{book_id}/resources")
async def upload_resource(book_id: str, resource: UploadFile = File(...)):
    _book_or_404(book_id)
    name = Path(resource.filename or "resource.bin").name
    data = await resource.read()
    try:
        write_binary_file(book_root(book_id), f"manuscript/resources/{name}", data)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}", status_code=303)


@app.post("/books/{book_id}/order")
def save_order(book_id: str, order: str = Form(...)):
    _book_or_404(book_id)
    names = [line.strip() for line in order.splitlines() if line.strip()]
    try:
        write_book_txt(book_root(book_id), names)
        touch_book(book_id)
    except PackageError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"/books/{book_id}?file=manuscript/Book.txt", status_code=303)


@app.post("/books/{book_id}/build")
def build_book(book_id: str):
    _book_or_404(book_id)
    start_build(book_id)
    return RedirectResponse(f"/books/{book_id}", status_code=303)


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


def main() -> None:
    import uvicorn

    uvicorn.run("book_creator.app:app", host="0.0.0.0", port=8080, reload=False)


if __name__ == "__main__":
    main()
