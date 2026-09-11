/**
 * Neutral Cloud errors for the product UI. Do not name vendors.
 */

export const HOSTED_CLOUD_UNAVAILABLE_MESSAGE =
  "Aether Cloud isn't available for this chat right now. Try again, or switch to Bring your own key in Settings.";

export function hostedCloudUnavailableError(): Error {
  return new Error(HOSTED_CLOUD_UNAVAILABLE_MESSAGE);
}
