// app/not-found.tsx — shown for an unknown gameId (PlayPage's notFound()) and any other
// unmatched route. Never a bare framework 404 — always a path back into the library.

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-bold text-ink">Game not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        That link doesn&apos;t match anything in the library.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded border border-ink px-4 py-2 text-sm text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Back to library
      </Link>
    </div>
  );
}
