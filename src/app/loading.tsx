export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-10 h-10 rounded-full animate-pulse"
          style={{ backgroundColor: "#FAB8A9" }}
        />
        <p className="text-sm text-gray-400 font-medium">Loading...</p>
      </div>
    </div>
  );
}
