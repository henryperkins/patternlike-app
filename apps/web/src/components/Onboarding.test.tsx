import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding.js";

describe("birth onboarding", () => {
  it("keeps unknown birth time as a first-class path", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /I do not know/i }));
    expect(screen.queryByLabelText("Local time")).not.toBeInTheDocument();
    expect(screen.getByText("Suppressed")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByRole("group", { name: /Where was the birth/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracy: "unknown",
        birth_date: "1990-05-15",
        birth_time_local: null,
      }),
    );
  });

  /**
   * The primary button must stay a submit button on every step. When it changed
   * from type="button" to type="submit" on the way into step three, React
   * flushed that change during the click and the browser then ran the submit
   * default action on the very same node — posting the profile straight from
   * step two. jsdom does not run that default action, so this asserts the shape
   * that caused it rather than the symptom.
   */
  it("never swaps the type of the primary action button between steps", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    const primary = () => screen.getByRole("button", { name: /Continue|Create my chart/i });

    expect(primary()).toHaveAttribute("type", "submit");
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");
    expect(primary()).toHaveAccessibleName(/Create my chart/i);
  });

  it("reaches the review step without submitting anything", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("group", { name: /Review the boundary/i })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still requires the consent box once the review step has been seen", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );

    // Leaving and re-entering the review step must not stand in for pressing the
    // create button, even though consent is already recorded.
    await user.click(screen.getByRole("button", { name: /Back/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not advance without the required chart date", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a birth date");
    expect(screen.getByRole("group", { name: /How precise is the birth time/i })).toBeInTheDocument();
  });
});
