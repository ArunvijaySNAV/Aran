"use client";
import { Banner, Button } from "@/components/ui";
export default function Err({ reset }: { error: Error; reset: () => void }) {
  return <div className="space-y-3"><Banner tone="bad" role="alert">This page could not load. Nothing was changed.</Banner><Button onClick={reset}>Try again</Button></div>;
}
