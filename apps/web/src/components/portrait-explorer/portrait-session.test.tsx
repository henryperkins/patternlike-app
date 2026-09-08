import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { PortraitSessionProvider, useClearPortraitSession, usePortraitSession } from "./portrait-session.js";

beforeEach(() => { window.history.replaceState(null, ""); });

function rememberScene(memory: ReturnType<typeof usePortraitSession>["memory"]) {
  memory.scene = {
    sourceIdentity: "private-source",
    experience: { roofOpen: false, lighting: "dusk", inspect: true, openDesks: { "chapter-1": true }, turns: { "chapter-1": 2 } },
    bookmarks: new Map([["chapter-1:assembled:inspect", { position: [2, 3, 4], target: [1, 1, 1] }]]),
  };
}

it("discards scene memory when the source changes, including a later return to the old source", () => {
  const hook = renderHook(({ identity }) => usePortraitSession(identity), { initialProps: { identity: "source-one" }, wrapper: PortraitSessionProvider });
  rememberScene(hook.result.current.memory);
  hook.rerender({ identity: "source-two" });
  expect(hook.result.current.memory.scene).toBeNull();
  rememberScene(hook.result.current.memory);
  hook.rerender({ identity: "source-one" });
  expect(hook.result.current.memory.scene).toBeNull();
});

it("clears scene choices and bookmarks through the existing access and deletion invalidation", () => {
  const hook = renderHook(() => ({ session: usePortraitSession("source-one"), clear: useClearPortraitSession() }), { wrapper: PortraitSessionProvider });
  const memory = hook.result.current.session.memory;
  rememberScene(memory);
  const bookmarks = memory.scene!.bookmarks;
  act(() => hook.result.current.clear());
  expect(memory.scene).toBeNull();
  expect(bookmarks.size).toBe(0);
});

it("starts with fresh scene choices when a signed-in session boundary is replaced", () => {
  const first = renderHook(() => usePortraitSession("source-one"), { wrapper: PortraitSessionProvider });
  rememberScene(first.result.current.memory);
  first.unmount();
  const second = renderHook(() => usePortraitSession("source-one"), { wrapper: PortraitSessionProvider });
  expect(second.result.current.memory.scene).toBeNull();
});
