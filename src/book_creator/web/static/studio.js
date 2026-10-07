(function () {
  const IDLE_MS = 10000;
  const UNSAVED_META = "bcUnsaved";
  let editor = null;
  let dirty = false;
  let saving = false;
  let timer = null;
  let sessionNeedsCheckpoint = false;
  let markBaseline = function () {
    return false;
  };
  let refreshUnsavedDecorations = function () {};
  let ignoringBaselineTr = false;
  let editorReady = false;
  /** null | { id, content, label, mode: 'browsing'|'readonly', latestMarkdown } */
  let versionView = null;
  let promoteDialogOpen = false;

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
    var prev = dirty;
    dirty = next;
    if (dirty) sessionNeedsCheckpoint = true;
    if (!dirty) {
      markBaseline();
    } else if (!prev) {
      // Decorations read `dirty`; force a redraw after the flag flips.
      refreshUnsavedDecorations();
    }
  }

  function scheduleSave() {
    if (versionView && versionView.mode === "readonly") return;
    if (versionView && versionView.mode === "browsing") {
      offerVersionPromote();
      return;
    }
    setDirty(true);
    setSaveStatus("Unsaved changes — autosaves after 10s idle", "dirty");
    clearTimeout(timer);
    timer = setTimeout(saveNow, IDLE_MS);
  }

  function formatWhen(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (err) {
      return iso;
    }
  }

  function setEditorReadOnly(on) {
    var host = document.getElementById("wysiwyg-editor");
    if (host) host.classList.toggle("is-readonly", !!on);
    if (!editor) return;
    try {
      var ww = host && host.querySelector(".toastui-editor-ww-container .toastui-editor-contents");
      if (ww) ww.setAttribute("contenteditable", on ? "false" : "true");
      var md = host && host.querySelector(".toastui-editor-md-container .toastui-editor-md-source");
      if (md) {
        md.readOnly = !!on;
        md.setAttribute("contenteditable", on ? "false" : "true");
      }
      if (on) editor.blur();
    } catch (err) {
      /* editor chrome may not be ready */
    }
  }

  function updateVersionBanner() {
    var banner = document.getElementById("version-banner");
    var text = document.getElementById("version-banner-text");
    if (!banner || !text) return;
    if (!versionView) {
      banner.hidden = true;
      text.textContent = "";
      return;
    }
    banner.hidden = false;
    var when = versionView.label || "older version";
    if (versionView.mode === "readonly") {
      text.textContent = "Viewing " + when + " (read-only). Latest on disk is unchanged.";
    } else {
      text.textContent = "Viewing " + when + ". Latest on disk is unchanged until you Proceed.";
    }
  }

  function offerVersionPromote() {
    if (!versionView || versionView.mode !== "browsing" || promoteDialogOpen) return;
    var dialog = document.getElementById("version-promote-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return;
    promoteDialogOpen = true;
    dialog.showModal();
  }

  function applyHistoricMarkdown(markdown, ready) {
    if (!editor) return;
    ignoringBaselineTr = true;
    editorReady = false;
    editor.setMarkdown(toPreviewMarkdown(markdown));
    syncTextarea();
    window.setTimeout(function () {
      markBaseline();
      editorReady = !!ready;
      ignoringBaselineTr = false;
      refreshUnsavedDecorations();
    }, 0);
  }

  async function openHistoricVersion(rev, content) {
    if (!editor) return;
    if (dirty) {
      var saved = await saveNow();
      if (!saved && dirty) {
        setSaveStatus("Save current chapter before opening a version", "error");
        return;
      }
    }
    var latestMarkdown = currentMarkdown();
    versionView = {
      id: rev.id,
      content: content,
      label: formatWhen(rev.saved_at),
      mode: "browsing",
      latestMarkdown: latestMarkdown,
    };
    setEditorReadOnly(false);
    clearTimeout(timer);
    setDirty(false);
    sessionNeedsCheckpoint = false;
    applyHistoricMarkdown(content, true);
    updateVersionBanner();
    setSaveStatus("Viewing older version", "saved");
  }

  function returnToLatest() {
    if (!versionView) return;
    var latest = versionView.latestMarkdown;
    versionView = null;
    promoteDialogOpen = false;
    setEditorReadOnly(false);
    clearTimeout(timer);
    setDirty(false);
    sessionNeedsCheckpoint = false;
    applyHistoricMarkdown(latest, true);
    updateVersionBanner();
    setSaveStatus("Back to Latest", "saved");
  }

  async function proceedWithHistoricAsLatest() {
    if (!versionView) return;
    promoteDialogOpen = false;
    versionView = null;
    var dialog = document.getElementById("version-promote-dialog");
    if (dialog) dialog.close();
    setEditorReadOnly(false);
    updateVersionBanner();
    // Checkpoint on-disk Latest, then persist the editor (historic + any typed change).
    await checkpointVersionForced();
    setDirty(true);
    sessionNeedsCheckpoint = true;
    setSaveStatus("Unsaved changes — autosaves after 10s idle", "dirty");
    clearTimeout(timer);
    timer = setTimeout(saveNow, IDLE_MS);
  }

  function openHistoricReadOnly() {
    if (!versionView) return;
    promoteDialogOpen = false;
    versionView.mode = "readonly";
    var dialog = document.getElementById("version-promote-dialog");
    if (dialog) dialog.close();
    clearTimeout(timer);
    setDirty(false);
    sessionNeedsCheckpoint = false;
    applyHistoricMarkdown(versionView.content, true);
    setEditorReadOnly(true);
    updateVersionBanner();
    setSaveStatus("Read-only older version", "saved");
  }

  async function checkpointVersionForced() {
    const form = document.getElementById("editor-form");
    var path = chapterFormPath(form);
    if (!form || !path) return false;
    var body = new FormData();
    body.append("path", path);
    try {
      var response = await fetch("/books/" + bookId() + "/files/history/checkpoint", {
        method: "POST",
        body: body,
        headers: { Accept: "application/json" },
      });
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * Index WW doc text to match ProseMirror textBetween(..., "\\n", "\\n"),
   * with a parallel map from each character to a doc position.
   */
  function indexDocText(doc) {
    var blockSeparator = "\n";
    var leafText = "\n";
    var text = "";
    var posAt = [];
    var first = true;
    doc.nodesBetween(0, doc.content.size, function (node, pos) {
      var nodeText = "";
      if (node.isText) {
        nodeText = node.text;
      } else if (node.isLeaf) {
        nodeText = leafText;
      }
      if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock) && blockSeparator) {
        if (first) first = false;
        else {
          posAt.push(pos);
          text += blockSeparator;
        }
      }
      if (node.isText) {
        for (var i = 0; i < nodeText.length; i++) {
          posAt.push(pos + i);
          text += nodeText.charAt(i);
        }
      } else if (node.isLeaf && nodeText) {
        for (var j = 0; j < nodeText.length; j++) {
          posAt.push(pos);
          text += nodeText.charAt(j);
        }
      }
    });
    return { text: text, posAt: posAt };
  }

  /** Myers O(ND) char diff → [[op, text], ...] with op -1|0|1. */
  function diffChars(a, b) {
    if (a === b) return a ? [[0, a]] : [];
    if (!a) return [[1, b]];
    if (!b) return [[-1, a]];

    var n = a.length;
    var m = b.length;
    var max = n + m;
    var offset = max;
    var v = new Array(2 * max + 1);
    var trace = [];
    var d;
    var k;
    var x;
    var y;

    v[offset + 1] = 0;
    outer: for (d = 0; d <= max; d++) {
      trace.push(v.slice());
      for (k = -d; k <= d; k += 2) {
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1];
        } else {
          x = v[offset + k - 1] + 1;
        }
        y = x - k;
        while (x < n && y < m && a.charAt(x) === b.charAt(y)) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) break outer;
      }
    }

    var edits = [];
    x = n;
    y = m;
    for (; d > 0; d--) {
      var vPrev = trace[d];
      k = x - y;
      var prevK =
        k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1])
          ? k + 1
          : k - 1;
      var prevX = vPrev[offset + prevK];
      var prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        edits.push([0, a.charAt(--x)]);
        y--;
      }
      if (d > 0) {
        if (x > prevX) edits.push([-1, a.charAt(--x)]);
        else edits.push([1, b.charAt(--y)]);
      }
    }
    while (x > 0 && y > 0) {
      edits.push([0, a.charAt(--x)]);
      y--;
    }
    while (x > 0) edits.push([-1, a.charAt(--x)]);
    while (y > 0) edits.push([1, b.charAt(--y)]);
    edits.reverse();

    var merged = [];
    for (var i = 0; i < edits.length; i++) {
      var last = merged[merged.length - 1];
      if (last && last[0] === edits[i][0]) last[1] += edits[i][1];
      else merged.push([edits[i][0], edits[i][1]]);
    }
    return merged;
  }

  function gapPos(posAt, offset, doc) {
    if (!posAt.length) return 1;
    if (offset >= posAt.length) return posAt[posAt.length - 1] + 1;
    return posAt[offset];
  }

  function pushInlineRuns(out, Decoration, posAt, start, end) {
    var runFrom = null;
    var prev = null;
    for (var i = start; i < end; i++) {
      var p = posAt[i];
      if (p == null) continue;
      if (runFrom == null) {
        runFrom = p;
        prev = p;
      } else if (p !== prev + 1) {
        out.push(Decoration.inline(runFrom, prev + 1, { class: "bc-unsaved-add" }));
        runFrom = p;
        prev = p;
      } else {
        prev = p;
      }
    }
    if (runFrom != null) {
      out.push(Decoration.inline(runFrom, prev + 1, { class: "bc-unsaved-add" }));
    }
  }

  function decorationsForDiff(doc, baseline, Decoration, DecorationSet) {
    try {
      var indexed = indexDocText(doc);
      if (indexed.text === baseline) return DecorationSet.empty;
      var diffs = diffChars(baseline, indexed.text);
      var decos = [];
      var newOffset = 0;
      var delKey = 0;
      var maxPos = doc.content.size;
      for (var i = 0; i < diffs.length; i++) {
        var op = diffs[i][0];
        var chunk = diffs[i][1];
        if (op === 0) {
          newOffset += chunk.length;
        } else if (op === 1) {
          pushInlineRuns(decos, Decoration, indexed.posAt, newOffset, newOffset + chunk.length);
          newOffset += chunk.length;
        } else {
          (function (text, at) {
            var pos = Math.max(1, Math.min(at, maxPos));
            var key = "bc-del-" + delKey++;
            decos.push(
              Decoration.widget(
                pos,
                function () {
                  var span = document.createElement("span");
                  span.className = "bc-unsaved-del";
                  span.textContent = text;
                  span.setAttribute("contenteditable", "false");
                  return span;
                },
                { side: -1, key: key }
              )
            );
          })(chunk, gapPos(indexed.posAt, newOffset, doc));
        }
      }
      return DecorationSet.create(doc, decos);
    } catch (err) {
      return DecorationSet.empty;
    }
  }

  function unsavedDiffPlugin(context) {
    var Plugin = context.pmState.Plugin;
    var PluginKey = context.pmState.PluginKey;
    var Decoration = context.pmView.Decoration;
    var DecorationSet = context.pmView.DecorationSet;
    var key = new PluginKey("bcUnsavedDiff");
    var viewRef = null;

    function dispatchMeta(meta) {
      if (!viewRef) return false;
      var tr = viewRef.state.tr.setMeta(UNSAVED_META, meta);
      tr.setMeta("addToHistory", false);
      ignoringBaselineTr = true;
      try {
        viewRef.dispatch(tr);
      } finally {
        ignoringBaselineTr = false;
      }
      return true;
    }

    markBaseline = function () {
      if (!viewRef) return false;
      var text = indexDocText(viewRef.state.doc).text;
      return dispatchMeta({ baseline: text });
    };

    refreshUnsavedDecorations = function () {
      dispatchMeta({ refresh: true });
    };

    return {
      wysiwygPlugins: [
        function () {
          return new Plugin({
            key: key,
            state: {
              // null until settle finishes — init often runs on an empty doc
              // before Toast applies initialValue, which would mark everything new.
              init: function () {
                return { baseline: null, tick: 0 };
              },
              apply: function (tr, value) {
                var meta = tr.getMeta(UNSAVED_META);
                if (!meta) return value;
                var next = {
                  baseline: value.baseline,
                  tick: value.tick || 0,
                };
                if (typeof meta.baseline === "string") next.baseline = meta.baseline;
                if (meta.refresh) next.tick = next.tick + 1;
                return next;
              },
            },
            props: {
              decorations: function (state) {
                var pluginState = key.getState(state);
                // Delta is vs last save/load snapshot; never paint before an edit.
                if (!dirty || !pluginState || pluginState.baseline === null) {
                  return DecorationSet.empty;
                }
                return decorationsForDiff(
                  state.doc,
                  pluginState.baseline,
                  Decoration,
                  DecorationSet
                );
              },
            },
            view: function (editorView) {
              viewRef = editorView;
              return {
                destroy: function () {
                  if (viewRef === editorView) viewRef = null;
                },
              };
            },
          });
        },
      ],
    };
  }

  function autosaveUrl(form, checkpoint) {
    var url = form.action + (form.action.includes("?") ? "&" : "?") + "autosave=1";
    if (checkpoint) url += "&checkpoint=1";
    return url;
  }

  function chapterFormPath(form) {
    var input = form && form.querySelector('input[name="path"]');
    return input ? input.value : "";
  }

  async function saveNow(force, checkpoint) {
    const form = document.getElementById("editor-form");
    if (!form || (!dirty && !force) || saving) return false;
    saving = true;
    setSaveStatus("Saving…", "saving");
    syncTextarea();
    try {
      const body = new FormData(form);
      const response = await fetch(autosaveUrl(form, checkpoint), {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        var detail = "";
        try {
          var payload = await response.json();
          detail = payload && payload.detail ? String(payload.detail) : "";
        } catch (parseErr) {
          detail = "";
        }
        if (detail.indexOf("Refusing to replace chapter content") === 0) {
          setSaveStatus("Save blocked to protect chapter — reloading…", "error");
          window.location.reload();
          return false;
        }
        throw new Error("save failed");
      }
      if (checkpoint) sessionNeedsCheckpoint = false;
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

  async function checkpointVersion() {
    if (!sessionNeedsCheckpoint) return false;
    const form = document.getElementById("editor-form");
    var path = chapterFormPath(form);
    if (!form || !path) return false;
    var body = new FormData();
    body.append("path", path);
    try {
      var response = await fetch("/books/" + bookId() + "/files/history/checkpoint", {
        method: "POST",
        body: body,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("checkpoint failed");
      sessionNeedsCheckpoint = false;
      return true;
    } catch (err) {
      return false;
    }
  }

  function saveOnUnload() {
    const form = document.getElementById("editor-form");
    if (!form) return;
    // Historic view must never overwrite Latest on unload.
    if (versionView) return;
    clearTimeout(timer);
    if (dirty) {
      syncTextarea();
      const body = new FormData(form);
      try {
        fetch(autosaveUrl(form, true), {
          method: "POST",
          body,
          headers: { Accept: "application/json" },
          keepalive: true,
        });
      } catch (err) {
        /* best-effort on unload */
      }
      sessionNeedsCheckpoint = false;
      setDirty(false);
      return;
    }
    if (!sessionNeedsCheckpoint) return;
    var path = chapterFormPath(form);
    if (!path) return;
    var body = new FormData();
    body.append("path", path);
    try {
      fetch("/books/" + bookId() + "/files/history/checkpoint", {
        method: "POST",
        body: body,
        headers: { Accept: "application/json" },
        keepalive: true,
      });
    } catch (err) {
      /* best-effort on unload */
    }
    sessionNeedsCheckpoint = false;
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
      if (versionView) {
        event.preventDefault();
        window.location.assign(anchor.href);
        return;
      }
      if (!dirty && !sessionNeedsCheckpoint) return;
      event.preventDefault();
      const href = anchor.href;
      clearTimeout(timer);
      var leave = dirty
        ? saveNow(false, true)
        : checkpointVersion();
      Promise.resolve(leave).finally(function () {
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
    const theme =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    function savedSourceHasText() {
      return String(textarea.value || "").replace(/\s/g, "").length > 0;
    }

    function liveDocHasText() {
      if (!editor) return false;
      try {
        return String(editor.getMarkdown() || "").replace(/\s/g, "").length > 0;
      } catch (err) {
        return false;
      }
    }

    /**
     * Snapshot the WW doc only after Toast finishes applying initialValue and the
     * plain text stays stable. Until then, keep refreshing the baseline and do
     * not treat load churn as unsaved edits.
     */
    function settleUnsavedBaseline(attempt, lastText, stableCount) {
      if (editorReady) return;
      var n = attempt || 0;
      var prev = typeof lastText === "string" ? lastText : null;
      var stable = stableCount || 0;

      if (savedSourceHasText() && !liveDocHasText()) {
        window.setTimeout(function () {
          settleUnsavedBaseline(n + 1, prev, 0);
        }, 25);
        return;
      }
      if (!markBaseline()) {
        if (n < 60) {
          window.setTimeout(function () {
            settleUnsavedBaseline(n + 1, prev, 0);
          }, 25);
        }
        return;
      }

      var live = "";
      try {
        live = editor.getMarkdown() || "";
      } catch (err) {
        live = "";
      }
      if (live === prev) stable += 1;
      else {
        stable = 0;
        prev = live;
      }

      if (stable >= 3 || n >= 60) {
        markBaseline();
        editorReady = true;
        return;
      }
      window.setTimeout(function () {
        settleUnsavedBaseline(n + 1, prev, stable);
      }, 50);
    }

    editor = new toastui.Editor({
      el: host,
      height: "calc(100vh - 15rem)",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      hideModeSwitch: false,
      usageStatistics: false,
      theme: theme,
      initialValue: initial,
      plugins: [unsavedDiffPlugin],
      events: {
        load: function () {
          settleUnsavedBaseline(0, null, 0);
          setupMarkdownPaste(host);
        },
      },
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

    editor.on("load", function () {
      settleUnsavedBaseline(0, null, 0);
      setupMarkdownPaste(host);
    });
    settleUnsavedBaseline(0, null, 0);
    setupMarkdownPaste(host);

    window.addEventListener("bc:theme", function (event) {
      const next = event && event.detail && event.detail.theme === "dark" ? "dark" : "light";
      const root = host.querySelector(".toastui-editor-defaultUI");
      if (root) root.classList.toggle("toastui-editor-dark", next === "dark");
    });

    editor.on("change", function () {
      if (ignoringBaselineTr) return;
      if (!editorReady) {
        markBaseline();
        return;
      }
      scheduleSave();
    });

    form.addEventListener("submit", function () {
      syncTextarea();
      clearTimeout(timer);
      setDirty(false);
    });

    setupLeaveSave();
    setupChapterHistory();
  }

  function looksLikeMarkdown(text) {
    if (!text || !String(text).trim()) return false;
    return /(?:^|\n)\s{0,3}#{1,6}\s|(?:^|\n)\s*[-*+]\s|(?:^|\n)\s*\d+\.\s|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|```|\[.+\]\(.+\)|(?:^|\n)\s*>\s/m.test(
      text
    );
  }

  function insertMarkdownParsed(md) {
    if (!editor) return;
    if (versionView && versionView.mode === "readonly") return;
    var wasWW = editor.isWysiwygMode && editor.isWysiwygMode();
    if (wasWW) editor.changeMode("markdown", true);
    editor.replaceSelection(md);
    if (wasWW) editor.changeMode("wysiwyg", true);
    scheduleSave();
  }

  function setupMarkdownPaste(host) {
    if (!host || host.dataset.mdPaste === "1") return;
    var ww = host.querySelector(".toastui-editor-ww-container .toastui-editor-contents");
    if (!ww) return;
    host.dataset.mdPaste = "1";
    ww.addEventListener(
      "paste",
      function (event) {
        if (!editor || !(editor.isWysiwygMode && editor.isWysiwygMode())) return;
        var clip = event.clipboardData;
        if (!clip) return;
        var text = clip.getData("text/plain") || "";
        if (!looksLikeMarkdown(text)) return;
        var html = clip.getData("text/html") || "";
        if (/xmlns:o=|mso-|WordDocument/i.test(html)) return;
        event.preventDefault();
        event.stopPropagation();
        insertMarkdownParsed(text);
      },
      true
    );
  }

  function setupChapterHistory() {
    var openBtn = document.getElementById("chapter-history-btn");
    var dialog = document.getElementById("chapter-history-dialog");
    var list = document.getElementById("chapter-history-list");
    var empty = document.getElementById("chapter-history-empty");
    var squashBtn = document.getElementById("chapter-history-squash-btn");
    var squashDialog = document.getElementById("chapter-squash-dialog");
    var form = document.getElementById("editor-form");
    var promoteDialog = document.getElementById("version-promote-dialog");
    var proceedBtn = document.getElementById("version-proceed");
    var readonlyBtn = document.getElementById("version-open-readonly");
    var backBtn = document.getElementById("version-back-latest");
    var squashOptions = {
      same_days: false,
      same_week: false,
      all: false,
    };
    if (!openBtn || !dialog || !list || !form) return;

    function chapterPath() {
      var input = form.querySelector('input[name="path"]');
      return input ? input.value : "";
    }

    function applySquashOptions(opts) {
      squashOptions = {
        same_days: !!(opts && opts.same_days),
        same_week: !!(opts && opts.same_week),
        all: !!(opts && opts.all),
      };
      var any =
        squashOptions.same_days || squashOptions.same_week || squashOptions.all;
      if (squashBtn) squashBtn.hidden = !any;
      var dayBtn = document.getElementById("squash-same-days");
      var weekBtn = document.getElementById("squash-same-week");
      var allBtn = document.getElementById("squash-all");
      if (dayBtn) dayBtn.hidden = !squashOptions.same_days;
      if (weekBtn) weekBtn.hidden = !squashOptions.same_week;
      if (allBtn) allBtn.hidden = !squashOptions.all;
    }

    async function loadHistory() {
      list.innerHTML = "";
      empty.hidden = true;
      applySquashOptions(null);
      var path = chapterPath();
      if (!path) return;
      var response = await fetch(
        "/books/" + bookId() + "/files/history?path=" + encodeURIComponent(path),
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) throw new Error("history failed");
      var data = await response.json();
      var revisions = data.revisions || [];
      applySquashOptions(data.squash || {});
      if (!revisions.length) {
        empty.hidden = false;
        return;
      }
      revisions.forEach(function (rev) {
        var li = document.createElement("li");
        li.className = "history-item";
        var meta = document.createElement("div");
        meta.className = "history-meta";
        var words =
          typeof rev.word_count === "number" ? rev.word_count : 0;
        meta.innerHTML =
          "<strong>" +
          formatWhen(rev.saved_at) +
          "</strong><span class=\"muted\">" +
          words +
          (words === 1 ? " word" : " words") +
          "</span>";
        var open = document.createElement("button");
        open.type = "button";
        open.className = "button ghost";
        open.textContent = "Open";
        open.addEventListener("click", async function () {
          open.disabled = true;
          try {
            var res = await fetch(
              "/books/" +
                bookId() +
                "/files/history/revision?path=" +
                encodeURIComponent(path) +
                "&id=" +
                encodeURIComponent(rev.id),
              { headers: { Accept: "application/json" } }
            );
            if (!res.ok) throw new Error("revision failed");
            var payload = await res.json();
            if (typeof payload.content !== "string") throw new Error("revision failed");
            await openHistoricVersion(rev, payload.content);
            dialog.close();
          } catch (err) {
            setSaveStatus("Could not open version", "error");
            open.disabled = false;
          }
        });
        li.appendChild(meta);
        li.appendChild(open);
        list.appendChild(li);
      });
    }

    openBtn.addEventListener("click", async function () {
      try {
        await loadHistory();
        if (typeof dialog.showModal === "function") dialog.showModal();
      } catch (err) {
        setSaveStatus("Could not load history", "error");
      }
    });

    if (squashBtn && squashDialog) {
      squashBtn.addEventListener("click", function () {
        if (
          !squashOptions.same_days &&
          !squashOptions.same_week &&
          !squashOptions.all
        ) {
          return;
        }
        if (typeof squashDialog.showModal === "function") squashDialog.showModal();
      });
      squashDialog.querySelectorAll("[data-squash-mode]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var mode = btn.getAttribute("data-squash-mode");
          if (!mode || !squashOptions[mode]) return;
          btn.disabled = true;
          try {
            var body = new FormData();
            body.append("path", chapterPath());
            body.append("mode", mode);
            var response = await fetch(
              "/books/" + bookId() + "/files/history/squash",
              {
                method: "POST",
                body: body,
                headers: { Accept: "application/json" },
              }
            );
            if (!response.ok) throw new Error("squash failed");
            squashDialog.close();
            await loadHistory();
            setSaveStatus("Versions squashed", "saved");
          } catch (err) {
            setSaveStatus("Could not squash versions", "error");
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    if (proceedBtn) {
      proceedBtn.addEventListener("click", function () {
        proceedWithHistoricAsLatest();
      });
    }
    if (readonlyBtn) {
      readonlyBtn.addEventListener("click", function () {
        openHistoricReadOnly();
      });
    }
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        returnToLatest();
      });
    }
    if (promoteDialog) {
      promoteDialog.addEventListener("close", function () {
        if (!versionView || versionView.mode !== "browsing") {
          promoteDialogOpen = false;
          return;
        }
        if (!promoteDialogOpen) return;
        promoteDialogOpen = false;
        applyHistoricMarkdown(versionView.content, true);
        setDirty(false);
        sessionNeedsCheckpoint = false;
        setSaveStatus("Viewing older version", "saved");
      });
    }
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
      if (versionView && versionView.mode === "readonly") return;
      if (typeof dialog.showModal === "function") dialog.showModal();
    });

    dialog.querySelectorAll(".asset-pick").forEach(function (button) {
      button.addEventListener("click", function () {
        if (versionView && versionView.mode === "readonly") return;
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
