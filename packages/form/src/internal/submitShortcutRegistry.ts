/**
 * Count of Submit buttons currently mounted with an ACTIVE save shortcut.
 * The focus-aware guard uses `count === 1` to decide whether the no-focus
 * fallback may fire — ambiguity (2+) means no-op, never "submit them all".
 * Module-level because the shortcut is a document-level concern; only touched
 * from effects, so it never runs during SSR.
 */
const registry = new Set<symbol>();

export function registerSubmitShortcut(id: symbol) {
  registry.add(id);
}

export function unregisterSubmitShortcut(id: symbol) {
  registry.delete(id);
}

export function submitShortcutCount() {
  return registry.size;
}

/**
 * Pure decision core for the save-shortcut guard — exported for tests.
 * Truth table (see the spec's acceptance criteria):
 * - focus inside a form → fire only for that form's Submit
 * - focus in any other editable surface (agent chat textarea, ProseMirror…) → never
 * - focus on a non-editable element/body → fire only the sole active Submit
 */
export function shouldSubmitOnShortcut(args: {
  ownForm: object | null;
  activeForm: object | null;
  activeIsEditable: boolean;
  activeSubmitCount: number;
}): boolean {
  const { ownForm, activeForm, activeIsEditable, activeSubmitCount } = args;
  if (activeForm) return activeForm === ownForm && ownForm !== null;
  if (activeIsEditable) return false;
  return activeSubmitCount === 1;
}
