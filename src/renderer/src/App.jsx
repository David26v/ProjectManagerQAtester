import { Button } from '@/components/ui/button';

// Placeholder shell — sidebar skeleton + heading, proving the Vite/React/
// Tailwind/shadcn pipeline end to end. Task 7 replaces the internals with
// the real app shell, router, and screens.
export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-[230px] shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            Q
          </div>
          <span className="text-sm font-semibold">QA Flow</span>
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">QA Flow</h1>
        <Button>Get started</Button>
      </main>
    </div>
  );
}
