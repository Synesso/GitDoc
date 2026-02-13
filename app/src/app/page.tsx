export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">GitDoc</h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
          Review markdown changes in GitHub PRs with a rendered document view.
        </p>
      </main>
    </div>
  );
}
