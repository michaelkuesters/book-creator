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

  function setDirty(next) {
    dirty = next;
    const host = document.getElementById("wysiwyg-editor");
    if (host) host.classList.toggle("is-dirty", dirty);
  }

  function scheduleSave() {
    setDirty(true);
    setSaveStatus("Unsaved changes — autosaves after 10s idle", "dirty");
    clearTimeout(timer);
    timer = setTimeout(saveNow, IDLE_MS);
  }

  function autosaveUrl(form) {
    return form.action + (form.action.includes("?") ? "&" : "?") + "autosave=1";
  }

  async function saveNow(force) {
    const form = document.getElementById("editor-form");
    if (!form || (!dirty && !force) || saving) return false;
    saving = true;
    setSaveStatus("Saving…", "saving");
    syncTextarea();
    try {
      const body = new FormData(form);
      const response = await fetch(autosaveUrl(form), {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("save failed");
      setDirty(false);
      setSaveStatus("Saved", "saved");
      return true;
    } catch (err) {
      setSaveStatus("Save failed", "error");
      return false;
    } finally {
      saving = false;
    }
  }

  function saveOnUnload() {
    const form = document.getElementById("editor-form");
    if (!form || !dirty) return;
    clearTimeout(timer);
    syncTextarea();
    const body = new FormData(form);
    try {
      fetch(autosaveUrl(form), {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
        keepalive: true,
      });
    } catch (err) {
      /* best-effort on unload */
    }
    setDirty(false);
  }

  function isEditorLeaveLink(anchor) {
    if (!anchor || !anchor.href) return false;
    if (anchor.target === "_blank") return false;
    if (anchor.hasAttribute("download")) return false;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.href === window.location.href) return false;
    return true;
  }

  function setupLeaveSave() {
    if (!document.getElementById("editor-form")) return;

    document.addEventListener("click", function (event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest && event.target.closest("a[href]");
      if (!isEditorLeaveLink(anchor)) return;
      if (!dirty) return;
      event.preventDefault();
      const href = anchor.href;
      clearTimeout(timer);
      saveNow().finally(function () {
        window.location.assign(href);
      });
    });

    window.addEventListener("pagehide", saveOnUnload);
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
      setDirty(false);
    });

    const saveBtn = document.getElementById("save-now-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        clearTimeout(timer);
        setDirty(true);
        saveNow();
      });
    }

    setupLeaveSave();
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

  function findChapterItem(path) {
    return document.querySelector('.chapter-item[data-path="' + path + '"]');
  }

  function applyHeadingToEditor(title) {
    if (!editor) return;
    const storage = currentMarkdown();
    const lines = storage.split("\n");
    if (lines.length && lines[0].trim().indexOf("#") === 0) {
      lines[0] = "# " + title;
    } else {
      lines.unshift("# " + title, "");
    }
    const next = lines.join("\n");
    editor.setMarkdown(toPreviewMarkdown(next));
    syncTextarea();
    setDirty(true);
  }

  function applyRenameResult(data, oldPath) {
    const item = findChapterItem(oldPath) || findChapterItem(data.path);
    if (item) {
      item.dataset.path = data.path;
      item.dataset.name = data.name;
      item.dataset.title = data.title;
      const link = item.querySelector(".chapter-link");
      if (link) {
        link.textContent = data.title;
        link.title = data.name;
        link.setAttribute("href", "/books/" + bookId() + "?file=" + encodeURIComponent(data.path));
      }
      item.querySelectorAll("[aria-label]").forEach(function (button) {
        const action = button.hasAttribute("data-chapter-rename") ? "Rename " : "Remove ";
        button.setAttribute("aria-label", action + data.title);
      });
    }

    const form = document.getElementById("editor-form");
    const pathInput = form ? form.querySelector('input[name="path"]') : null;
    const titleInput = document.getElementById("chapter-title-input");
    const isActive = pathInput && pathInput.value === oldPath;
    if (isActive) {
      pathInput.value = data.path;
      if (titleInput) {
        titleInput.value = data.title;
        titleInput.dataset.path = data.path;
        titleInput.dataset.title = data.title;
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, "", "/books/" + bookId() + "?file=" + encodeURIComponent(data.path));
      }
    } else if (titleInput && titleInput.dataset.path === data.path) {
      titleInput.value = data.title;
      titleInput.dataset.title = data.title;
    }
  }

  async function renameChapterByPath(path, title) {
    const cleaned = (title || "").trim();
    if (!cleaned) throw new Error("title required");
    const titleInput = document.getElementById("chapter-title-input");
    const form = document.getElementById("editor-form");
    const pathInput = form ? form.querySelector('input[name="path"]') : null;
    const isActive = pathInput && pathInput.value === path;
    if (isActive) {
      applyHeadingToEditor(cleaned);
      clearTimeout(timer);
      await saveNow(true);
    }
    const body = new FormData();
    body.append("path", path);
    body.append("title", cleaned);
    const response = await fetch("/books/" + bookId() + "/files/rename", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("rename failed");
    const data = await response.json();
    applyRenameResult(data, path);
    if (titleInput && isActive) setDirty(false);
    return data;
  }

  function openRenameDialog(path, title) {
    const dialog = document.getElementById("rename-chapter-dialog");
    const pathInput = document.getElementById("rename-chapter-path");
    const titleInput = document.getElementById("rename-chapter-title");
    if (!dialog || !pathInput || !titleInput) return;
    pathInput.value = path;
    titleInput.value = title || "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    titleInput.focus();
    titleInput.select();
  }

  function openRemoveDialog(path, title) {
    const dialog = document.getElementById("remove-chapter-dialog");
    const pathInput = document.getElementById("remove-chapter-path");
    const label = document.getElementById("remove-chapter-label");
    if (!dialog || !pathInput || !label) return;
    pathInput.value = path;
    label.textContent = title || "this chapter";
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  async function removeChapterByPath(path) {
    const body = new FormData();
    body.append("path", path);
    const response = await fetch("/books/" + bookId() + "/files/delete", {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("remove failed");
    const item = findChapterItem(path);
    const wasActive = item && item.querySelector(".chapter-link.active");
    if (item) item.remove();
    if (wasActive) {
      const next = document.querySelector(".chapter-item .chapter-link");
      window.location.href = next ? next.getAttribute("href") : "/books/" + bookId();
    }
  }

  function setupChapterTitleInput() {
    const input = document.getElementById("chapter-title-input");
    if (!input) return;
    let renaming = false;

    async function commit() {
      if (renaming) return;
      const title = input.value.trim();
      const previous = input.dataset.title || "";
      if (!title) {
        input.value = previous;
        return;
      }
      if (title === previous) return;
      renaming = true;
      try {
        await renameChapterByPath(input.dataset.path, title);
      } catch (err) {
        input.value = previous;
        setSaveStatus("Rename failed", "error");
      } finally {
        renaming = false;
      }
    }

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = input.dataset.title || "";
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
  }

  function setupChapterDialogs() {
    const renameForm = document.getElementById("rename-chapter-form");
    const removeForm = document.getElementById("remove-chapter-form");
    if (renameForm) {
      renameForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const path = document.getElementById("rename-chapter-path").value;
        const title = document.getElementById("rename-chapter-title").value;
        const dialog = document.getElementById("rename-chapter-dialog");
        try {
          await renameChapterByPath(path, title);
          if (dialog) dialog.close();
        } catch (err) {
          setSaveStatus("Rename failed", "error");
        }
      });
    }
    if (removeForm) {
      removeForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const path = document.getElementById("remove-chapter-path").value;
        const dialog = document.getElementById("remove-chapter-dialog");
        try {
          await removeChapterByPath(path);
          if (dialog) dialog.close();
        } catch (err) {
          setSaveStatus("Remove failed", "error");
        }
      });
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
          const titleInput = document.getElementById("chapter-title-input");
          if (titleInput && titleInput.dataset.path === item.dataset.path) {
            titleInput.focus();
            titleInput.select();
            return;
          }
          openRenameDialog(item.dataset.path, item.dataset.title);
        });
      }
      if (removeBtn) {
        removeBtn.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        removeBtn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          openRemoveDialog(item.dataset.path, item.dataset.title);
        });
      }
    });
  }

  setupDialogs();
  setupWysiwyg();
  setupAssetPicker();
  setupBuild();
  setupChapterDialogs();
  setupChapterTitleInput();
  setupChapterList();
})();
