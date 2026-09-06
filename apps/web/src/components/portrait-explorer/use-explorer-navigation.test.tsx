import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { currentFacet, selectedChapterIds } from "./explorer-state.js";
import { useExplorerNavigation } from "./use-explorer-navigation.js";

function AccountNavigation() {
  const navigation = useExplorerNavigation(["chapter-1", "chapter-2"], { embedded: true });
  const { state, isOpen, open, close, dispatch } = navigation;
  return <>
    <output>{isOpen ? `${selectedChapterIds(state).join("+")}:${currentFacet(state)}:${state.presentation}` : "Account reading"}</output>
    <button onClick={open}>Open portrait</button><button onClick={close}>Close portrait</button>
    <button onClick={() => dispatch({ type: "select", chapterId: "chapter-1" })}>Chapter one</button>
    <button onClick={() => dispatch({ type: "select", chapterId: "chapter-2" })}>Chapter two</button>
    <button onClick={() => dispatch({ type: "presentation", presentation: "reading" })}>Read</button>
    <button onClick={() => dispatch({ type: "facet", facet: "resources" })}>Resources</button>
    <button onClick={() => dispatch({ type: "back" })}>Return</button>
  </>;
}

beforeEach(() => {
  window.history.replaceState({ route: "previous" }, "");
  window.history.pushState({ route: "pattern", unrelated: "retained" }, "");
});
const output = () => screen.getByRole("status");
async function travel(direction: "back" | "forward") {
  await act(async () => {
    const done = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    window.history[direction]();
    await done;
  });
}

describe("account portrait history boundary", () => {
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
