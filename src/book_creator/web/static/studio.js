(function () {
  const IDLE_MS = 10000;
  let editor = null;
  let dirty = false;
  let saving = false;
  let timer = null;

  function setSaveStatus(text, state) {
    const el = document.getElementById("save-status");
    if (!el) return;
    el.textContent = text;
    el.className = "save-status" + (state ? " is-" + state : "");
  }

  function studioRoot() {
    return document.querySelector(".studio-write");
  }

  function bookId() {
    const root = studioRoot();
    return root ? root.dataset.bookId : "";
  }

  function assetBase() {
    const root = studioRoot();
    return root ? root.dataset.assetBase : "";
  }

  function toPreviewMarkdown(markdown) {
    const base = assetBase();
    if (!base) return markdown;
    return markdown.replace(/\]\((?:\.\/)?resources\/([^)\s]+)\)/g, "](" + base + "$1)");
  }

  function toStorageMarkdown(markdown) {
    const base = assetBase();
    if (!base) return markdown;
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return markdown.replace(new RegExp("\\]\\(" + escaped + "([^)\\s]+)\\)", "g"), "](resources/$1)");
  }

  function currentMarkdown() {
    const textarea = document.getElementById("editor-content");
    if (editor) return toStorageMarkdown(editor.getMarkdown());
    return textarea ? textarea.value : "";
  }

  function syncTextarea() {
    const textarea = document.getElementById("editor-content");
    if (textarea) textarea.value = currentMarkdown();
  }

  function scheduleSave() {
    dirty = true;
    setSaveStatus("Unsaved changes — autosaves after 10s idle", "dirty");
    clearTimeout(timer);
    timer = setTimeout(saveNow, IDLE_MS);
  }

  async function saveNow() {
    const form = document.getElementById("editor-form");
    if (!form || !dirty || saving) return;
    saving = true;
    setSaveStatus("Saving…", "saving");
    syncTextarea();
    try {
      const body = new FormData(form);
      const response = await fetch(form.action + (form.action.includes("?") ? "&" : "?") + "autosave=1", {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("save failed");
      dirty = false;
      setSaveStatus("Saved", "saved");
    } catch (err) {
      setSaveStatus("Save failed", "error");
    } finally {
      saving = false;
    }
  }

  function setupWysiwyg() {
    const host = document.getElementById("wysiwyg-editor");
    const textarea = document.getElementById("editor-content");
    const form = document.getElementById("editor-form");
    if (!host || !textarea || !window.toastui || !window.toastui.Editor) return;

    const initial = toPreviewMarkdown(textarea.value || "");
    editor = new toastui.Editor({
      el: host,
      height: "calc(100vh - 15rem)",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      hideModeSwitch: true,
      usageStatistics: false,
      initialValue: initial,
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol", "task"],
        ["table", "image", "link"],
        ["code", "codeblock"],
      ],
      hooks: {
        addImageBlobHook: async function (blob, callback) {
          try {
            const uploaded = await uploadAsset(blob, blob.name || "illustration.png");
            callback(uploaded.url, uploaded.name);
            scheduleSave();
          } catch (err) {
            setSaveStatus("Image upload failed", "error");
          }
        },
      },
    });

    editor.on("change", scheduleSave);

    form.addEventListener("submit", function () {
      syncTextarea();
      clearTimeout(timer);
      dirty = false;
    });

    const saveBtn = document.getElementById("save-now-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        clearTimeout(timer);
        dirty = true;
        saveNow();
      });
    }

    window.addEventListener("beforeunload", function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function uploadAsset(file, filename) {
    const id = bookId();
    const body = new FormData();
    body.append("resource", file, filename);
    const response = await fetch("/books/" + id + "/resources?json=1", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("upload failed");
    return response.json();
  }

  function insertIllustration(markdownPath, previewUrl, name) {
    if (!editor) return;
    const alt = (name || "illustration").replace(/\.[^.]+$/, "");
    if (editor.isWysiwygMode && editor.isWysiwygMode()) {
      editor.exec("addImage", { imageUrl: previewUrl, altText: alt });
    } else {
      editor.replaceSelection("\n\n![" + alt + "](" + previewUrl + ")\n\n");
    }
    scheduleSave();
  }

  function setupAssetPicker() {
    const openBtn = document.getElementById("insert-asset-btn");
    const dialog = document.getElementById("asset-picker");
    const uploadForm = document.getElementById("inline-upload-form");
    const uploadInput = document.getElementById("inline-upload-input");
    const grid = document.getElementById("asset-picker-grid");
    if (!openBtn || !dialog) return;

    openBtn.addEventListener("click", function () {
      if (typeof dialog.showModal === "function") dialog.showModal();
    });

    dialog.querySelectorAll(".asset-pick").forEach(function (button) {
      button.addEventListener("click", function () {
        insertIllustration(button.dataset.markdown, button.dataset.url, button.dataset.name);
        dialog.close();
      });
    });

    if (uploadForm && uploadInput) {
      uploadForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const file = uploadInput.files && uploadInput.files[0];
        if (!file) return;
        try {
          const uploaded = await uploadAsset(file, file.name);
          insertIllustration(uploaded.markdown, uploaded.url, uploaded.name);
          if (grid) {
            const hint = document.getElementById("no-assets-hint");
            if (hint) hint.remove();
            const button = document.createElement("button");
            button.type = "button";
            button.className = "asset-pick";
            button.dataset.markdown = uploaded.markdown;
            button.dataset.url = uploaded.url;
            button.dataset.name = uploaded.name;
            button.innerHTML = '<img src="' + uploaded.url + '" alt="' + uploaded.name + '"><span>' + uploaded.name + "</span>";
            button.addEventListener("click", function () {
              insertIllustration(uploaded.markdown, uploaded.url, uploaded.name);
              dialog.close();
            });
            grid.prepend(button);
          }
          dialog.close();
          uploadForm.reset();
        } catch (err) {
          setSaveStatus("Image upload failed", "error");
        }
      });
    }
  }

  function setupDialogs() {
    document.querySelectorAll("[data-open-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        const dialog = document.getElementById(button.getAttribute("data-open-dialog"));
        if (dialog && typeof dialog.showModal === "function") dialog.showModal();
      });
    });
    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        const dialog = button.closest("dialog");
        if (dialog) dialog.close();
      });
    });
    document.querySelectorAll("dialog[data-autopen]").forEach(function (dialog) {
      if (typeof dialog.showModal === "function") dialog.showModal();
    });
  }

  async function pollBuild(bookIdValue, jobId) {
    const status = document.getElementById("build-status");
    if (!status) return;
    status.textContent = "Building PDF and EPUB…";
    status.className = "build-status muted is-running";

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch("/books/" + bookIdValue + "/jobs/" + jobId);
        if (!response.ok) throw new Error("status failed");
        const job = await response.json();
        if (job.status === "succeeded" || job.status === "failed") {
          window.location.reload();
          return;
        }
        status.textContent = "Building… (" + job.status + ")";
      } catch (err) {
        status.textContent = "Could not read build status.";
        status.className = "build-status muted is-fail";
        return;
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, 1000);
      });
    }
    status.textContent = "Build is still running. Refresh later.";
  }

  function setupBuild() {
    const form = document.getElementById("build-form");
    const status = document.getElementById("build-status");
    if (status && status.dataset.building && status.dataset.book) {
      pollBuild(status.dataset.book, status.dataset.building);
    }
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const body = new FormData(form);
      try {
        const response = await fetch(form.action, {
          method: "POST",
          body,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("build failed");
        const data = await response.json();
        if (status) {
          status.dataset.building = data.job_id;
          status.dataset.book = bookId() || (status.dataset.book || "");
        }
        pollBuild(status.dataset.book, data.job_id);
      } catch (err) {
        if (status) {
          status.textContent = "Could not start build.";
          status.className = "build-status muted is-fail";
        }
      }
    });
  }

  function chapterOrderPayload(list) {
    return Array.prototype.map
      .call(list.querySelectorAll(".chapter-item"), function (item) {
        return item.dataset.name;
      })
      .join("\n");
  }

  async function persistChapterOrder(list) {
    const id = bookId();
    if (!id) return;
    const body = new FormData();
    body.append("order", chapterOrderPayload(list));
    const response = await fetch("/books/" + id + "/order", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("reorder failed");
  }

  async function renameChapter(item) {
    const current = item.dataset.title || "";
    const next = window.prompt("Rename chapter", current);
    if (next === null) return;
    const title = next.trim();
    if (!title || title === current) return;
    const id = bookId();
    const body = new FormData();
    body.append("path", item.dataset.path);
    body.append("title", title);
    const response = await fetch("/books/" + id + "/files/rename", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("rename failed");
    const data = await response.json();
    item.dataset.title = data.title;
    const link = item.querySelector(".chapter-link");
    if (link) {
      link.textContent = data.title;
      link.title = item.dataset.name;
    }
    item.querySelectorAll("[aria-label]").forEach(function (button) {
      const action = button.hasAttribute("data-chapter-rename") ? "Rename " : "Remove ";
      button.setAttribute("aria-label", action + data.title);
      button.title = action.trim();
    });
    if (link && link.classList.contains("active")) {
      const heading = document.querySelector(".editor-header h2");
      if (heading) heading.textContent = data.title;
    }
  }

  async function removeChapter(item) {
    const title = item.dataset.title || item.dataset.name || "this chapter";
    if (!window.confirm('Remove "' + title + '" from the book?')) return;
    const id = bookId();
    const path = item.dataset.path;
    const body = new FormData();
    body.append("path", path);
    const response = await fetch("/books/" + id + "/files/delete", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("remove failed");
    const wasActive = item.querySelector(".chapter-link.active");
    item.remove();
    if (wasActive) {
      const next = document.querySelector(".chapter-item .chapter-link");
      window.location.href = next ? next.getAttribute("href") : "/books/" + id;
    }
  }

  function setupChapterList() {
    const list = document.getElementById("chapter-list");
    if (!list) return;
    let dragItem = null;
    let startOrder = "";

    list.querySelectorAll(".chapter-item").forEach(function (item) {
      item.addEventListener("dragstart", function (event) {
        if (event.target.closest && event.target.closest(".chapter-action")) {
          event.preventDefault();
          return;
        }
        dragItem = item;
        startOrder = chapterOrderPayload(list);
        item.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.dataset.path || "");
        }
      });
      item.addEventListener("dragend", async function () {
        item.classList.remove("is-dragging");
        list.querySelectorAll(".is-drop-target").forEach(function (el) {
          el.classList.remove("is-drop-target");
        });
        const moved = dragItem;
        dragItem = null;
        if (!moved) return;
        if (chapterOrderPayload(list) === startOrder) return;
        try {
          await persistChapterOrder(list);
        } catch (err) {
          window.location.reload();
        }
      });
      item.addEventListener("dragover", function (event) {
        event.preventDefault();
        if (!dragItem || dragItem === item) return;
        const rect = item.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        list.querySelectorAll(".is-drop-target").forEach(function (el) {
          el.classList.remove("is-drop-target");
        });
        item.classList.add("is-drop-target");
        if (before) list.insertBefore(dragItem, item);
        else list.insertBefore(dragItem, item.nextSibling);
      });
      item.addEventListener("drop", function (event) {
        event.preventDefault();
        item.classList.remove("is-drop-target");
      });

      const renameBtn = item.querySelector("[data-chapter-rename]");
      const removeBtn = item.querySelector("[data-chapter-remove]");
      if (renameBtn) {
        renameBtn.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        renameBtn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          renameChapter(item).catch(function () {
            window.alert("Could not rename chapter.");
          });
        });
      }
      if (removeBtn) {
        removeBtn.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        removeBtn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          removeChapter(item).catch(function () {
            window.alert("Could not remove chapter.");
          });
        });
      }
    });
  }

  setupDialogs();
  setupWysiwyg();
  setupAssetPicker();
  setupBuild();
  setupChapterList();
})();
