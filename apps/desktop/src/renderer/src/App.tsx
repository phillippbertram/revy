import { GitCompareArrows, Layers3, ShipWheel } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const foundationItems = [
  {
    description: 'Electron, React, TypeScript, and ESM',
    label: 'Desktop foundation',
  },
  {
    description: 'Tailwind CSS and shadcn/ui',
    label: 'Interface foundation',
  },
  {
    description: 'Repository selection and branch changes',
    label: 'Next milestone',
  },
]

export function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.64_0.2_255_/_0.18),transparent_38%),radial-gradient(circle_at_bottom_right,oklch(0.7_0.18_165_/_0.12),transparent_34%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 shadow-sm">
            <ShipWheel aria-hidden="true" className="size-5 text-primary" />
          </div>
          <span className="text-sm font-medium tracking-wide text-muted-foreground">SHIPPY</span>
        </div>

        <section className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="max-w-2xl">
            <Badge variant="secondary" className="mb-5">
              Project foundation ready
            </Badge>
            <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
              Review changes before you ship.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
              Shippy is becoming a focused desktop workspace for opening a repository and reviewing
              the changes on its current branch.
            </p>
          </div>

          <Card className="border-white/10 bg-card/75 shadow-2xl shadow-black/20 backdrop-blur">
            <CardHeader>
              <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Layers3 aria-hidden="true" className="size-4" />
              </div>
              <CardTitle>Initial workspace</CardTitle>
              <CardDescription>The product surface will grow from this foundation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {foundationItems.map((item, index) => (
                <div className="flex gap-3" key={item.label}>
                  <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[0.65rem] font-semibold text-muted-foreground">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <div className="mt-12 flex items-center gap-2 text-sm text-muted-foreground">
          <GitCompareArrows aria-hidden="true" className="size-4" />
          Repository review is intentionally not connected yet.
        </div>
      </div>
    </main>
  )
}
