import { router, type Href } from 'expo-router';

/**
 * Back to the previous screen, or to `fallback` when there is none: on the web a form opened
 * straight from its URL (or after a reload) has no history to go back to.
 */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
