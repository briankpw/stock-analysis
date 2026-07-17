"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";

export default function RawPage() {
  const { data, loading, error, reload } = useBundle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Raw Data" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Loading raw payload…" />}

      {data && (
        <div className="space-y-4 animate-fade-in">
          <Card>
            <CardHeader><CardTitle>Quote</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted/30 rounded-md p-3 overflow-x-auto">
                {JSON.stringify(data.quote, null, 2)}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bars ({data.bars.length})</CardTitle>
              <p className="text-xs text-muted-foreground">Last 20 shown; download the full CSV via the sidebar (todo).</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="table-scroll">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-left border-b border-border">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2 text-right">Open</th>
                      <th className="p-2 text-right">High</th>
                      <th className="p-2 text-right">Low</th>
                      <th className="p-2 text-right">Close</th>
                      <th className="p-2 text-right">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bars.slice(-20).reverse().map((b) => (
                      <tr key={b.time} className="border-b border-border last:border-0">
                        <td className="p-2">{new Date(b.time * 1000).toLocaleDateString()}</td>
                        <td className="p-2 text-right">{b.open.toFixed(2)}</td>
                        <td className="p-2 text-right">{b.high.toFixed(2)}</td>
                        <td className="p-2 text-right">{b.low.toFixed(2)}</td>
                        <td className="p-2 text-right">{b.close.toFixed(2)}</td>
                        <td className="p-2 text-right">{b.volume.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Analysis findings</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted/30 rounded-md p-3 overflow-x-auto max-h-96">
                {JSON.stringify(data.analysis, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
