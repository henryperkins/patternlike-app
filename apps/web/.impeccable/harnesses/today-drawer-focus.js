async page => {
  const drawer = page.locator("details.today-evidence");
  const summary = page.locator("details.today-evidence > summary");

  await drawer.waitFor();
  if (await drawer.evaluate(element => element.open)) {
    throw new Error("Expected the provenance drawer to start closed");
  }

  await summary.click();
  await page.getByText("How close the contact is to exact").waitFor();
  if (!(await drawer.evaluate(element => element.open))) {
    throw new Error("Pointer activation did not open the provenance drawer");
  }

  await summary.focus();
  if (!(await summary.evaluate(element => element === document.activeElement))) {
    throw new Error("The provenance summary did not receive focus");
  }

  await page.keyboard.press("Enter");
  if (await drawer.evaluate(element => element.open)) {
    throw new Error("Keyboard activation did not close the provenance drawer");
  }
  if (!(await summary.evaluate(element => element === document.activeElement))) {
    throw new Error("The provenance summary lost focus after closing");
  }

  await page.keyboard.press("Enter");
  if (!(await drawer.evaluate(element => element.open))) {
    throw new Error("Keyboard activation did not reopen the provenance drawer");
  }
  if (!(await summary.evaluate(element => element === document.activeElement))) {
    throw new Error("The provenance summary lost focus after reopening");
  }

  return {
    open: await drawer.evaluate(element => element.open),
    focused: await summary.evaluate(element => element === document.activeElement),
    evidenceLoaded: await page
      .getByText("How close the contact is to exact")
      .isVisible(),
  };
}
