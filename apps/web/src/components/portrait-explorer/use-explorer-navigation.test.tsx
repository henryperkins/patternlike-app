import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { currentFacet, selectedChapterIds } from "./explorer-state.js";
import { clearExplorerMemory, createExplorerMemory, useExplorerNavigation, type ExplorerMemory } from "./use-explorer-navigation.js";

function AccountNavigation({ memory }: { memory?: ExplorerMemory } = {}) {
  const navigation = useExplorerNavigation(["chapter-1", "chapter-2"], { embedded: true, memory });
  const { state, isOpen, open, close, dispatch } = navigation;
  return <>
    <output>{isOpen ? `${selectedChapterIds(state).join("+")}:${currentFacet(state)}:${state.presentation}` : "Account reading"}</output>
    <button onClick={open}>Open portrait</button><button onClick={close}>Close portrait</button>
    <button onClick={() => dispatch({ type: "select", chapterId: "chapter-1" })}>Chapter one</button>
    <button onClick={() => dispatch({ type: "select", chapterId: "chapter-2" })}>Chapter two</button>
    <button onClick={() => dispatch({ type: "presentation", presentation: "reading" })}>Read</button>
    <button onClick={() => dispatch({ type: "facet", facet: "resources" })}>Resources</button>
    <button onClick={() => dispatch({ type: "passage", index: 1 })}>Second passage</button>
    <button onClick={() => dispatch({ type: "compare", chapterId: "chapter-2" })}>Compare</button>
    <button onClick={() => dispatch({ type: "sky", body: "sun" })}>Sky</button>
    <button onClick={() => dispatch({ type: "sky", body: "moon" })}>Moon</button>
    <button onClick={() => dispatch([{ type: "back" }, { type: "presentation", presentation: "reading" }])}>Read from sky</button>
    <button onClick={() => dispatch({ type: "back" })}>Return</button>
  </>;
}

beforeEach(() => {
  window.history.replaceState({ route: "previous" }, "", "#previous");
  window.history.pushState({ route: "pattern", unrelated: "retained" }, "", "#pattern");
});
const output = () => screen.getByRole("status");
async function travel(direction: "back" | "forward") {
  await act(async () => {
    const done = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    window.history[direction]();
    await done;
  });
}
async function visit(hash: string) {
  await act(async () => {
    const done = new Promise<void>((resolve) => window.addEventListener("hashchange", () => resolve(), { once: true }));
    window.location.hash = hash;
    await done;
  });
}

describe("account portrait history boundary", () => {
  it("pushes a new reading after returning from sky without overwriting the chapter history", async () => {
    const memory = createExplorerMemory(), user = userEvent.setup();
    render(<AccountNavigation memory={memory} />);
    for (const name of ["Open portrait", "Chapter one", "Resources", "Sky", "Read from sky"]) await user.click(screen.getByText(name));
    await waitFor(() => expect(output()).toHaveTextContent("chapter-1:resources:reading"));
    const entry = memory.history.entries.get(memory.history.active)!;
    expect(entry.depth).toBe(memory.snapshot!.past.length);
    await user.click(screen.getByText("Return"));
    await waitFor(() => expect(output()).toHaveTextContent("chapter-1:resources:explore"));
    await travel("back");
    expect(output()).toHaveTextContent("chapter-1:overview:explore");
    await travel("back");
    expect(output()).toHaveTextContent(":overview:explore");
    expect(output()).not.toHaveTextContent("chapter-");
    await travel("back");
    expect(output()).toHaveTextContent("Account reading");
  });

  it.each(["Read", "Compare"])("round trips sky through native and visible returns from %s without leaking or skipping history", async (mode) => {
    const memory = createExplorerMemory(), user = userEvent.setup();
    const accountEntry = window.history.state;
    render(<AccountNavigation memory={memory} />);
    for (const name of ["Open portrait", "Chapter one", "Resources", "Second passage", mode]) await user.click(screen.getByText(name));
    const origin = memory.snapshot, originMarker = window.history.state;
    await user.click(screen.getByText("Sky"));
    const skyMarker = window.history.state;
    expect(skyMarker.portrait.index).not.toBe(originMarker.portrait.index);
    await user.click(screen.getByText("Moon"));
    expect(window.history.state).toEqual(skyMarker);
    expect(memory.snapshot?.sky).toEqual({ body: "moon" });
    expect(Object.keys(skyMarker.portrait).sort()).toEqual(["index", "scope"]);
    expect(window.location.hash).toBe("#pattern");
    await travel("back");
    expect(memory.snapshot).toEqual(origin);
    await travel("forward");
    expect(memory.snapshot?.sky).toEqual({ body: "moon" });
    await user.click(screen.getByText("Return"));
    await waitFor(() => expect(window.history.state).toEqual(originMarker));
    expect(memory.snapshot).toEqual(origin);
    await travel("forward");
    expect(memory.snapshot?.sky).toEqual({ body: "moon" });
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state).toEqual(accountEntry));
    await user.click(screen.getByText("Open portrait"));
    expect(memory.snapshot?.sky).toEqual({ body: "moon" });
    await travel("back");
    expect(memory.snapshot).toEqual(origin);
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state).toEqual(accountEntry));
    clearExplorerMemory(memory);
    expect(memory.snapshot).toBeNull();
    expect(memory.history.entries.size).toBe(0);
    await travel("back");
    expect(window.history.state).toEqual({ route: "previous" });
  });

  it("releases private state and unwinds a visit after an in-flight return", async () => {
    const memory = createExplorerMemory(), user = userEvent.setup();
    const accountEntry = window.history.state;
    const view = render(<AccountNavigation memory={memory} />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter two"));
    await user.click(screen.getByText("Read"));
    act(() => {
      fireEvent.click(screen.getByText("Return"));
      clearExplorerMemory(memory);
      view.unmount();
    });
    expect(memory.snapshot).toBeNull();
    expect(memory.history.entries.size).toBe(0);
    await waitFor(() => expect(window.history.state).toEqual(accountEntry));
    await travel("back");
    expect(window.history.state).toEqual({ route: "previous" });
  });
  it("restores both visits when browser Back crosses a Today round trip", async () => {
    const memory = createExplorerMemory();
    const user = userEvent.setup(); const view = render(<AccountNavigation memory={memory} />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter two"));
    await user.click(screen.getByText("Resources"));
    await user.click(screen.getByText("Read"));
    await visit("today");
    view.unmount();
    await visit("pattern");
    const returned = render(<AccountNavigation memory={memory} />);
    await user.click(screen.getByText("Open portrait"));
    expect(output()).toHaveTextContent("chapter-2:resources:reading");
    await travel("back");
    expect(output()).toHaveTextContent("chapter-2:resources:explore");
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state?.portrait).toBeUndefined());
    returned.unmount();
    await travel("back");
    expect(window.location.hash).toBe("#today");
    await travel("back");
    expect(window.location.hash).toBe("#pattern");
    render(<AccountNavigation memory={memory} />);
    expect(output()).toHaveTextContent("chapter-2:resources:reading");
    await travel("back");
    expect(output()).toHaveTextContent("chapter-2:resources:explore");
    await travel("forward");
    expect(output()).toHaveTextContent("chapter-2:resources:reading");
  });
  it("resumes the last chapter and perspective after closing and reopening", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter two"));
    await user.click(screen.getByText("Resources"));
    await user.click(screen.getByText("Read"));
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state?.portrait).toBeUndefined());
    await user.click(screen.getByText("Open portrait"));
    expect(output()).toHaveTextContent("chapter-2:resources:reading");
    await travel("back");
    expect(output()).toHaveTextContent("chapter-2:resources:explore");
  });
  it("leaves account history untouched until entry and consumes all portrait entries on exit", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    expect(window.history.state).toEqual({ route: "pattern", unrelated: "retained" });
    await user.click(screen.getByText("Open portrait"));
    expect(window.history.state).toMatchObject({ route: "pattern", unrelated: "retained" });
    await user.click(screen.getByText("Chapter one"));
    await user.click(screen.getByText("Resources"));
    await user.click(screen.getByText("Read"));
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state).toEqual({ route: "pattern", unrelated: "retained" }));
    expect(output()).toHaveTextContent("Account reading");
    await travel("back");
    expect(window.history.state).toEqual({ route: "previous" });
  });

  it("closes on Back through the entry boundary and restores retained states on Forward", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter one"));
    await user.click(screen.getByText("Read"));
    await user.click(screen.getByText("Chapter two"));
    await user.click(screen.getByText("Resources"));
    await travel("back");
    expect(output()).toHaveTextContent("chapter-2:resources:explore");
    await travel("forward");
    expect(output()).toHaveTextContent("chapter-2:resources:reading");
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state?.portrait).toBeUndefined());
    await travel("forward");
    expect(output()).toHaveTextContent(":overview:explore");
    await travel("back");
    expect(output()).toHaveTextContent("Account reading");
  });

  it("starts a new branch after returning without counting discarded forward entries", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter one"));
    await user.click(screen.getByText("Read"));
    await user.click(screen.getByText("Return"));
    await waitFor(() => expect(output()).toHaveTextContent("chapter-1:overview:explore"));
    await user.click(screen.getByText("Resources"));
    await user.click(screen.getByText("Close portrait"));
    await waitFor(() => expect(window.history.state?.portrait).toBeUndefined());
    await travel("back");
    expect(window.history.state).toEqual({ route: "previous" });
  });

  it("serializes a close requested while a presentation return is still in flight", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    await user.click(screen.getByText("Open portrait"));
    await user.click(screen.getByText("Chapter one"));
    await user.click(screen.getByText("Read"));
    act(() => {
      fireEvent.click(screen.getByText("Return"));
      fireEvent.click(screen.getByText("Close portrait"));
    });
    await waitFor(() => expect(window.history.state).toEqual({ route: "pattern", unrelated: "retained" }));
    expect(output()).toHaveTextContent("Account reading");
  });

  it("restores retained browser entries beyond the reducer's thirty-snapshot limit", async () => {
    const user = userEvent.setup(); render(<AccountNavigation />);
    await user.click(screen.getByText("Open portrait"));
    for (let index = 0; index < 35; index++) fireEvent.click(screen.getByText(index % 2 ? "Chapter two" : "Chapter one"));
    await act(async () => {
      const done = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
      window.history.go(-35);
      await done;
    });
    expect(output()).toHaveTextContent(":overview:explore");
    expect(output()).not.toHaveTextContent("chapter-");
    await travel("back");
    expect(output()).toHaveTextContent("Account reading");
  });
});
