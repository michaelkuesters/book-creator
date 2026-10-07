(function () {
  const IDLE_MS = 10000;
  /** Autosave when the unsaved diff reaches this many segments (consolidate baseline). */
  const UNSAVED_SEGMENT_LIMIT = 50;
  /** Skip fine matching when mid-region product exceeds this (treat as one replace). */
  const DIFF_SCAN_BUDGET = 400000;
  /** Ignore tiny anchors (e.g. a lone "r") that scramble word/space boundaries. */
  const DIFF_MIN_MATCH = 3;
  const UNSAVED_META = "bcUnsaved";
  let editor = null;
  let dirty = false;
  let saving = false;
  let timer = null;
  let consolidateQueued = false;
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
  let wwViewRef = null;
  let TextSelectionClass = null;
  /** @type {null | { from: number, to: number, md: string }} */
  let pendingMarkdownReplace = null;

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
    var when = formatWhen(rev.saved_at);
    var tagLabel = typeof rev.label === "string" ? rev.label.trim() : "";
    versionView = {
      id: rev.id,
      content: content,
      label: tagLabel ? tagLabel + " · " + when : when,
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

  function isDiffJunkChar(ch) {
    // Only whitespace is a non-starter. Popular-letter autojunk on character
    // diffs leaves equal spaces unmatched (delete+insert of the same " "),
    // which collapses word gaps in the editor under decoration widgets.
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  }

  /**
   * Longest contiguous equal substring in a[aLo:aHi] × b[bLo:bHi].
   * Whitespace cannot start a match (extends through it once anchored).
   */
  function findLongestMatch(a, aLo, aHi, b, bLo, bHi) {
    var aLen = aHi - aLo;
    var bLen = bHi - bLo;
    if (aLen <= 0 || bLen <= 0) return { a: aLo, b: bLo, size: 0 };
    if (aLen * bLen > DIFF_SCAN_BUDGET) return { a: aLo, b: bLo, size: 0 };

    var bIndex = Object.create(null);
    var j;
    for (j = bLo; j < bHi; j++) {
      var ch = b.charAt(j);
      if (!bIndex[ch]) bIndex[ch] = [];
      bIndex[ch].push(j);
    }
    var bestI = aLo;
    var bestJ = bLo;
    var bestSize = 0;
    var i;
    for (i = aLo; i < aHi; i++) {
      if (aHi - i <= bestSize) break;
      var chA = a.charAt(i);
      if (isDiffJunkChar(chA)) continue;
      var positions = bIndex[chA];
      if (!positions) continue;
      for (var p = 0; p < positions.length; p++) {
        var j0 = positions[p];
        if (j0 < bLo || j0 >= bHi) continue;
        if (bHi - j0 <= bestSize) continue;
        var k = 1;
        while (i + k < aHi && j0 + k < bHi && a.charAt(i + k) === b.charAt(j0 + k)) {
          k++;
        }
        if (k > bestSize) {
          bestI = i;
          bestJ = j0;
          bestSize = k;
        }
      }
    }
    if (bestSize < DIFF_MIN_MATCH) return { a: aLo, b: bLo, size: 0 };
    return { a: bestI, b: bestJ, size: bestSize };
  }

  function slicesEqual(a, aLo, aHi, b, bLo, bHi) {
    if (aHi - aLo !== bHi - bLo) return false;
    for (var t = 0; t < aHi - aLo; t++) {
      if (a.charAt(aLo + t) !== b.charAt(bLo + t)) return false;
    }
    return true;
  }

  /** Recursive maximal equal-string blocks → sorted [{a,b,size}, ...]. */
  function matchingBlocks(a, b) {
    var blocks = [];
    function recurse(aLo, aHi, bLo, bHi) {
      if (aLo >= aHi && bLo >= bHi) return;
      // Whitespace-only (and any other identical) gaps must stay equal; junk
      // non-starters would otherwise leave them unmatched.
      if (aLo < aHi && slicesEqual(a, aLo, aHi, b, bLo, bHi)) {
        blocks.push({ a: aLo, b: bLo, size: aHi - aLo });
        return;
      }
      var match = findLongestMatch(a, aLo, aHi, b, bLo, bHi);
      if (match.size === 0) return;
      if (match.a > aLo || match.b > bLo) recurse(aLo, match.a, bLo, match.b);
      blocks.push(match);
      var aNext = match.a + match.size;
      var bNext = match.b + match.size;
      if (aNext < aHi || bNext < bHi) recurse(aNext, aHi, bNext, bHi);
    }
    recurse(0, a.length, 0, b.length);
    blocks.sort(function (x, y) {
      return x.a - y.a || x.b - y.b;
    });
    return blocks;
  }

  /** Push delete/insert for a gap; identical sides collapse to equal. */
  function pushGapOps(edits, del, ins) {
    if (del && ins && del === ins) {
      edits.push([0, del]);
      return;
    }
    if (del) edits.push([-1, del]);
    if (ins) edits.push([1, ins]);
  }

  function mergeDiffOps(edits) {
    var merged = [];
    for (var i = 0; i < edits.length; i++) {
      if (!edits[i][1]) continue;
      var last = merged[merged.length - 1];
      if (last && last[0] === edits[i][0]) last[1] += edits[i][1];
      else merged.push([edits[i][0], edits[i][1]]);
    }
    return merged;
  }

  /** Maximal equal-substring diff → [[op, text], ...] with op -1|0|1. */
  function diffStrings(a, b) {
    if (a === b) return a ? [[0, a]] : [];
    if (!a) return [[1, b]];
    if (!b) return [[-1, a]];

    var start = 0;
    var aLen = a.length;
    var bLen = b.length;
    while (start < aLen && start < bLen && a.charAt(start) === b.charAt(start)) {
      start++;
    }
    var aEnd = aLen;
    var bEnd = bLen;
    while (aEnd > start && bEnd > start && a.charAt(aEnd - 1) === b.charAt(bEnd - 1)) {
      aEnd--;
      bEnd--;
    }

    var edits = [];
    if (start > 0) edits.push([0, a.slice(0, start)]);

    var aMid = a.slice(start, aEnd);
    var bMid = b.slice(start, bEnd);
    if (!aMid && bMid) {
      edits.push([1, bMid]);
    } else if (aMid && !bMid) {
      edits.push([-1, aMid]);
    } else if (aMid && bMid) {
      var blocks = matchingBlocks(aMid, bMid);
      var ai = 0;
      var bi = 0;
      for (var i = 0; i < blocks.length; i++) {
        var m = blocks[i];
        pushGapOps(
          edits,
          ai < m.a ? aMid.slice(ai, m.a) : "",
          bi < m.b ? bMid.slice(bi, m.b) : ""
        );
        edits.push([0, aMid.slice(m.a, m.a + m.size)]);
        ai = m.a + m.size;
        bi = m.b + m.size;
      }
      pushGapOps(
        edits,
        ai < aMid.length ? aMid.slice(ai) : "",
        bi < bMid.length ? bMid.slice(bi) : ""
      );
    }

    if (aEnd < aLen) edits.push([0, a.slice(aEnd)]);
    return mergeDiffOps(edits);
  }

  function queueConsolidateSave() {
    if (consolidateQueued || saving || !dirty) return;
    if (versionView && versionView.mode === "readonly") return;
    consolidateQueued = true;
    clearTimeout(timer);
    window.setTimeout(function () {
      consolidateQueued = false;
      saveNow();
    }, 0);
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
      var diffs = diffStrings(baseline, indexed.text);
      if (diffs.length >= UNSAVED_SEGMENT_LIMIT) {
        queueConsolidateSave();
        return DecorationSet.empty;
      }
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

  function scheduleMarkdownReplace(from, to, md) {
    if (pendingMarkdownReplace) return;
    pendingMarkdownReplace = { from: from, to: to, md: md };
    window.setTimeout(flushMarkdownReplace, 0);
  }

  function flushMarkdownReplace() {
    var job = pendingMarkdownReplace;
    pendingMarkdownReplace = null;
    if (!job || !editor || !wwViewRef || !TextSelectionClass) return;
    if (versionView && versionView.mode === "readonly") return;
    var view = wwViewRef;
    var size = view.state.doc.content.size;
    if (job.from < 0 || job.to > size || job.from >= job.to) return;
    var live = view.state.doc.textBetween(job.from, job.to, "\n", "\n");
    // Allow trailing newline differences from block boundaries.
    if (live.replace(/\n$/, "") !== job.md.replace(/\n$/, "")) return;
    try {
      var tr = view.state.tr.delete(job.from, job.to);
      tr.setSelection(TextSelectionClass.create(tr.doc, job.from));
      view.dispatch(tr);
      insertMarkdownParsed(job.md);
    } catch (err) {
      /* selection may be invalid after a concurrent edit */
    }
  }

  /**
   * Convert completed Markdown constructs to WW nodes/marks as the operator types.
   * Toast UI does not do this by default in WYSIWYG mode.
   */
  function markdownInlineInputPlugin(context) {
    var Plugin = context.pmState.Plugin;
    var PluginKey = context.pmState.PluginKey;
    TextSelectionClass = context.pmState.TextSelection;
    var key = new PluginKey("bcMarkdownInlineInput");
    var META = "bcMdInline";
    // Order: longer openers first so ** wins over *, ~~ is unambiguous.
    var inlineRules = [
      { re: /\*\*([^*\n]+)\*\*$/, mark: "strong" },
      { re: /__([^_\n]+)__$/, mark: "strong" },
      { re: /~~([^~\n]+)~~$/, mark: "strike" },
      { re: /`([^`\n]+)`$/, mark: "code" },
      { re: /(?<![*_])\*([^*\n]+)\*$/, mark: "emph" },
      { re: /(?<![*_])_([^_\n]+)_$/, mark: "emph" },
    ];

    function inListItem($pos) {
      for (var d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === "listItem") return true;
      }
      return false;
    }

    function isTableRow(text) {
      return /^\|.+\|/.test(String(text || "").trim());
    }

    function isTableSeparator(text) {
      return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(text || "").trim());
    }

    function blockTextsBefore($pos) {
      var texts = [];
      var index = $pos.index($pos.depth - 1);
      var parent = $pos.node($pos.depth - 1);
      for (var i = index; i >= 0 && i >= index - 12; i--) {
        var child = parent.child(i);
        if (!child.isTextblock) break;
        texts.unshift(child.textContent);
      }
      return texts;
    }

    function tableMarkdownIfComplete(rows) {
      if (!rows || rows.length < 2) return null;
      var sepIdx = -1;
      for (var i = 0; i < rows.length; i++) {
        if (isTableSeparator(rows[i])) {
          sepIdx = i;
          break;
        }
      }
      if (sepIdx < 1) return null;
      var slice = rows.slice(0, rows.length);
      // Need header above separator and only table-looking lines.
      for (var j = 0; j < slice.length; j++) {
        if (j === sepIdx) continue;
        if (!isTableRow(slice[j])) return null;
      }
      return slice.join("\n");
    }

    function tryBlock(state, $pos, before, trBase) {
      if ($pos.parent.type.name !== "paragraph") return null;
      var schema = state.schema;
      var start = $pos.start();
      var pos = $pos.pos;

      // ATX heading: "# " … "###### "
      var heading = before.match(/^(#{1,6})\s$/);
      if (heading && !inListItem($pos) && schema.nodes.heading) {
        var level = heading[1].length;
        var trH = trBase || state.tr;
        trH.delete(start, pos);
        var mappedH = trH.mapping.map(start);
        trH.setBlockType(
          mappedH,
          trH.mapping.map($pos.end()),
          schema.nodes.heading,
          { level: level }
        );
        return trH;
      }

      // Block quote: "> "
      if (before === "> " && !inListItem($pos) && schema.nodes.blockQuote) {
        var trQ = trBase || state.tr;
        trQ.delete(start, pos);
        var $q = trQ.doc.resolve(trQ.mapping.map(start));
        var rangeQ = $q.blockRange();
        if (rangeQ) trQ.wrap(rangeQ, [{ type: schema.nodes.blockQuote }]);
        return trQ;
      }

      // Task list: "- [ ] " / "- [x] " / "* [ ] " (must win over plain bullets)
      var task = before.match(/^([-*+])\s+\[([ xX])\]\s$/);
      if (task && !inListItem($pos) && schema.nodes.bulletList && schema.nodes.listItem) {
        var checked = task[2] !== " ";
        var trT = trBase || state.tr;
        trT.delete(start, pos);
        var $t = trT.doc.resolve(trT.mapping.map(start));
        var rangeT = $t.blockRange();
        if (rangeT) {
          trT.wrap(rangeT, [
            { type: schema.nodes.bulletList },
            { type: schema.nodes.listItem, attrs: { task: true, checked: checked } },
          ]);
        }
        return trT;
      }

      // Bullet list: "- x" / "* x" / "+ x" — wait past "- " so "- [ ] " can become a task.
      var bullet = before.match(/^([-*+])\s([^\[\n])$/);
      if (bullet && !inListItem($pos) && schema.nodes.bulletList && schema.nodes.listItem) {
        var trB = trBase || state.tr;
        // Delete only the marker and space; keep the first content character.
        trB.delete(start, start + 2);
        var $b = trB.doc.resolve(trB.mapping.map(start));
        var rangeB = $b.blockRange();
        if (rangeB) {
          trB.wrap(rangeB, [
            { type: schema.nodes.bulletList },
            { type: schema.nodes.listItem },
          ]);
        }
        return trB;
      }

      // Ordered list: "1. x" — same delayed trigger as bullets so "1. " alone stays raw briefly.
      var ordered = before.match(/^(\d+)\.\s([^\[\n])$/);
      if (ordered && !inListItem($pos) && schema.nodes.orderedList && schema.nodes.listItem) {
        var order = Math.max(1, parseInt(ordered[1], 10) || 1);
        var markerLen = String(ordered[1]).length + 2; // digits + ". "
        var trO = trBase || state.tr;
        trO.delete(start, start + markerLen);
        var $o = trO.doc.resolve(trO.mapping.map(start));
        var rangeO = $o.blockRange();
        if (rangeO) {
          trO.wrap(rangeO, [
            { type: schema.nodes.orderedList, attrs: { order: order } },
            { type: schema.nodes.listItem },
          ]);
        }
        return trO;
      }

      // Thematic break on its own line: --- / *** / ___
      if (
        /^(-{3,}|\*{3,}|_{3,})$/.test(before) &&
        !inListItem($pos) &&
        schema.nodes.thematicBreak
      ) {
        var trR = trBase || state.tr;
        var beforePos = $pos.before();
        var afterPos = $pos.after();
        var nodes = [schema.nodes.thematicBreak.create()];
        if (schema.nodes.paragraph) nodes.push(schema.nodes.paragraph.create());
        trR.replaceWith(beforePos, afterPos, nodes);
        return trR;
      }

      return null;
    }

    function tryLinkOrImage(state, $pos, before) {
      var schema = state.schema;
      var image = before.match(/!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (image && schema.nodes.image) {
        var alt = image[1];
        var imageUrl = image[2];
        var matchLenImg = image[0].length;
        var fromImg = $pos.pos - matchLenImg;
        if (fromImg < $pos.start()) return null;
        var trImg = state.tr;
        var imgNode = schema.nodes.image.create({
          imageUrl: imageUrl,
          altText: alt || null,
        });
        trImg.replaceWith(fromImg, $pos.pos, imgNode);
        return trImg;
      }

      // Image is tried first; reject a bare [...](...) that is actually the tail of ![...](...).
      var link = before.match(/\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link && schema.marks.link) {
        var matchLen = link[0].length;
        var from = $pos.pos - matchLen;
        if (from < $pos.start()) return null;
        var prefixIdx = before.length - matchLen - 1;
        if (prefixIdx >= 0 && before.charAt(prefixIdx) === "!") return null;
        var label = link[1];
        var linkUrl = link[2];
        var tr = state.tr;
        tr.delete(from, $pos.pos);
        tr.insertText(label, from);
        tr.addMark(from, from + label.length, schema.marks.link.create({ linkUrl: linkUrl }));
        tr.removeStoredMark(schema.marks.link);
        return tr;
      }
      return null;
    }

    function tryInlineMarks(state, $pos, before) {
      for (var i = 0; i < inlineRules.length; i++) {
        var rule = inlineRules[i];
        var m = before.match(rule.re);
        if (!m) continue;
        var markType = state.schema.marks[rule.mark];
        if (!markType) continue;
        var inner = m[1];
        if (!inner) continue;
        var matchLen = m[0].length;
        var from = $pos.pos - matchLen;
        if (from < $pos.start()) continue;
        var tr = state.tr;
        tr.delete(from, $pos.pos);
        tr.insertText(inner, from);
        tr.addMark(from, from + inner.length, markType.create());
        tr.removeStoredMark(markType);
        return tr;
      }
      return null;
    }

    function tryTable(state, $pos) {
      if ($pos.parent.type.name !== "paragraph") return false;
      if ($pos.depth < 1) return false;
      var rows = blockTextsBefore($pos);
      var md = tableMarkdownIfComplete(rows);
      if (!md) return false;
      var parentDepth = $pos.depth - 1;
      var parent = $pos.node(parentDepth);
      var index = $pos.index(parentDepth);
      var firstIndex = index - (rows.length - 1);
      if (firstIndex < 0) return false;
      var from = $pos.start(parentDepth);
      for (var i = 0; i < firstIndex; i++) {
        from += parent.child(i).nodeSize;
      }
      var to = $pos.after($pos.depth);
      scheduleMarkdownReplace(from, to, md);
      return true;
    }

    function conversionTr(state) {
      if (versionView && versionView.mode === "readonly") return null;
      var sel = state.selection;
      if (!sel.empty) return null;
      var $pos = sel.$from;
      if (!$pos.parent.isTextblock) return null;
      var before = $pos.parent.textBetween(0, $pos.parentOffset, null, "\ufffc");
      if (!before) {
        // Empty new paragraph after a table-looking block: still try siblings above.
        if (tryTable(state, $pos)) return null;
        return null;
      }

      var blockTr = tryBlock(state, $pos, before, null);
      if (blockTr) return blockTr;

      var linkTr = tryLinkOrImage(state, $pos, before);
      if (linkTr) return linkTr;

      var markTr = tryInlineMarks(state, $pos, before);
      if (markTr) return markTr;

      if (isTableRow(before) || isTableSeparator(before)) {
        tryTable(state, $pos);
      }
      return null;
    }

    return {
      wysiwygPlugins: [
        function () {
          return new Plugin({
            key: key,
            appendTransaction: function (transactions, _oldState, newState) {
              if (ignoringBaselineTr) return null;
              if (!transactions.length) return null;
              if (transactions.some(function (tr) { return tr.getMeta(META); })) return null;
              if (!transactions.some(function (tr) { return tr.docChanged; })) return null;
              var tr = conversionTr(newState);
              if (tr) {
                tr.setMeta(META, true);
                tr.setMeta("addToHistory", true);
              }
              return tr;
            },
            view: function (editorView) {
              wwViewRef = editorView;
              return {
                destroy: function () {
                  if (wwViewRef === editorView) wwViewRef = null;
                },
              };
            },
          });
        },
      ],
    };
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
      plugins: [markdownInlineInputPlugin, unsavedDiffPlugin],
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
    setupForceSaveShortcut();
    setupChapterTags();
    setupChapterHistory();
    setupChapterDownload();
  }

  function setupForceSaveShortcut() {
    document.addEventListener(
      "keydown",
      function (event) {
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.altKey) return;
        var key = event.key || "";
        if (key !== "s" && key !== "S") return;
        var form = document.getElementById("editor-form");
        if (!form) return;
        event.preventDefault();
        event.stopPropagation();
        // Single-flight: ignore fat-finger while a save is in progress.
        if (saving) return;
        // Idempotent when clean: suppress browser Save Page only.
        if (!dirty) return;
        clearTimeout(timer);
        saveNow();
      },
      true
    );
  }

  function closeChapterMoreMenu() {
    var menu = document.querySelector(".chapter-more-menu");
    if (menu) menu.open = false;
  }

  function setupChapterDownload() {
    var btn = document.getElementById("chapter-download-btn");
    var form = document.getElementById("editor-form");
    if (!btn || !form) return;

    btn.addEventListener("click", async function () {
      closeChapterMoreMenu();
      var pathInput = form.querySelector('input[name="path"]');
      var path = pathInput ? pathInput.value : "";
      if (!path) return;
      try {
        if (dirty) {
          var saved = await saveNow();
          if (!saved && dirty) {
            setSaveStatus("Save current chapter before download", "error");
            return;
          }
        }
        var url =
          "/books/" +
          bookId() +
          "/chapters/download?path=" +
          encodeURIComponent(path);
        var link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "");
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err) {
        setSaveStatus("Could not download chapter", "error");
      }
    });
  }

  function setupChapterTags() {
    var openBtn = document.getElementById("chapter-tags-btn");
    var dialog = document.getElementById("chapter-tags-dialog");
    var list = document.getElementById("chapter-tags-list");
    var empty = document.getElementById("chapter-tags-empty");
    var createBtn = document.getElementById("chapter-tag-create-btn");
    var createDialog = document.getElementById("chapter-tag-create-dialog");
    var createForm = document.getElementById("chapter-tag-create-form");
    var labelInput = document.getElementById("chapter-tag-label");
    var deleteDialog = document.getElementById("chapter-tag-delete-dialog");
    var deleteForm = document.getElementById("chapter-tag-delete-form");
    var deleteLabel = document.getElementById("chapter-tag-delete-label");
    var deleteIdInput = document.getElementById("chapter-tag-delete-id");
    var form = document.getElementById("editor-form");
    if (!openBtn || !dialog || !list || !form) return;

    function chapterPath() {
      var input = form.querySelector('input[name="path"]');
      return input ? input.value : "";
    }

    async function loadTags() {
      list.innerHTML = "";
      empty.hidden = true;
      var path = chapterPath();
      if (!path) return;
      var response = await fetch(
        "/books/" + bookId() + "/files/tags?path=" + encodeURIComponent(path),
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) throw new Error("tags failed");
      var data = await response.json();
      var tags = data.tags || [];
      if (!tags.length) {
        empty.hidden = false;
        return;
      }
      tags.forEach(function (tag) {
        var li = document.createElement("li");
        li.className = "history-item";
        var meta = document.createElement("div");
        meta.className = "history-meta";
        var words = typeof tag.word_count === "number" ? tag.word_count : 0;
        var title = document.createElement("strong");
        title.textContent = tag.label || "Tag";
        var detail = document.createElement("span");
        detail.className = "muted";
        detail.textContent =
          formatWhen(tag.saved_at) +
          " · " +
          words +
          (words === 1 ? " word" : " words");
        meta.appendChild(title);
        meta.appendChild(detail);
        var actions = document.createElement("div");
        actions.className = "history-item-actions";
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
                "/files/tags/revision?path=" +
                encodeURIComponent(path) +
                "&id=" +
                encodeURIComponent(tag.id),
              { headers: { Accept: "application/json" } }
            );
            if (!res.ok) throw new Error("tag failed");
            var payload = await res.json();
            if (typeof payload.content !== "string") throw new Error("tag failed");
            await openHistoricVersion(tag, payload.content);
            dialog.close();
          } catch (err) {
            setSaveStatus("Could not open tag", "error");
            open.disabled = false;
          }
        });
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "button ghost";
        remove.textContent = "Delete";
        remove.addEventListener("click", function () {
          if (!deleteDialog || !deleteIdInput || !deleteLabel) return;
          deleteIdInput.value = tag.id;
          deleteLabel.textContent = tag.label || "this tag";
          if (typeof deleteDialog.showModal === "function") deleteDialog.showModal();
        });
        actions.appendChild(open);
        actions.appendChild(remove);
        li.appendChild(meta);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }

    openBtn.addEventListener("click", async function () {
      closeChapterMoreMenu();
      try {
        await loadTags();
        if (typeof dialog.showModal === "function") dialog.showModal();
      } catch (err) {
        setSaveStatus("Could not load tags", "error");
      }
    });

    if (createBtn && createDialog && labelInput) {
      createBtn.addEventListener("click", function () {
        labelInput.value = "";
        if (typeof createDialog.showModal === "function") createDialog.showModal();
        labelInput.focus();
      });
    }

    if (createForm && createDialog && labelInput) {
      createForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var label = (labelInput.value || "").trim();
        if (!label) {
          setSaveStatus("Tag label is required", "error");
          return;
        }
        var submit = createForm.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
          if (dirty) {
            var saved = await saveNow();
            if (!saved && dirty) {
              setSaveStatus("Save current chapter before tagging", "error");
              return;
            }
          }
          var body = new FormData();
          body.append("path", chapterPath());
          body.append("label", label);
          var response = await fetch("/books/" + bookId() + "/files/tags", {
            method: "POST",
            body: body,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("create tag failed");
          createDialog.close();
          await loadTags();
          setSaveStatus("Tag created", "saved");
        } catch (err) {
          setSaveStatus("Could not create tag", "error");
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }

    if (deleteForm && deleteDialog && deleteIdInput) {
      deleteForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var tagId = deleteIdInput.value;
        if (!tagId) return;
        var submit = deleteForm.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
          var body = new FormData();
          body.append("path", chapterPath());
          body.append("id", tagId);
          var response = await fetch("/books/" + bookId() + "/files/tags/delete", {
            method: "POST",
            body: body,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("delete tag failed");
          deleteDialog.close();
          await loadTags();
          setSaveStatus("Tag deleted", "saved");
        } catch (err) {
          setSaveStatus("Could not delete tag", "error");
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }
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
      closeChapterMoreMenu();
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
