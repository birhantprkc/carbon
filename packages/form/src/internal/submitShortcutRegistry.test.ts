import { describe, expect, it } from "vitest";
import {
  registerSubmitShortcut,
  shouldSubmitOnShortcut,
  submitShortcutCount,
  unregisterSubmitShortcut
} from "./submitShortcutRegistry";

const formA = {};
const formB = {};

describe("shouldSubmitOnShortcut (guard truth table)", () => {
  it("fires when focus is inside this Submit's own form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: formA,
        activeIsEditable: true,
        activeSubmitCount: 3
      })
    ).toBe(true);
  });

  it("no-ops when focus is inside another form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: formB,
        activeIsEditable: true,
        activeSubmitCount: 1
      })
    ).toBe(false);
  });

  it("no-ops when focus is in a formless editable (agent chat textarea)", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: true,
        activeSubmitCount: 1
      })
    ).toBe(false);
  });

  it("fires on body focus when this is the sole active Submit", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: false,
        activeSubmitCount: 1
      })
    ).toBe(true);
  });

  it("no-ops on body focus when several Submits are active", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: formA,
        activeForm: null,
        activeIsEditable: false,
        activeSubmitCount: 2
      })
    ).toBe(false);
  });

  it("never fires for a Submit detached from any form when focus is in a form", () => {
    expect(
      shouldSubmitOnShortcut({
        ownForm: null,
        activeForm: formB,
        activeIsEditable: true,
        activeSubmitCount: 1
      })
    ).toBe(false);
  });
});

describe("submit shortcut registry", () => {
  it("counts registrations and drops them on unregister", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    const base = submitShortcutCount();
    registerSubmitShortcut(a);
    registerSubmitShortcut(b);
    expect(submitShortcutCount()).toBe(base + 2);
    unregisterSubmitShortcut(a);
    expect(submitShortcutCount()).toBe(base + 1);
    unregisterSubmitShortcut(b);
    expect(submitShortcutCount()).toBe(base);
  });
});
