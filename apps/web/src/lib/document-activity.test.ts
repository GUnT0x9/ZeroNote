import { expect, it, vi } from "vitest";
import {
  getDocumentActivityRevision,
  notifyDocumentActivity,
  subscribeDocumentActivity,
} from "./document-activity";
it("notifies immediate edits and removes subscriptions without polling", () => {
  const listener = vi.fn(),
    before = getDocumentActivityRevision(),
    unsubscribe = subscribeDocumentActivity(listener);
  try {
    notifyDocumentActivity();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDocumentActivityRevision()).toBe(before + 1);
  } finally {
    unsubscribe();
  }
  unsubscribe();
  notifyDocumentActivity();
  expect(listener).toHaveBeenCalledTimes(1);
});
it("keeps other subscribers working when one unsubscribes during a notification", () => {
  const other = vi.fn();
  let unsubscribe = () => {};
  unsubscribe = subscribeDocumentActivity(() => unsubscribe());
  const releaseOther = subscribeDocumentActivity(other);
  try {
    notifyDocumentActivity();
    notifyDocumentActivity();
    expect(other).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    releaseOther();
  }
});
