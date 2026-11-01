"use client";
import { ErrorView } from "./error-view";
// (for errors in the layout itself: it replaces the whole page, so it brings its own html)
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><ErrorView {...props} /></body></html>;
}
