import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: "#FAB8A9" }}
        >
          <span className="text-2xl font-bold text-white">?</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Page Not Found
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          The page you&apos;re looking for doesn&apos;t exist. If you had a magic
          link, it may have been mistyped.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 text-white font-semibold rounded-xl text-sm transition-colors"
          style={{ backgroundColor: "#FAB8A9" }}
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
