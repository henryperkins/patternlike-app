/**
 * promptfoo prompt function for the validators lane.
 *
 * Under the `echo` provider the rendered prompt IS the provider output, so
 * returning the authored candidate here feeds it straight into the
 * assertion. Returning it from a function rather than a `{{candidate}}`
 * template keeps the JSON out of the template renderer.
 */
export async function authoredCandidate({ vars }) {
  const candidate = vars?.candidate;
  if (candidate === undefined) throw new Error("validators lane test is missing its candidate");
  return typeof candidate === "string" ? candidate : JSON.stringify(candidate);
}
