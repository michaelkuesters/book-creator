# Chapter tags

## Intent

Leave-time History is an automatic audit trail. Operators also need to mark a chapter *as it stands now* with a short free-text label (for example “section 1 reworked”) so they can return to that named moment later—without hunting timestamps or relying on autosave alone.

**Hypothesis:** We believe a Tags control beside History in the chapter More menu, reusing the same snapshot-and-open mechanics, will make intentional checkpoints cheap while keeping automatic History unchanged.

## User-facing behaviour

```gherkin
Scenario: Create a tag for the current chapter
  Given an open chapter on Write
  When the operator opens Tags and creates a new tag with a short free-text label
  Then a named snapshot of the chapter *as of now* is stored for that chapter
  And the tag appears in the Tags list with its label and timestamp

Scenario: Open a tagged version
  Given the chapter has at least one tag
  When the operator opens Tags and chooses a tagged version
  Then that content loads into the editor without overwriting the on-disk Latest
  And editing that view follows the same Proceed / Open Read-Only warning as History

Scenario: Delete a tag
  Given the Tags list shows at least one tag
  When the operator deletes a tag and confirms in a dialog
  Then that tagged snapshot is removed
  And Latest and History are unchanged

Scenario: Tags stay distinct from History
  Given leave-time History versions and operator Tags for the same chapter
  When the operator opens History or Tags
  Then History lists only automatic leave-time versions
  And Tags lists only operator-named tags
  And Squash on History does not remove Tags
```

## Feature description

### Musts

- Write offers a **Tags** control next to **History** in the chapter More menu, using the same sheet/`<dialog>` pattern: create a new tag, open a prior tagged version, or delete a tag.
- Creating a tag captures the chapter content **as of now** (current editor content, persisted first if dirty) with a short free-text label the operator types in a `<dialog>` (not `window.prompt`).
- Tags are per chapter, newest first. Each entry shows label, timestamp, and word count, plus a delete action.
- Deleting a tag confirms via `<dialog>`, then removes only that tagged snapshot. Latest and leave-time History stay intact.
- Opening a tag uses the same historic-view behaviour as History: Latest on disk stays intact until the operator Proceeds (checkpoint then edit/save as Latest) or chooses Open Read-Only.
- Tags live under the book package (alongside History storage) and are excluded from Book.txt and package zip exports, same as `.history/`.
- History Squash must not delete or rewrite tags. Idle autosave does not create tags.

### Must nots

- Must not replace or rename History; Tags are a separate operator-facing list.
- Must not overwrite on-disk Latest merely by opening a tag.
- Must not delete Latest or History versions when deleting a tag.
- Must not use `window.prompt`, `window.confirm`, or `window.alert` for create/open/delete flows.
- Must not require a separate SPA; reuse existing Write chrome and studio scripts.

### Preferences

- Prefer reusing existing snapshot write/read and `openHistoricVersion` / promote-dialog paths over a parallel restore stack.
- Empty or whitespace-only labels should be refused; keep labels short in the UI (single-line).

### Escalation

- If the chapter path is not a manuscript chapter, Tags is unavailable (same boundary as History).

## Acceptance criteria

1. Write shows Tags next to History in the chapter More menu; the Tags sheet can create a labelled snapshot of the current chapter and list prior tags (label, timestamp, word count) with delete.
2. Opening a tag loads content into the editor without writing Latest; starting to edit uses the existing Proceed / Open Read-Only `<dialog>`.
3. Deleting a tag confirms via `<dialog>` and removes only that tag; Latest and History are unchanged.
4. Tags are not listed in History; History Squash does not remove tags; tags are not included in package zip exports.
5. Covered by tests alongside chapter history (create/list/open/delete tag; squash leaves tags intact; export omits tag storage).
